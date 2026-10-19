"""Evaluate every option a player had at the moment of a pass (or shot).

For each on-ball decision we score:
  * a pass to every teammate (to their feet, leading their run), plus a pass
    into the space in front of anyone already running forward;
  * a shot, when within range.

Each option gets an expected value in goal-probability units:

    EV(pass) = P(success) * xT(target) - P(fail) * xT_against(turnover spot)
    EV(shot) = xG

The decision cost is EV(best) - EV(chosen).
"""

from __future__ import annotations

import numpy as np

from .. import pitch
from .pass_model import flight_time, pass_success
from .xg import xg
from .xt import xt, xt_against

SHOT_RANGE = 32.0
SPACE_LEAD = 6.0  # metres ahead of a runner for a pass into space
MAX_SPACE_X = 98.0
BYPASS_CORRIDOR = 10.0  # m either side of the pass line
MIN_PROGRESS = 5.0      # m forward before a pass can beat anyone

# Decision-cost bands (goal-probability units)
OPTIMAL = 0.004
GOOD = 0.012
SAFER_MARGIN = 0.05  # success-probability edge needed to call an option "safer"


def _frame_arrays(event: dict, players: list[dict]):
    ff = event["freeze_frame"]
    attack_dir = event["attack_dir"]
    pos = pitch.to_attacking_frame(np.array(ff["pos"], float), attack_dir)
    vel = np.array(ff["vel"], float) * attack_dir  # mirroring flips both velocity components
    team = np.array([p["team_idx"] for p in players])
    is_gk = np.array([p["role"] == "GK" for p in players])
    return pos, vel, team, is_gk


def _beaten_mask(passer: np.ndarray, target: np.ndarray, outfield_opp: np.ndarray) -> np.ndarray:
    """Which outfield defenders the pass takes out of the game.

    A defender counts when they were goal-side of the ball before the pass,
    are behind the ball after it, and were close enough to the pass to matter
    (within ``BYPASS_CORRIDOR`` metres of its line). Sideways, diagonal-back
    and backward passes beat nobody.
    """
    progress = target[0] - passer[0]
    length = float(np.linalg.norm(target - passer))
    # Only clearly forward passes (within ~60 degrees of goal direction) beat anyone.
    if progress < MIN_PROGRESS or progress < 0.5 * length:
        return np.zeros(len(outfield_opp), dtype=bool)
    x = outfield_opp[:, 0]
    between = (x > passer[0] + 0.5) & (x < target[0] - 1.0)
    near_line = pitch.point_segment_distance(outfield_opp, passer, target) <= BYPASS_CORRIDOR
    return between & near_line


def _bypassed(passer: np.ndarray, target: np.ndarray, outfield_opp: np.ndarray) -> int:
    return int(_beaten_mask(passer, target, outfield_opp).sum())


def _score_pass(passer_xy, target, recv_idx, pos, vel, opp_idx, keeper, lofted=None):
    est = pass_success(passer_xy, target, pos[recv_idx], vel[recv_idx], pos[opp_idx], vel[opp_idx], lofted,
                       keeper=keeper)
    p = est.p_success
    turnover_spot = passer_xy + 0.6 * (target - passer_xy)
    gain = float(xt(target))
    loss = float(xt_against(turnover_spot))
    ev = p * gain - (1.0 - p) * loss
    threat = int(opp_idx[est.threat_defender]) if est.threat_defender is not None else None
    return est, ev, gain, loss, threat


