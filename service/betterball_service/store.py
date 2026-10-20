"""Match knowledge the agents can query.

Every function here returns plain, JSON-ready facts taken from the decision
engine's output. The same functions are exposed to the agents as tools through
the MCP server, so anything an agent says is grounded in these numbers.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from functools import lru_cache
from pathlib import Path

GOOD_VERDICTS = {"optimal", "good"}
VERDICT_LABEL = {
    "optimal": "Best choice",
    "good": "Good choice",
    "clear_upgrade": "Clear upgrade (a safer AND more dangerous pass was on)",
    "missed_progression": "Missed chance (played safe, a more dangerous pass was on)",
    "too_risky": "Too risky (low-odds pass, a safer one was worth more)",
    "should_shoot": "Should shoot",
    "should_pass": "Should pass instead of shooting",
    "offside": "Offside pass",
    "suboptimal": "Better option available",
}

DEFAULT_DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "match_7.json"


def _pct(p: float) -> str:
    return f"{round(p * 100)}%"


def _goal(ev: float) -> str:
    v = max(0.0, ev) * 100
    return f"{v:.1f}%" if v < 10 else f"{round(v)}%"


def _minute(t: float) -> int:
    return int(t // 60) + 1


class Match:
    """Loaded replay bundle with lookup helpers."""

    def __init__(self, bundle: dict):
        self.b = bundle
        self.teams = bundle["teams"]
        self.players = bundle["players"]
        self.decisions = {int(k): v for k, v in bundle["decisions"].items()}
        self.key_ids = bundle["key_moments"]
        self.team_stats = bundle["team_stats"]
        self.player_stats = bundle["player_stats"]
        self.goals = [e for e in bundle["events"] if e["type"] == "goal"]
        self.threshold = bundle["meta"].get("good_threshold", 0.012)

    # ---------------------------------------------------------------- lookups
    def team_index(self, team: str | int | None) -> int | None:
        if team is None or team == "":
            return None
        if isinstance(team, int) or str(team).isdigit():
            return int(team)
        t = str(team).strip().lower()
        for k, tm in enumerate(self.teams):
            if t in (tm["short"].lower(), tm["name"].lower()) or t in tm["name"].lower():
                return k
        raise ValueError(f"Unknown team '{team}'. Teams: {', '.join(x['name'] for x in self.teams)}")

    def player_index(self, player: str | int) -> int:
        """Accepts an index, a name ('Rafa Stanley', 'Stanley') or '#8 NBR'."""
        if isinstance(player, int):
            return player
        q = str(player).strip().lower().replace("#", "")
        parts = q.split()
        if parts and parts[0].isdigit():
            number = int(parts[0])
            team = self.team_index(parts[1]) if len(parts) > 1 else None
            hits = [p for p in self.players if p["number"] == number and (team is None or p["team"] == team)]
            if len(hits) == 1:
                return hits[0]["idx"]
            if hits:
                raise ValueError(f"Shirt #{number} exists in both teams; add the team, e.g. '#{number} NBR'.")
        hits = [p for p in self.players if q in p["name"].lower()]
        if len(hits) == 1:
            return hits[0]["idx"]
        if not hits:
            raise ValueError(f"No player matches '{player}'.")
        raise ValueError(f"'{player}' is ambiguous: {', '.join(p['name'] for p in hits)}.")

    def who(self, idx: int | None) -> str | None:
        if idx is None:
            return None
        p = self.players[idx]
        return f"#{p['number']} {p['name']} ({p['position']}, {self.teams[p['team']]['short']})"

    def score_at(self, t: float) -> list[int]:
        score = [0, 0]
        for g in self.goals:
            if g["t"] <= t and g.get("score"):
                score = g["score"]
        return list(score)

    # ---------------------------------------------------------------- formatting
    def option_facts(self, o: dict | None) -> dict | None:
        if not o:
            return None
        return {
            "action": "shot" if o["kind"] == "shot" else "pass",
            "to": self.who(o.get("receiver")),
            "chance_it_arrives": _pct(o["p"]) if o.get("p") is not None else None,
            "goal_chance": _goal(o["ev"]),
            "defenders_beaten": o.get("bypassed", 0),
            "into_space": o.get("style") == "space",
        }

    def moment_facts(self, eid: int) -> dict:
        d = self.decisions[eid]
        return {
            "moment_id": eid,
            "minute": _minute(d["t"]),
            "score_at_the_time": self.score_at(d["t"]),
            "player": self.who(d["player"]),
            "team": self.teams[d["team"]]["name"],
            "verdict": VERDICT_LABEL.get(d["verdict"], d["verdict"]),
            "played": {**self.option_facts(d["chosen"]), "result": d.get("outcome")},
            "better_option": self.option_facts(d["best"]) if d["cost"] >= self.threshold else None,
            "goal_chance_missed": _goal(d["cost"]),
            "set_piece": d.get("set_piece"),
            "teammates_offside": [self.who(i) for i in d.get("offside_players") or []],
        }


@lru_cache(maxsize=4)
def load(path: str | None = None) -> Match:
    p = Path(path or os.environ.get("BETTERBALL_DATA") or DEFAULT_DATA)
    return Match(json.loads(p.read_text(encoding="utf-8")))


# ===================================================================== tools
# Each tool returns compact JSON-ready facts. Docstrings are what the agents see.

def match_summary() -> dict:
    """Score, goals and headline decision stats for both teams."""
    m = load()
    teams = []
    for k, t in enumerate(m.teams):
        s = m.team_stats[str(k)]
        verdicts = Counter(d["verdict"] for d in m.decisions.values() if d["team"] == k)
        teams.append({
            "team": t["name"],
            "short": t["short"],
            "formation": t["formation"],
            "style": t["style"],
            "goals": m.b["meta"]["score"][k],
            "good_decisions": f"{round(s['decision_score'])}%",
            "pass_accuracy": f"{round(s['pass_completion'])}%",
            "shots": s["shots"],
            "xg": s["xg"],
            "missed_chances": verdicts["missed_progression"],
            "clear_upgrades_missed": verdicts["clear_upgrade"],
            "too_risky": verdicts["too_risky"],
            "offside_passes": verdicts["offside"],
        })
    goals = [{"minute": _minute(g["t"]), "scorer": m.who(g["player"]), "score": g.get("score")} for g in m.goals]
    return {"teams": teams, "goals": goals, "note": "Synthetic match between fictional clubs."}


def key_moments(team: str | None = None, limit: int = 8) -> list[dict]:
    """The biggest missed chances of the match, optionally for one team (name or short code)."""
    m = load()
    ti = m.team_index(team)
    ids = [i for i in m.key_ids if ti is None or m.decisions[i]["team"] == ti]
    ids.sort(key=lambda i: m.decisions[i]["cost"], reverse=True)
    return [m.moment_facts(i) for i in ids[: max(1, min(limit, 20))]]


def get_moment(moment_id: int) -> dict:
    """Full facts for one decision: what was played, the better option and the goal chance missed."""
    m = load()
    if moment_id not in m.decisions:
        raise ValueError(f"No decision with id {moment_id}.")
    return m.moment_facts(moment_id)


def search_decisions(
    player: str | None = None,
    team: str | None = None,
    verdict: str | None = None,
    half: int | None = None,
    min_goal_chance_missed: float = 0.0,
    limit: int = 10,
) -> list[dict]:
    """Find decisions by player, team, verdict (missed_progression, clear_upgrade, too_risky,
    should_shoot, should_pass, offside), half (1 or 2) and minimum goal chance missed (0-1).
    Results are sorted by goal chance missed, biggest first."""
    m = load()
    pi = m.player_index(player) if player else None
    ti = m.team_index(team)
    half_t = m.b["meta"]["duration"] / 2 + m.b["meta"]["t0"]
    out = []
    for eid, d in m.decisions.items():
        if pi is not None and d["player"] != pi:
            continue
        if ti is not None and d["team"] != ti:
            continue
        if verdict and d["verdict"] != verdict:
            continue
        if half == 1 and d["t"] >= half_t or half == 2 and d["t"] < half_t:
            continue
        if d["cost"] < min_goal_chance_missed:
            continue
        out.append(eid)
    out.sort(key=lambda i: m.decisions[i]["cost"], reverse=True)
    return [m.moment_facts(i) for i in out[: max(1, min(limit, 25))]]


def player_report(player: str) -> dict:
    """A player's decision profile: share of good decisions, verdict counts and worst moments.
    Accepts a name ('Stanley'), full name or shirt number with team ('#8 NBR')."""
    m = load()
    pi = m.player_index(player)
    mine = {i: d for i, d in m.decisions.items() if d["player"] == pi}
    s = m.player_stats.get(str(pi), {})
    verdicts = Counter(d["verdict"] for d in mine.values())
    worst = sorted(mine, key=lambda i: mine[i]["cost"], reverse=True)[:3]
    passes = [d for d in mine.values() if d["type"] == "pass"]
    completed = sum(d["outcome"] == "complete" for d in passes)
    forward = [d for d in passes if d["chosen"].get("bypassed", 0) > 0]
    return {
        "player": m.who(pi),
        "decisions": len(mine),
        "good_decisions": f"{round(s.get('decision_score', 0))}%",
        "pass_accuracy": f"{round(100 * completed / len(passes))}%" if passes else None,
        "line_breaking_passes": len(forward),
        "verdicts": {VERDICT_LABEL.get(k, k): v for k, v in verdicts.most_common()},
        "worst_moments": [m.moment_facts(i) for i in worst if mine[i]["cost"] >= m.threshold],
    }


def team_report(team: str) -> dict:
    """A team's decision profile: verdict mix, best and weakest decision makers, by half."""
    m = load()
    ti = m.team_index(team)
    if ti is None:
        raise ValueError("Give a team name or short code.")
    mine = {i: d for i, d in m.decisions.items() if d["team"] == ti}
    half_t = m.b["meta"]["duration"] / 2 + m.b["meta"]["t0"]
    by_half = {}
    for h, sel in ((1, lambda d: d["t"] < half_t), (2, lambda d: d["t"] >= half_t)):
        ds = [d for d in mine.values() if sel(d)]
        good = sum(d["verdict"] in GOOD_VERDICTS for d in ds)
        by_half[f"half_{h}"] = {
            "decisions": len(ds),
            "good_decisions": f"{round(100 * good / max(1, len(ds)))}%",
            "missed_chances": sum(d["verdict"] in ("missed_progression", "clear_upgrade") for d in ds),
        }
    ranked = []
    for p in m.players:
        if p["team"] != ti:
            continue
        s = m.player_stats.get(str(p["idx"]))
        if s and s["decisions"] >= 15:
            ranked.append((s["decision_score"], s["cost"], p["idx"], s["decisions"]))
    ranked.sort(reverse=True)
    fmt = lambda r: {"player": m.who(r[2]), "good_decisions": f"{round(r[0])}%", "decisions": r[3]}  # noqa: E731
    verdicts = Counter(d["verdict"] for d in mine.values())
    return {
        "team": m.teams[ti]["name"],
        "formation": m.teams[ti]["formation"],
        "style": m.teams[ti]["style"],
        "verdicts": {VERDICT_LABEL.get(k, k): v for k, v in verdicts.most_common()},
        "by_half": by_half,
        "best_decision_makers": [fmt(r) for r in ranked[:3]],
        "weakest_decision_makers": [fmt(r) for r in ranked[-3:][::-1]],
    }


def compare_players(player_a: str, player_b: str) -> dict:
    """Side-by-side decision profiles for two players."""
    a, b = player_report(player_a), player_report(player_b)
    for r in (a, b):
        r.pop("worst_moments", None)
    return {"a": a, "b": b}


TOOLS = [match_summary, key_moments, get_moment, search_decisions, player_report, team_report, compare_players]
