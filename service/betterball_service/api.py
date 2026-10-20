"""HTTP API for The Better Ball agents, plus the MCP server mounted at /mcp.

    uvicorn betterball_service.api:app --port 8000
"""

from __future__ import annotations

import contextlib
import logging
import os
import time
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from pathlib import Path


def _load_env_file(path: Path) -> None:
    """Read KEY=VALUE lines from service/.env without overriding real environment variables."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_env_file(Path(__file__).resolve().parents[1] / ".env")

from . import agents, offline, store  # noqa: E402
from .mcp_server import mcp  # noqa: E402

log = logging.getLogger("betterball")

Voice = Literal["fan", "analyst"]
LANGUAGES = {"English", "Spanish", "French", "Portuguese", "German", "Hindi", "Arabic", "Japanese"}


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="The Better Ball", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/mcp", mcp.streamable_http_app())

# Same inputs give the same answer: cache to keep latency and model cost down.
_cache: dict[tuple, dict] = {}


def _mode() -> dict:
    return {"mode": "foundry", "model": agents.model_name()} if agents.foundry_configured() else {"mode": "offline", "model": None}


def _language(lang: str) -> str:
    return lang if lang in LANGUAGES else "English"


async def _online(online, meta: dict) -> str:
    """Run the agents on the primary model; on failure retry once on the backup deployment."""
    try:
        return await online(agents.make_client())
    except ValueError:
        raise
    except Exception:  # noqa: BLE001
        backup = agents.fallback_model()
        if not backup:
            raise
        log.warning("primary model failed; retrying on backup %s", backup, exc_info=True)
        meta["model"] = backup
        meta["fallback"] = True
        return await online(agents.make_client(backup))


async def _run(key: tuple, online, fallback) -> dict:
    if key in _cache:
        return {**_cache[key], "cached": True}
    started = time.perf_counter()
    meta = _mode()
    try:
        text = await _online(online, meta) if meta["mode"] == "foundry" else fallback()
    except ValueError as e:  # bad player / team / moment in the request
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001 - surface model/network failures to the UI
        log.exception("agent call failed")
        raise HTTPException(502, f"The AI service failed: {type(e).__name__}") from e
    out = {"text": text.strip(), **meta, "ms": round((time.perf_counter() - started) * 1000)}
    _cache[key] = out
    return out


class ExplainIn(BaseModel):
    moment_id: int
    voice: Voice = "fan"
    language: str = "English"


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=300)
    voice: Voice = "fan"
    language: str = "English"


class CoachIn(BaseModel):
    team: str
    voice: Voice = "analyst"
    language: str = "English"


@app.get("/api/health")
def health() -> dict:
    m = store.load()
    return {"ok": True, **_mode(), "match": [t["name"] for t in m.teams], "decisions": len(m.decisions)}


@app.post("/api/explain")
async def explain(body: ExplainIn) -> dict:
    lang = _language(body.language)
    return await _run(
        ("explain", body.moment_id, body.voice, lang),
        lambda client: agents.explain(body.moment_id, body.voice, lang, client=client),
        lambda: offline.explain(body.moment_id, body.voice),
    )


@app.post("/api/ask")
async def ask(body: AskIn) -> dict:
    lang = _language(body.language)
    return await _run(
        ("ask", body.question.strip().lower(), body.voice, lang),
        lambda client: agents.ask(body.question, body.voice, lang, client=client),
        lambda: offline.ask(body.question),
    )


@app.post("/api/coach")
async def coach(body: CoachIn) -> dict:
    lang = _language(body.language)
    return await _run(
        ("coach", body.team.lower(), body.voice, lang),
        lambda client: agents.coach(body.team, body.voice, lang, client=client),
        lambda: offline.coach(body.team),
    )
