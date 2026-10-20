"""Service tests. Agents run against a fake chat client, so no Azure access is needed."""

import asyncio
import os

import pytest
from agent_framework import BaseChatClient, ChatResponse, Message

from betterball_service import agents, store

os.environ["BETTERBALL_TOOLS"] = "local"


class FakeClient(BaseChatClient):
    """Replies with which agent spoke (taken from its instructions) and how many messages it saw."""

    async def _get(self, messages, options):
        system = options.get("instructions") or next((m.text for m in messages if m.role in ("system", "developer")), "")
        who = system.split(".")[0][:60]
        return ChatResponse(messages=[Message("assistant", [f"[{who}] saw {len(messages)} messages"])])

    def _inner_get_response(self, *, messages, stream, options, **kwargs):
        return self._get(messages, options)


def test_tools_return_grounded_facts():
    summary = store.match_summary()
    assert len(summary["teams"]) == 2
    moments = store.key_moments(limit=3)
    assert moments and all(m["better_option"] for m in moments)
    one = store.get_moment(moments[0]["moment_id"])
    assert one["goal_chance_missed"].endswith("%")
    assert store.player_report(store.load().players[5]["name"])["decisions"] > 0
    assert store.team_report("NBR")["team"] == "Northbridge Rovers"
    assert len(store.search_decisions(team="HBC", limit=5)) <= 5


def test_player_lookup():
    m = store.load()
    p = m.players[13]
    assert m.player_index(f"#{p['number']} {m.teams[p['team']]['short']}") == 13
    with pytest.raises(ValueError):
        m.player_index("Nobody McNoname")


def test_mcp_server_lists_all_tools():
    from betterball_service.mcp_server import mcp

    names = {t.name for t in asyncio.run(mcp.list_tools())}
    assert {"match_summary", "key_moments", "get_moment", "player_report", "team_report"} <= names


def test_agent_flows_run_end_to_end():
    client = FakeClient()
    mid = store.key_moments(limit=1)[0]["moment_id"]
    text = asyncio.run(agents.explain(mid, "fan", "English", client=client))
    assert "You explain football decisions" in text

    answer = asyncio.run(agents.ask("Why did Northbridge lose?", client=client))
    assert "You explain football decisions" in answer  # the narrator speaks last

    report = asyncio.run(agents.coach("NBR", client=client))
    assert "head coach" in report.lower()


def test_api_offline_mode():
    from fastapi.testclient import TestClient

    from betterball_service.api import app

    os.environ.pop("FOUNDRY_PROJECT_ENDPOINT", None)
    with TestClient(app) as c:
        h = c.get("/api/health").json()
        assert h["ok"] and h["mode"] == "offline"
        mid = store.key_moments(limit=1)[0]["moment_id"]
        r = c.post("/api/explain", json={"moment_id": mid, "voice": "fan"}).json()
        assert r["mode"] == "offline" and "better ball" in r["text"]
        assert c.post("/api/ask", json={"question": "Who made the worst decisions?"}).status_code == 200
        assert "### Fix next" in c.post("/api/coach", json={"team": "NBR"}).json()["text"]
        assert c.post("/api/explain", json={"moment_id": -5}).status_code == 400


def test_rate_limit():
    from fastapi import HTTPException
    from starlette.requests import Request

    from betterball_service.telemetry import RateLimiter

    rl = RateLimiter(per_ip=2, global_limit=100)
    req = Request({"type": "http", "headers": [(b"x-forwarded-for", b"1.2.3.4")], "client": ("9.9.9.9", 1)})
    rl.check(req)
    rl.check(req)
    with pytest.raises(HTTPException) as e:
        rl.check(req)
    assert e.value.status_code == 429
