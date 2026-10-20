"""Foundry agents built with Microsoft Agent Framework.

Agents
  * Analyst  - answers questions about the match. Has the MCP tools; must ground every claim in them.
  * Narrator - turns facts into short, plain language for a chosen audience (fan / analyst) and language.
  * Attack coach and Ball-security coach - specialists that review one team in parallel.
  * Head coach - merges the specialists' notes into one half-time / full-time report.

Orchestrations
  * explain(moment)  : Narrator alone, fed the moment's facts (fast, cheap, deterministic grounding).
  * ask(question)    : Analyst (MCP tools) -> Narrator, explicit hand-off of written findings; the Narrator
                       returns structured output (answer, card references, 3 follow-ups).
  * coach(team)      : Concurrent  [Attack coach, Ball-security coach] -> Head coach.

Live mode: `as_of` (match seconds) limits every tool to what has happened so far, and the prompts forbid
revealing or predicting the result.
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Literal

from agent_framework import Agent, MCPStreamableHTTPTool, tool
from pydantic import BaseModel, Field
from agent_framework.orchestrations import ConcurrentBuilder

from . import store

log = logging.getLogger("betterball")

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
    "'chance it arrives' is the chance the pass reaches the team-mate. "
    "Position codes: GK goalkeeper; RB/LB full-backs; RCB/LCB centre-backs; DM/RDM/LDM defensive midfielders; "
    "RCM/LCM central midfielders; CAM attacking midfielder; RW/LW/RAM/LAM wingers; ST striker. "
    "Only describe a player's role from these codes."
)


def foundry_configured() -> bool:
    return bool(os.environ.get("FOUNDRY_PROJECT_ENDPOINT") and os.environ.get("FOUNDRY_MODEL"))


def model_name() -> str | None:
    return os.environ.get("FOUNDRY_MODEL")


def fallback_model() -> str | None:
    """Optional second deployment used when the primary model fails (rate limit, outage)."""
    return os.environ.get("FOUNDRY_FALLBACK_MODEL") or None


def make_client(model: str | None = None):
    """Foundry chat client (Responses API). Uses Azure CLI login locally, managed identity in Azure."""
    from agent_framework.foundry import FoundryChatClient
    from azure.identity import DefaultAzureCredential

    _ensure_azure_cli_on_path()
    return FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=model or os.environ["FOUNDRY_MODEL"],
        credential=DefaultAzureCredential(exclude_interactive_browser_credential=True),
        # Tool errors (e.g. "'Stanley' is ambiguous: ...") go back to the model so it can correct
        # itself; hard limits keep a confused agent from looping.
        function_invocation_configuration={
            "include_detailed_errors": True,
            "max_function_calls": 12,
            "max_duration_seconds": 90,
        },
    )


def _ensure_azure_cli_on_path() -> None:
    """Local Windows dev: a just-installed Azure CLI is not on PATH of already-running processes."""
    default = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
    if os.name == "nt" and os.path.isdir(default) and default not in os.environ.get("PATH", ""):
        os.environ["PATH"] = default + os.pathsep + os.environ.get("PATH", "")


def local_tools() -> list:
    """The same functions as the MCP server, as in-process tools (fallback when MCP is unreachable)."""
    return [tool(fn) for fn in store.TOOLS]


AS_OF_HEADER = "x-betterball-as-of"


@asynccontextmanager
async def match_tools(as_of: float | None = None):
    """Connect to the Better Ball MCP server; fall back to in-process tools if it is not reachable.

    In live mode the current match time travels to the MCP server in a header, so every tool call
    only sees what has happened so far.
    """
    url = os.environ.get("BETTERBALL_MCP_URL", "http://127.0.0.1:8000/mcp/")
    if os.environ.get("BETTERBALL_TOOLS", "mcp") == "local":
        yield local_tools()
        return
    headers = {AS_OF_HEADER: str(as_of)} if as_of is not None else None
    mcp_tool = MCPStreamableHTTPTool(
        name="betterball", url=url, description="The Better Ball match knowledge", static_headers=headers
    )
    try:
        await mcp_tool.connect()
    except Exception:  # noqa: BLE001 - any connection problem means: use local tools, but say so
        log.warning("MCP server at %s unreachable; using in-process tools", url, exc_info=True)
        yield local_tools()
        return
    try:
        yield [mcp_tool]
    finally:
        await mcp_tool.close()


def live_rules() -> str:
    """Prompt rules for the current match time (call inside store.as_of)."""
    m = store.load()
    if not m.live():
        return "The match has finished (full time)."
    st = m.status()
    return (
        f"The match is LIVE: {st['state']}, score {st['score'][0]}-{st['score'][1]}. You only know what has happened "
        "so far. Never state or guess the final score or later events. If asked who will win, say who looks more "
        "likely on the evidence so far (xG, shots, good decisions, missed chances) and why, and say it is not decided."
    )


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


class CardRef(BaseModel):
    kind: Literal["player", "teams", "moment"]
    player: str | None = Field(default=None, description="For kind=player: player name or '#8 NBR'")
    moment_id: int | None = Field(default=None, description="For kind=moment: a moment_id from the findings")


class AskReply(BaseModel):
    answer: str = Field(description="The answer for the audience, in the requested language")
    cards: list[CardRef] = Field(default_factory=list, description="0-2 cards that best illustrate the answer")
    follow_ups: list[str] = Field(default_factory=list, description="Exactly 3 short follow-up questions")


ASK_FORMAT = (
    "Return: 'answer' (your reply); 'cards' with 0-2 visuals that best support it - 'teams' for a team comparison, "
    "'player' (give the player's name) when one player is central, 'moment' (give a moment_id that appears in the "
    "findings) when a specific moment is central; and 'follow_ups': exactly 3 short, natural next questions a user "
    "would ask after this answer, in the requested language. Follow-ups must be answerable from the data we have: "
    "pass decisions and their verdicts, chance a pass arrives, goal chance, defenders beaten, offside, goals, shots, "
    "xG, key moments, player and team decision profiles. We do NOT have shots on target, possession %, tackles, "
    "distance run or anything off the ball."
)


def build_cards(refs: list[CardRef]) -> list[dict]:
    """Resolve card references into data from the engine; skip anything that does not resolve."""
    cards: list[dict] = []
    for r in refs[:2]:
        try:
            if r.kind == "teams":
                cards.append(store.card_teams())
            elif r.kind == "player" and r.player:
                cards.append(store.card_player(r.player))
            elif r.kind == "moment" and r.moment_id is not None:
                cards.append(store.card_moment(int(r.moment_id)))
        except (ValueError, KeyError):
            continue
    return cards


async def ask(question: str, voice: str = "fan", language: str = "English", client=None,
              as_of: float | None = None) -> dict:
    """Analyst gathers evidence with the MCP tools, then the Narrator answers for the audience.

    The hand-off is explicit: the Narrator receives the question and the Analyst's written findings
    only, never the raw tool-call history (some reasoning models echo that instead of answering).
    Returns the answer, up to two cards (built from engine data) and three follow-up questions.
    """
    client = client or make_client()
    with store.as_of(as_of):
        rules = live_rules()
        async with match_tools(as_of) as tools:
            findings = _text(await analyst(client, tools).run(
                f"{rules}\n\nQuestion: {question}\n(When you cite a moment, include its moment_id.)"
            ))
        if not findings:
            raise RuntimeError("The analyst returned no findings")
        prompt = (
            f"{rules}\n\nQuestion from the user: {question}\n\n"
            f"Findings from the Analyst (all numbers come from the match tools):\n{findings}\n\n"
            f"Answer the question directly, first sentence first. Use only these findings. {ASK_FORMAT}"
        )
        reply = await narrator(client, voice, language).run(prompt, options={"response_format": AskReply})
        try:
            parsed = reply.value if isinstance(reply.value, AskReply) else None
        except Exception:  # noqa: BLE001 - malformed JSON from the model
            parsed = None
        if parsed is None:  # model ignored the schema: keep the text, drop the extras
            return {"text": _text(reply), "cards": [], "follow_ups": []}
        return {
            "text": parsed.answer,
            "cards": build_cards(parsed.cards),
            "follow_ups": [q.strip() for q in parsed.follow_ups if q.strip()][:3],
        }


async def coach(team: str, voice: str = "analyst", language: str = "English", client=None,
                as_of: float | None = None) -> str:
    client = client or make_client()
    m = store.load()
    team_name = m.teams[m.team_index(team)]["name"]
    with store.as_of(as_of):
        rules = live_rules()
        scope = "so far in this match" if m.live() else "in this match"
        async with match_tools(as_of) as tools:
            attack = specialist(client, tools, team_name, "Attacking (chance creation, forward passing)", "AttackCoach")
            security = specialist(client, tools, team_name, "Ball security (risky passes, offside, turnovers)", "SecurityCoach")

            def collect(results: list) -> str:
                return "\n\n".join(f"Notes from {getattr(r, 'executor_id', 'specialist')}:\n{_text(r)}" for r in results)

            notes_flow = ConcurrentBuilder(participants=[attack, security]).with_aggregator(collect).build()
            notes = _last_text((await notes_flow.run(f"{rules}\n\nReview {team_name}'s decisions {scope}.")).get_outputs())
        report = await head_coach(client, team_name, voice, language).run(
            f"{rules}\n\nSpecialist notes for {team_name}:\n{notes}\n\nWrite the report covering only what has happened {scope}."
        )
        return _text(report)
