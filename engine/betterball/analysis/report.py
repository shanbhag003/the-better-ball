"""Match-level decision report built on top of per-event option analysis."""

from __future__ import annotations

from collections import defaultdict

from .options import evaluate_decision
from .xt import grid as xt_grid


def analyze_match(match: dict, top_n: int = 15) -> dict:
    players = match["players"]
    decisions = []
    for ev in match["events"]:
        if ev["type"] not in ("pass", "shot") or "freeze_frame" not in ev:
            continue
        res = evaluate_decision(ev, players)
        res.update({
            "type": ev["type"],
            "t": ev["t"],
            "period": ev["period"],
            "player": ev["player"],
            "team_idx": ev["team_idx"],
            "outcome": ev.get("outcome"),
            "set_piece": ev.get("set_piece"),
        })
        decisions.append(res)

    per_player: dict[int, dict] = defaultdict(lambda: {"decisions": 0, "optimal": 0, "cost": 0.0, "ev": 0.0})
    per_team: dict[int, dict] = defaultdict(lambda: {"decisions": 0, "optimal": 0, "cost": 0.0, "passes": 0,
                                                     "completed": 0, "shots": 0, "xg": 0.0})
    for d in decisions:
        pp = per_player[d["player"]]
        tt = per_team[d["team_idx"]]
        for agg in (pp, tt):
            agg["decisions"] += 1
            agg["optimal"] += d["verdict"] in ("optimal", "good")
            agg["cost"] += d["decision_cost"]
        pp["ev"] += d["chosen"]["ev"]
        if d["type"] == "pass":
            tt["passes"] += 1
            tt["completed"] += d["outcome"] == "complete"
        else:
            tt["shots"] += 1
            tt["xg"] += d["chosen"]["ev"]

    def finish(agg):
        n = max(agg["decisions"], 1)
        out = dict(agg)
        out["decision_score"] = round(100 * agg["optimal"] / n, 1)
        out["cost"] = round(agg["cost"], 3)
        if "ev" in out:
            out["ev"] = round(out["ev"], 3)
        if "passes" in out:
            out["pass_completion"] = round(100 * agg["completed"] / max(agg["passes"], 1), 1)
            out["xg"] = round(agg["xg"], 2)
        return out

    # Key moments: open-play decisions with the largest decision cost.
    open_play = [d for d in decisions if not d["set_piece"]]
    key = sorted(open_play, key=lambda d: d["decision_cost"], reverse=True)[:top_n]

    return {
        "meta": match["meta"],
        "xt_grid": xt_grid(),
        "teams": {str(k): finish(v) for k, v in sorted(per_team.items())},
        "players": {str(k): finish(v) for k, v in sorted(per_player.items())},
        "key_moments": [d["event_id"] for d in key],
        "decisions": decisions,
    }
