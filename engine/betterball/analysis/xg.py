"""Expected goals (xG) — a compact logistic model on distance, angle and blockers.

Coefficients are hand-calibrated to match public open-play xG benchmarks:
  ~0.55 from 5.5 m central, ~0.22 from the penalty spot,
  ~0.08 from the edge of the box, ~0.02 from 25 m.
"""

from __future__ import annotations

import numpy as np

from .. import pitch

INTERCEPT = -0.3
DIST_COEF = -0.16
ANGLE_COEF = 1.2
BLOCKER_COEF = -0.45
HEADER_FACTOR = 0.45  # headers convert at roughly half the rate of footed shots


def _blockers_in_cone(shooter: np.ndarray, defenders: np.ndarray) -> int:
    """Number of defenders inside the triangle shooter -> both posts."""
    if defenders is None or len(defenders) == 0:
        return 0
    a = shooter
    b = np.array([pitch.LENGTH, pitch.HALF_WIDTH - pitch.GOAL_WIDTH / 2])
    c = np.array([pitch.LENGTH, pitch.HALF_WIDTH + pitch.GOAL_WIDTH / 2])
    v0, v1 = c - a, b - a
    v2 = defenders - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    denom = d00 * d11 - d01 * d01
    if abs(denom) < 1e-9:
        return 0
    u = (d11 * d20 - d01 * d21) / denom
    v = (d00 * d21 - d01 * d20) / denom
    return int(np.sum((u >= 0) & (v >= 0) & (u + v <= 1)))


def xg(shooter_xy, defenders_xy: np.ndarray | None = None, header: bool = False) -> float:
    """xG of a shot from ``shooter_xy`` (attacking frame, goal at x = 105).

    ``defenders_xy`` should contain outfield defenders only — the keeper is
    baked into the base rate.
    """
    shooter = np.asarray(shooter_xy, dtype=float)
    dist = float(pitch.distance_to_goal(shooter)[0])
    angle = float(pitch.goal_opening_angle(shooter)[0])
    blockers = _blockers_in_cone(shooter, defenders_xy) if defenders_xy is not None else 0
    logit = INTERCEPT + DIST_COEF * dist + ANGLE_COEF * angle + BLOCKER_COEF * blockers
    value = 1.0 / (1.0 + np.exp(-logit))
    return float(value * (HEADER_FACTOR if header else 1.0))


def xg_surface(xy: np.ndarray) -> np.ndarray:
    """Vectorised unblocked xG for many points (used by the xT surface)."""
    xy = np.atleast_2d(np.asarray(xy, dtype=float))
    dist = pitch.distance_to_goal(xy)
    angle = pitch.goal_opening_angle(xy)
    logit = INTERCEPT + DIST_COEF * dist + ANGLE_COEF * angle
    return 1.0 / (1.0 + np.exp(-logit))
