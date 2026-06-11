"""Memory & skill curator endpoint.

Calls an OpenAI-compatible LLM endpoint to summarize a transcript into 1-3
durable memory facts, or to suggest improvements to a skill markdown.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)
router = APIRouter()


class TranscriptTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class CurateMemoryRequest(BaseModel):
    kind: Literal["memory_curate"] = "memory_curate"
    transcript: list[TranscriptTurn]
    existing_facts: list[str] = Field(default_factory=list, alias="existingFacts")
    max_facts: int = Field(default=3, ge=1, le=8, alias="maxFacts")


class CurateSkillRequest(BaseModel):
    kind: Literal["skill_curate"] = "skill_curate"
    skill_id: str = Field(..., alias="skillId")
    skill_name: str = Field(..., alias="skillName")
    current_md: str = Field(..., alias="currentMd")
    recent_run_summary: str = Field(..., alias="recentRunSummary")


class FactItem(BaseModel):
    content: str
    category: Literal[
        "domain_knowledge",
        "user_preference",
        "analysis_pattern",
        "risk_template",
        "general",
    ] = "general"
    confidence: float = 0.7


class CurateMemoryResponse(BaseModel):
    facts: list[FactItem]


class CurateSkillResponse(BaseModel):
    improved_md: str | None = Field(default=None, alias="improvedMd")
    reason: str | None = None
    confidence: float | None = None


def _llm_call(prompt: str) -> str:
    base = os.getenv("LLM_BASE_URL", "http://127.0.0.1:11434/v1").rstrip("/")
    api_key = os.getenv("LLM_API_KEY", "dummy")
    model = os.getenv("LLM_MODEL", "qwen2.5:7b-instruct")
    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "stream": False,
    }
    with httpx.Client(timeout=20.0) as client:
        r = client.post(url, json=payload, headers={"Authorization": f"Bearer {api_key}"})
        r.raise_for_status()
        data = r.json()
    return data["choices"][0]["message"]["content"]


@router.post("/curate")
async def curate(payload: dict[str, Any]) -> dict[str, Any]:
    kind = payload.get("kind")
    if kind == "memory_curate":
        return await _curate_memory(CurateMemoryRequest.model_validate(payload)).model_dump(by_alias=True)
    if kind == "skill_curate":
        return await _curate_skill(CurateSkillRequest.model_validate(payload)).model_dump(by_alias=True)
    raise HTTPException(status_code=400, detail=f"unknown kind: {kind}")


async def _curate_memory(req: CurateMemoryRequest) -> CurateMemoryResponse:
    if not req.transcript:
        return CurateMemoryResponse(facts=[])

    transcript_text = "\n".join(f"[{t.role}] {t.content}" for t in req.transcript[-12:])
    existing = "\n".join(f"- {f}" for f in req.existing_facts[:10]) or "（无）"
    prompt = f"""你是会话记忆策展员。从下面的对话中抽取 0-{req.max_facts} 条值得长期保留的事实。

## 已有事实（避免重复）
{existing}

## 本次对话
{transcript_text}

## 要求
1) 每条事实独立成行 JSON：{{"content":"...","category":"domain_knowledge|user_preference|analysis_pattern|risk_template|general","confidence":0.0-1.0}}
2) 不要总结闲聊。如果没有可保留的内容，输出空数组 []
3) 仅返回 JSON 数组，不要任何解释文字。
"""

    try:
        raw = _llm_call(prompt)
    except Exception as exc:  # pragma: no cover
        log.warning("memory curator LLM call failed: %s", exc)
        return CurateMemoryResponse(facts=[])

    try:
        # Tolerate code-fence wrapped output
        cleaned = raw.strip().strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
        items = json.loads(cleaned)
        if not isinstance(items, list):
            return CurateMemoryResponse(facts=[])
        facts = [FactItem.model_validate(it) for it in items if isinstance(it, dict)]
        return CurateMemoryResponse(facts=facts[: req.max_facts])
    except Exception as exc:
        log.warning("memory curator parse failed: %s — raw=%s", exc, raw[:200])
        return CurateMemoryResponse(facts=[])


async def _curate_skill(req: CurateSkillRequest) -> CurateSkillResponse:
    prompt = f"""你是技能文档(SKILL.md)优化师。基于本次 run 的实际使用情况，
评估技能 {req.skill_name} 的当前文档是否需要补强。

## 当前 SKILL.md
{req.current_md[:6000]}

## 本次 run 摘要
{req.recent_run_summary[:2000]}

## 要求
- 如不需要修改，输出 JSON: {{"improvedMd": null, "reason": "no_change_needed"}}
- 否则输出 JSON: {{"improvedMd": "<完整新的 SKILL.md>", "reason": "<改动原因>", "confidence": 0.0-1.0}}
- 仅返回 JSON。
"""
    try:
        raw = _llm_call(prompt)
        cleaned = raw.strip().strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
        data = json.loads(cleaned)
        return CurateSkillResponse.model_validate(data)
    except Exception as exc:
        log.warning("skill curator failed: %s", exc)
        return CurateSkillResponse(improved_md=None, reason=f"curator_error:{type(exc).__name__}")
