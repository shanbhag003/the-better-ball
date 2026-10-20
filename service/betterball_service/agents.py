"""Foundry agents built with Microsoft Agent Framework.

Agents
  * Analyst  - answers questions about the match. Has the MCP tools; must ground every claim in them.
  * Narrator - turns facts into short, plain language for a chosen audience (fan / analyst) and language.
  * Attack coach and Ball-security coach - specialists that review one team in parallel.
  * Head coach - merges the specialists' notes into one half-time / full-time report.

Orchestrations
  * explain(moment)  : Narrator alone, fed the moment's facts (fast, cheap, deterministic grounding).
  * ask(question)    : Sequential  Analyst -> Narrator.
  * coach(team)      : Concurrent  [Attack coach, Ball-security coach] -> Head coach.
"""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from typing import Any

from agent_framework import Agent, MCPStreamableHTTPTool, tool
from agent_framework.orchestrations import ConcurrentBuilder, SequentialBuilder

from . import store

VOICES = {
    "fan": (
        "Audience: casual fans. Write like a friendly TV pundit. No jargon, no decimals beyond what the facts give. "
        "Max 3 short sentences."
    ),
    "analyst": (
        "Audience: coaches and analysts. Be precise and tactical: name players, cite the percentages from the facts, "
        "mention defenders beaten or offside when relevant. Max 4 short sentences."
    ),
}

GROUNDING = (
    "The match is synthetic, between fictional clubs. Only use numbers that appear in the facts or tool results. "
    "Never invent players, minutes or statistics. 'Goal chance' is the chance a move leads to a goal; "
    "'chance it arrives' is the chance the pass reaches the team-mate."
)


def foundry_configured() -> bool:
    return bool(os.environ.get("FOUNDRY_PROJECT_ENDPOINT") and os.environ.get("FOUNDRY_MODEL"))


def model_name() -> str | None:
    return os.environ.get("FOUNDRY_MODEL")


def make_client():
    """Foundry chat client (Responses API). Uses Azure CLI login locally, managed identity in Azure."""
    from agent_framework.foundry import FoundryChatClient
    from azure.identity import DefaultAzureCredential

    return FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=os.environ["FOUNDRY_MODEL"],
        credential=DefaultAzureCredential(exclude_interactive_browser_credential=True),
    )


def local_tools() -> list:
    """The same functions as the MCP server, as in-process tools (fallback when MCP is unreachable)."""
    return [tool(fn) for fn in store.TOOLS]


@asynccontextmanager
async def match_tools():
    """Connect to the Better Ball MCP server; fall back to in-process tools if it is not reachable."""
    url = os.environ.get("BETTERBALL_MCP_URL", "http://127.0.0.1:8000/mcp/")
    if os.environ.get("BETTERBALL_TOOLS", "mcp") == "local":
        yield local_tools()
        return
    mcp_tool = MCPStreamableHTTPTool(name="betterball", url=url, description="The Better Ball match knowledge")
    try:
        await mcp_tool.connect()
    except Exception:  # noqa: BLE001 - any connection problem means: use local tools
        yield local_tools()
        return
    try:
        yield [mcp_tool]
    finally:
        await mcp_tool.close()


# ----------------------------------------------------------------- agents

def narrator(client, voice: str, language: str) -> Agent:
    return Agent(
        client,
        name="Narrator",
        description="Explains football decisions in plain language for a chosen audience.",
        instructions=(
            f"You explain football decisions. {VOICES.get(voice, VOICES['fan'])} "
            f"Write in {language}. {GROUNDING} "
            "If you receive another agent's findings, rewrite them for the audience; do not add new facts."
        ),
    )


def analyst(client, tools: list) -> Agent:
    return Agent(
        client,
        name="Analyst",
        description="Finds the facts behind a question using the match tools.",
        instructions=(
            "You are a football performance analyst. Use the tools to answer the question with evidence: "
            "call match_summary first for context, then the most specific tools (search_decisions, player_report, "
            "team_report, key_moments, get_moment). Return short findings as bullet points with the numbers and "
            f"minutes from the tools. {GROUNDING}"
        ),
        tools=tools,
    )


def specialist(client, tools: list, team: str, focus: str, name: str) -> Agent:
    return Agent(
        client,
        name=name,
        description=f"{focus} specialist",
        instructions=(
            f"You are the {focus} coach reviewing {team}. Use the tools (team_report, search_decisions, "
            f"player_report) to find the 2-3 most important patterns in {focus.lower()} decisions. "
            f"For each, name the players and minutes. Bullet points only. {GROUNDING}"
        ),
        tools=tools,
    )


def head_coach(client, team: str, voice: str, language: str) -> Agent:
    return Agent(
        client,
        name="HeadCoach",
        description="Merges specialist notes into one coaching report.",
        instructions=(
            f"You are the head coach of {team}. Merge your specialists' notes into one report in {language} with "
            "exactly these markdown sections: '### What worked', '### Fix next', '### Player spotlight'. "
            f"Max 3 bullets per section. {VOICES.get(voice, VOICES['analyst'])} {GROUNDING}"
        ),
    )


# ----------------------------------------------------------------- helpers

def _text(value: Any) -> str:
    """Pull plain text out of an AgentResponse / list of messages / workflow output."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if hasattr(value, "text") and isinstance(getattr(value, "text"), str) and value.text:
        return value.text
    if hasattr(value, "messages"):
        return "\n".join(_text(m) for m in value.messages if _text(m)).strip()
    if hasattr(value, "agent_response"):
        return _text(value.agent_response)
    if isinstance(value, (list, tuple)):
        return "\n".join(t for t in (_text(v) for v in value) if t).strip()
    return str(value)


def _last_text(outputs: list) -> str:
    for out in reversed(outputs):
        if isinstance(out, (list, tuple)) and out:
            # Sequential workflows output the whole conversation; the narrator speaks last.
            return _text(out[-1])
        t = _text(out)
        if t:
            return t
    return ""


# ----------------------------------------------------------------- flows

async def explain(moment_id: int, voice: str = "fan", language: str = "English", client=None) -> str:
    facts = store.get_moment(moment_id)
    agent = narrator(client or make_client(), voice, language)
    prompt = "Explain this decision and what the better option would have changed.\nFacts:\n" + json.dumps(facts)
    return _text(await agent.run(prompt))


async def ask(question: str, voice: str = "fan", language: str = "English", client=None) -> str:
    client = client or make_client()
    async with match_tools() as tools:
        workflow = SequentialBuilder(participants=[analyst(client, tools), narrator(client, voice, language)]).build()
        result = await workflow.run(question)
        return _last_text(result.get_outputs())


async def coach(team: str, voice: str = "analyst", language: str = "English", client=None) -> str:
    client = client or make_client()
    team_name = store.load().teams[store.load().team_index(team)]["name"]
    async with match_tools() as tools:
        attack = specialist(client, tools, team_name, "Attacking (chance creation, forward passing)", "AttackCoach")
        security = specialist(client, tools, team_name, "Ball security (risky passes, offside, turnovers)", "SecurityCoach")

        def collect(results: list) -> str:
            return "\n\n".join(f"Notes from {getattr(r, 'executor_id', 'specialist')}:\n{_text(r)}" for r in results)

        notes_flow = ConcurrentBuilder(participants=[attack, security]).with_aggregator(collect).build()
        notes = _last_text((await notes_flow.run(f"Review {team_name}'s decisions in this match.")).get_outputs())
        report = await head_coach(client, team_name, voice, language).run(
            f"Specialist notes for {team_name}:\n{notes}\n\nWrite the report."
        )
        return _text(report)
