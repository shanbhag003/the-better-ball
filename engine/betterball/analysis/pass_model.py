"""Physics-based pass success probability.

A pass from P to target T succeeds if
  1. it is executed accurately (falls off with distance and pressure),
  2. no defender can reach the ball's path before the ball gets there, and
  3. the intended receiver wins the race to T against nearby defenders.

Defender reach times follow the time-to-intercept idea from Spearman's
pitch-control model: react for ``reaction`` seconds while drifting with current
velocity, then run in a straight line at ``max_speed``. Races are turned into
probabilities with a logistic on the time margin.

The physical parameters are fitted to observed pass outcomes by
``python -m betterball.analysis.calibrate`` and stored in ``pass_params.json``.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

LOFT_DISTANCE = 35.0     # passes longer than this are lofted by default
BLOCK_RADIUS = 2.0       # m: defenders this close to the ball's path need no reaction time
PARAMS_FILE = Path(__file__).with_name("pass_params.json")


@dataclass
class PassParams:
    reaction: float = 0.7           # s, defender reaction time
    receiver_reaction: float = 0.3  # s, receiver is expecting the ball
    max_speed: float = 7.0          # m/s
    sigma: float = 0.45             # s, uncertainty in arrival time
    lane_control: float = 0.75      # chance a defender who reaches a moving ball controls it
    contest_bias: float = 0.0       # s, receiver head start in the race for the ball
    exec_decay: float = 120.0       # m, execution accuracy length scale
    pressure_penalty: float = 0.12  # execution loss under full pressure
    passer_clearance: float = 1.0   # m of path next to the passer that cannot be cut out
    keeper_advantage: float = 0.5   # s, a keeper can use his hands inside the box

    @classmethod
    def load(cls, path: Path = PARAMS_FILE) -> "PassParams":
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            return cls(**{k: v for k, v in data.get("params", data).items() if k in cls.__dataclass_fields__})
        return cls()

    def as_dict(self) -> dict:
        return asdict(self)


PARAMS = PassParams.load()


def ball_speed(distance: float) -> float:
    """Average ground-pass speed (m/s) for a pass of ``distance`` metres."""
    return float(np.clip(8.0 + 0.5 * distance, 10.0, 24.0))


def flight_time(distance: float, lofted: bool | None = None) -> float:
    if lofted is None:
        lofted = distance > LOFT_DISTANCE
    v = ball_speed(distance) * (0.8 if lofted else 1.0)
    return distance / v


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -50, 50)))


@dataclass
class PassEstimate:
    p_success: float
    p_execution: float
    p_lane: float
    p_contest: float
    flight_time: float
    lofted: bool
    threat_defender: int | None  # index into the defenders array most likely to stop it

    def as_dict(self) -> dict:
        return {
            "p_success": round(self.p_success, 4),
            "p_execution": round(self.p_execution, 4),
            "p_lane": round(self.p_lane, 4),
            "p_contest": round(self.p_contest, 4),
            "flight_time": round(self.flight_time, 2),
            "lofted": self.lofted,
        }


def pass_success(
    passer: np.ndarray,
    target: np.ndarray,
    receiver_pos: np.ndarray,
    receiver_vel: np.ndarray,
    defenders_pos: np.ndarray,
    defenders_vel: np.ndarray,
    lofted: bool | None = None,
    params: PassParams | None = None,
    keeper: int | None = None,
) -> PassEstimate:
    pp = params or PARAMS
    coef = np.pi / (np.sqrt(3.0) * pp.sigma)
    passer = np.asarray(passer, float)
    target = np.asarray(target, float)
    d = float(np.linalg.norm(target - passer))
    if lofted is None:
        lofted = d > LOFT_DISTANCE
    if d < 1.0:
        return PassEstimate(0.99, 0.99, 1.0, 1.0, 0.0, lofted, None)

    T = flight_time(d, lofted)

    # Points along the ball's path, skipping the stretch at the passer's feet.
    n = max(6, int(d))
    k = np.linspace(0.0, 1.0, n + 1)[1:]
    k = k[k * d >= pp.passer_clearance]
    if len(k) == 0:
        k = np.array([1.0])
    path = passer + k[:, None] * (target - passer)
    t_ball = k * T

    drift = defenders_pos + defenders_vel * pp.reaction
    dist = np.linalg.norm(path[None, :, :] - drift[:, None, :], axis=-1)  # (n_def, n_pts)
    # A defender already standing in the lane just blocks it: reaction time only
    # matters for points they have to move to reach.
    raw = np.linalg.norm(path[None, :, :] - defenders_pos[:, None, :], axis=-1)
    t_def = pp.reaction * np.clip(raw / BLOCK_RADIUS, 0.0, 1.0) + dist / pp.max_speed

    # 1) Lane interception — every point except the final contest point.
    lane_mask = k < 0.97
    if lofted:
        # A lofted ball can only be cut out shortly after it is struck.
        lane_mask &= k < 0.15
    if lane_mask.any():
        margin = (t_ball[None, lane_mask] - t_def[:, lane_mask]).max(axis=1)
        p_lane_each = pp.lane_control * _sigmoid(coef * margin)
    else:
        p_lane_each = np.zeros(len(defenders_pos))
    p_lane = float(np.prod(1.0 - p_lane_each))

    # 3) Contest at the target: ball must arrive AND the receiver must get there.
    r_drift = receiver_pos + receiver_vel * pp.receiver_reaction
    t_recv = pp.receiver_reaction + np.linalg.norm(target - r_drift) / pp.max_speed
    arrival = max(T, t_recv) - pp.contest_bias
    t_def_target = pp.reaction + np.linalg.norm(target - drift, axis=-1) / pp.max_speed
    if keeper is not None and target[0] > 88.5 and abs(target[1] - 34.0) < 20.15:
        t_def_target[keeper] -= pp.keeper_advantage
    # Aerial duels are noisier than races on the ground: widen the uncertainty.
    p_contest_each = _sigmoid((coef / 2 if lofted else coef) * (arrival - t_def_target))
    p_contest = float(np.prod(1.0 - p_contest_each))

    # 2) Execution — longer and pressured passes are less accurate.
    nearest = float(np.min(np.linalg.norm(defenders_pos - passer, axis=-1))) if len(defenders_pos) else 99.0
    pressure = np.clip((3.0 - nearest) / 3.0, 0.0, 1.0)
    p_exec = float(np.exp(-d / pp.exec_decay) * (0.88 if lofted else 1.0) * (1.0 - pp.pressure_penalty * pressure))

    threat = 1.0 - (1.0 - p_lane_each) * (1.0 - p_contest_each)
    threat_idx = int(np.argmax(threat)) if len(threat) and threat.max() > 0.05 else None

    return PassEstimate(
        p_success=p_exec * p_lane * p_contest,
        p_execution=p_exec,
        p_lane=p_lane,
        p_contest=p_contest,
        flight_time=T,
        lofted=bool(lofted),
        threat_defender=threat_idx,
    )
