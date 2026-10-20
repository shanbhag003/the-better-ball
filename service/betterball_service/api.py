"""HTTP API for The Better Ball agents, plus the MCP server mounted at /mcp.

    uvicorn betterball_service.api:app --port 8000
"""

from __future__ import annotations

import contextlib
import logging
import os
import time
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
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
from .telemetry import limiter, setup_telemetry  # noqa: E402

setup_telemetry()

log = logging.getLogger("betterball")

Voice = Literal["fan", "analyst"]
MIN_COACH_SECONDS = 9 * 60  # the report needs some football to talk about
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
class AsOfFromHeader:
    """ASGI wrapper: an MCP request carrying x-betterball-as-of runs its tools in live mode."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        value = None
        if scope["type"] == "http":
            raw = dict(scope.get("headers") or []).get(agents.AS_OF_HEADER.encode())
            if raw:
                try:
                    value = float(raw.decode())
                except ValueError:
                    value = None
        with store.as_of(value):
            await self.inner(scope, receive, send)


app.mount("/mcp", AsOfFromHeader(mcp.streamable_http_app()))

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


def rate_limited(request: Request) -> None:
    limiter.check(request)


async def _run(key: tuple, online, fallback) -> dict:
    if key in _cache:
        return {**_cache[key], "cached": True}
    started = time.perf_counter()
    meta = _mode()
    try:
        result = await _online(online, meta) if meta["mode"] == "foundry" else fallback()
    except ValueError as e:  # bad player / team / moment in the request
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001 - surface model/network failures to the UI
        log.exception("agent call failed")
        raise HTTPException(502, f"The AI service failed: {type(e).__name__}") from e
    body = result if isinstance(result, dict) else {"text": result}
    body["text"] = body["text"].strip()
    out = {**body, **meta, "ms": round((time.perf_counter() - started) * 1000)}
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
    as_of: float | None = Field(default=None, description="Live mode: match seconds; omit for the full match")


class CoachIn(BaseModel):
    team: str
    voice: Voice = "analyst"
    language: str = "English"
    as_of: float | None = Field(default=None, description="Live mode: match seconds; omit for the full match")


def _as_of(value: float | None) -> float | None:
    """Snap to the whole minute (stable caching, honest 'as of' labels); None once the match is over."""
    if value is None:
        return None
    m = store.load()
    if value >= m.end:
        return None
    return float(int(value // 60) * 60)


def _with_as_of(as_of: float | None, out: dict) -> dict:
    return {**out, "as_of": as_of}


@app.get("/")
def root() -> dict:
    return {
        "service": "The Better Ball API",
        "health": "/api/health",
        "docs": "/docs",
        "mcp": "/mcp/ (streamable HTTP; tools over the decision engine)",
        "note": "Synthetic match between fictional clubs.",
    }


@app.get("/api/health")
def health() -> dict:
    m = store.load()
    return {"ok": True, **_mode(), "match": [t["name"] for t in m.teams], "decisions": len(m.decisions)}


@app.post("/api/explain", dependencies=[Depends(rate_limited)])
async def explain(body: ExplainIn) -> dict:
    lang = _language(body.language)
    return await _run(
        ("explain", body.moment_id, body.voice, lang),
        lambda client: agents.explain(body.moment_id, body.voice, lang, client=client),
        lambda: offline.explain(body.moment_id, body.voice),
    )


@app.post("/api/ask", dependencies=[Depends(rate_limited)])
async def ask(body: AskIn) -> dict:
    lang = _language(body.language)
    t = _as_of(body.as_of)
    return _with_as_of(t, await _run(
        ("ask", body.question.strip().lower(), body.voice, lang, t),
        lambda client: agents.ask(body.question, body.voice, lang, client=client, as_of=t),
        lambda: offline.ask(body.question, as_of=t),
    ))


@app.post("/api/coach", dependencies=[Depends(rate_limited)])
async def coach(body: CoachIn) -> dict:
    lang = _language(body.language)
    t = _as_of(body.as_of)
    if t is not None and t < MIN_COACH_SECONDS:
        raise HTTPException(400, "Too early for a coach report: let the game develop (from 10').")
    return _with_as_of(t, await _run(
        ("coach", body.team.lower(), body.voice, lang, t),
        lambda client: agents.coach(body.team, body.voice, lang, client=client, as_of=t),
        lambda: offline.coach(body.team, as_of=t),
    ))
