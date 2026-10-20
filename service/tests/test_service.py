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
    assert "You explain football decisions" in answer["text"]  # the narrator speaks last
    assert answer["cards"] == [] and answer["follow_ups"] == []  # plain-text reply degrades gracefully

    report = asyncio.run(agents.coach("NBR", client=client))
    assert "head coach" in report.lower()


@pytest.fixture(scope="module")
def api_client():
    """One app instance per test run: the MCP session manager can only be started once."""
    from fastapi.testclient import TestClient

    from betterball_service.api import app

    os.environ.pop("FOUNDRY_PROJECT_ENDPOINT", None)
    with TestClient(app) as c:
        yield c


def test_api_offline_mode(api_client):
    c = api_client
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


def test_live_mode_hides_the_future():
    m = store.load()
    with store.as_of(600):
        s = store.match_summary()
        assert s["status"]["state"].startswith("LIVE")
        assert all(g["minute"] <= 11 for g in s["goals"])
        future = next(i for i, d in m.decisions.items() if d["t"] > 1200)
        with pytest.raises(ValueError):
            store.get_moment(future)
        assert all(x["minute"] <= 11 for x in store.search_decisions(limit=25))
    assert store.match_summary()["status"]["state"] == "full time"


def test_api_live_as_of_and_cards(api_client):
    c = api_client
    r = c.post("/api/ask", json={"question": "Who is playing better?", "as_of": 1234}).json()
    assert r["as_of"] == 1200 and r["cards"][0]["kind"] == "teams" and len(r["follow_ups"]) == 3
    assert c.post("/api/coach", json={"team": "NBR", "as_of": 120}).status_code == 400  # too early
    assert c.post("/api/coach", json={"team": "NBR", "as_of": 99999}).json()["as_of"] is None  # full time


def test_parse_pundit_script():
    from betterball_service.agents import parse_script

    s = parse_script(
        "HEADLINE: The Run Nobody Found\n1: Coledale has it in midfield.\n2) He goes short, 61% to arrive.\n"
        "3 - #9 Dunford, the ST, was free behind them #football #MNF\nSHOW: space, back_line"
    )
    assert s.headline == "The Run Nobody Found" and len(s.lines) == 3
    assert s.lines[2] == "Dunford, the centre-forward, was free behind them" and s.show.space and s.show.back_line and not s.show.beaten
    assert parse_script("Sorry, I can't help with that.") is None
