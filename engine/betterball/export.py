"""Compact replay bundle for the web app.

Tracking positions are stored as integers in decimetres to keep the file small.
"""

from __future__ import annotations

from .analysis.options import GOOD

EVENT_TYPES = {"pass", "shot", "goal", "tackle", "interception", "save", "kickoff", "offside"}


def _opt(o: dict | None) -> dict | None:
    if not o:
        return None
    return {
        "kind": o["kind"],
        "style": o["style"],
        "receiver": o.get("receiver"),
        "target": o.get("target"),
        "p": o.get("p_success"),
        "xt": o.get("xt_target"),
        "ev": o["ev"],
        "bypassed": o.get("bypassed", 0),
        "lofted": bool(o.get("lofted")),
        "beaten": o.get("beaten", []),
        "threat": o.get("threat_defender"),
        "off_body": o.get("off_body", 0),  # degrees between the passer's body and the ball
        "turn": o.get("turn_time", 0),  # s to open up before playing it
    }


def build_bundle(match: dict, report: dict) -> dict:
    frames = match["tracking"]
    t0 = frames[0][0]
    # Columns: period, ball_x, ball_y, ball_z, 22 x (x, y) — all * 10 as ints.
    packed = []
    for row in frames:
        packed.append([int(row[1])] + [int(round(v * 10)) for v in row[2:]])

    events = []
    for e in match["events"]:
        if e["type"] not in EVENT_TYPES:
            continue
        ev = {"id": e["id"], "type": e["type"], "t": e["t"], "player": e["player"], "team": e["team_idx"]}
        for k in ("outcome", "receiver", "recipient", "xg", "header", "score", "set_piece"):
            if k in e:
                ev[k] = e[k]
        if "start" in e:
            ev["start"] = e["start"]
        if "end" in e:
            ev["end"] = e["end"]
        events.append(ev)

    decisions = {}
    for d in report["decisions"]:
        decisions[str(d["event_id"])] = {
            "t": d["t"],
            "type": d["type"],
            "player": d["player"],
            "team": d["team_idx"],
            "verdict": d["verdict"],
            "cost": d["decision_cost"],
            "xt_start": d["xt_start"],
            "outcome": d["outcome"],
            "set_piece": d.get("set_piece"),
            "chosen": _opt(d["chosen"]),
            "best": _opt(d["best"]),
            "alts": [_opt(o) for o in d["top_options"][:3]],
            "offside_line": d.get("offside_line"),
            "offside_players": d.get("offside_players", []),
            "face": d.get("face"),  # passer's body orientation (raw radians), None at set pieces
        }

    players = [{
        "idx": p["idx"], "team": p["team_idx"], "number": p["number"], "name": p["name"],
        "position": p["position"], "role": p["role"],
    } for p in match["players"]]

    return {
        "meta": {**match["meta"], "t0": t0, "duration": frames[-1][0] - t0, "good_threshold": GOOD},
        "teams": [{k: t[k] for k in ("idx", "name", "short", "formation", "style", "color")} for t in match["teams"]],
        "players": players,
        "frames": packed,
        "events": events,
        "decisions": decisions,
        "key_moments": report["key_moments"],
        "team_stats": report["teams"],
        "player_stats": report["players"],
    }