def evaluate_decision(event: dict, players: list[dict]) -> dict:
    """Score all options for a pass/shot event. Returns a JSON-ready dict."""
    pos, vel, team, is_gk = _frame_arrays(event, players)
    me = event["player"]
    my_team = team[me]
    opp_idx = np.where(team != my_team)[0]
    mates = [j for j in np.where(team == my_team)[0] if j != me]
    passer_xy = pos[me]
    opp_out_idx = opp_idx[~is_gk[opp_idx]]
    opp_outfield = pos[opp_out_idx]

    def beaten(target):
        return [int(i) for i in opp_out_idx[_beaten_mask(passer_xy, target, opp_outfield)]]
    keeper = int(np.where(is_gk[opp_idx])[0][0]) if is_gk[opp_idx].any() else None
    xt_here = float(xt(passer_xy))

    options: list[dict] = []

    for j in mates:
        # Lead the receiver by their velocity over the ball's flight time.
        d0 = float(np.linalg.norm(pos[j] - passer_xy))
        lead = pitch.clamp_to_pitch(pos[j] + vel[j] * flight_time(d0), 1.0)
        lead[0] = min(lead[0], max(pos[j][0], MAX_SPACE_X))
        targets = [("feet", lead)]
        if vel[j][0] > 2.0 and not is_gk[j]:
            direction = vel[j] / (np.linalg.norm(vel[j]) + 1e-9)
            space = pitch.clamp_to_pitch(lead + direction * SPACE_LEAD, 1.0)
            # Balls played into the six-yard box are the keeper's — stop space passes short of it.
            space[0] = min(space[0], MAX_SPACE_X)
            if space[0] > lead[0] + 1.0:
                targets.append(("space", space))
        for kind, target in targets:
            est, ev, gain, loss, threat = _score_pass(passer_xy, target, j, pos, vel, opp_idx, keeper)
            options.append({
                "kind": "pass",
                "style": kind,
                "receiver": int(j),
                "target": pitch.from_attacking_frame(target, event["attack_dir"]).round(2).tolist(),
                **est.as_dict(),
                "xt_target": round(gain, 4),
                "xt_added": round(ev - xt_here, 4),
                "ev": round(ev, 4),
                "bypassed": len(beaten(target)),
                "beaten": beaten(target),
                "threat_defender": threat,
            })

    if float(pitch.distance_to_goal(passer_xy)[0]) <= SHOT_RANGE:
        shot_xg = xg(passer_xy, opp_outfield)
        options.append({
            "kind": "shot",
            "style": "shot",
            "receiver": None,
            "target": pitch.from_attacking_frame(pitch.GOAL_RIGHT, event["attack_dir"]).round(2).tolist(),
            "p_success": round(shot_xg, 4),
            "xt_target": round(shot_xg, 4),
            "xt_added": round(shot_xg - xt_here, 4),
            "ev": round(shot_xg, 4),
            "bypassed": 0,
            "beaten": [],
            "threat_defender": None,
        })

    # The option actually taken.
    if event["type"] == "shot":
        shot_xg = round(xg(passer_xy, opp_outfield, header=event.get("header", False)), 4)
        chosen = {
            "kind": "shot", "style": "header" if event.get("header") else "shot", "receiver": None,
            "target": event["target"], "p_success": shot_xg, "xt_target": shot_xg,
            "xt_added": round(shot_xg - xt_here, 4), "ev": shot_xg, "bypassed": 0, "beaten": [], "threat_defender": None,
        }
        # Re-heading/shooting is the same action — drop the duplicate footed-shot option.
        options = [o for o in options if o["kind"] != "shot"]
    else:
        target = pitch.to_attacking_frame(np.array(event["target"], float), event["attack_dir"])
        recv = event["recipient"]
        est, ev, gain, loss, threat = _score_pass(passer_xy, target, recv, pos, vel, opp_idx, keeper, event.get("lofted"))
        chosen = {
            "kind": "pass",
            "style": "chosen",
            "receiver": int(recv),
            "target": event["target"],
            **est.as_dict(),
            "xt_target": round(gain, 4),
            "xt_added": round(ev - xt_here, 4),
            "ev": round(ev, 4),
            "bypassed": len(beaten(target)),
                "beaten": beaten(target),
            "threat_defender": threat,
        }

    options.sort(key=lambda o: o["ev"], reverse=True)
    best = options[0] if options else chosen
    if best["ev"] < chosen["ev"]:
        best = chosen
    cost = max(0.0, best["ev"] - chosen["ev"])

    safe = [o for o in options if o["kind"] == "pass" and o["p_success"] >= 0.8]
    best_safe = max(safe, key=lambda o: o["ev"]) if safe else None

    if cost < OPTIMAL:
        verdict = "optimal"
    elif cost < GOOD:
        verdict = "good"
    elif best["kind"] == "shot":
        verdict = "should_shoot"
    elif chosen["kind"] == "shot":
        verdict = "should_pass"
    else:
        # Compare the two passes on both axes: how likely to arrive, how dangerous if it does.
        safer = best["p_success"] > chosen["p_success"] + SAFER_MARGIN
        sharper = best["xt_target"] > chosen["xt_target"]
        if safer and sharper:
            verdict = "clear_upgrade"       # better on both counts
        elif sharper:
            verdict = "missed_progression"  # played safe, a more dangerous pass was on
        elif safer:
            verdict = "too_risky"           # gambled on a long shot, a safer pass was worth more
        else:
            verdict = "suboptimal"

    return {
        "event_id": event["id"],
        "xt_start": round(xt_here, 4),
        "chosen": chosen,
        "best": best,
        "best_safe": best_safe,
        "decision_cost": round(cost, 4),
        "verdict": verdict,
        "top_options": options[:5],
        "n_options": len(options),
    }
