"""Risk Agent Python sidecar entrypoint."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from .routers import curate as curate_router
from .routers import embed as embed_router

log = logging.getLogger("risk_agent.sidecar")
logging.basicConfig(level=os.getenv("SIDECAR_LOG_LEVEL", "INFO"))


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    log.info("risk-agent sidecar starting")
    # Lazy: model loaded on first /embed call to keep cold-start cheap.
    yield
    log.info("risk-agent sidecar stopped")


app = FastAPI(title="Risk Agent Sidecar", version="0.1.0", lifespan=lifespan)
app.include_router(embed_router.router)
app.include_router(curate_router.router)


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {
        "status": "ok",
        "embed_model": os.getenv("EMBED_MODEL_PATH") or os.getenv("EMBED_MODEL", "BAAI/bge-m3"),
        "llm_base_url": os.getenv("LLM_BASE_URL", "http://127.0.0.1:11434/v1"),
    }
