"""Embedding endpoint backed by sentence-transformers."""

from __future__ import annotations

import logging
import os
from threading import Lock
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)
router = APIRouter()

_MODEL_LOCK = Lock()
_MODEL: Any = None


class EmbedRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=256)
    model: str | None = None


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    dim: int
    model: str


def _load_model(model_override: str | None = None):  # noqa: ANN401 — torch runtime
    global _MODEL
    if _MODEL is not None and model_override is None:
        return _MODEL

    try:
        from sentence_transformers import SentenceTransformer  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover
        raise HTTPException(status_code=503, detail=f"sentence-transformers missing: {exc}") from exc

    target = (
        model_override
        or os.getenv("EMBED_MODEL_PATH")
        or os.getenv("EMBED_MODEL")
        or "BAAI/bge-m3"
    )
    log.info("loading embedding model: %s", target)
    with _MODEL_LOCK:
        if _MODEL is None or model_override is not None:
            _MODEL = SentenceTransformer(target, trust_remote_code=False)
    return _MODEL


@router.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest) -> EmbedResponse:
    model = _load_model(req.model)
    vectors = model.encode(
        req.texts,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    dim = int(vectors.shape[1]) if vectors.ndim == 2 else len(vectors[0])
    return EmbedResponse(
        vectors=[v.tolist() for v in vectors],
        dim=dim,
        model=os.getenv("EMBED_MODEL_PATH") or os.getenv("EMBED_MODEL", "BAAI/bge-m3"),
    )
