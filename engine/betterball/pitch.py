"""Pitch geometry and coordinate helpers.

Coordinates are metres on a 105 x 68 pitch with the origin at the bottom-left
corner. Raw data keeps real pitch coordinates; analysis works in an
"attacking frame" where the team in possession always attacks towards x = 105.
"""

from __future__ import annotations

import numpy as np

LENGTH = 105.0
WIDTH = 68.0
HALF_LENGTH = LENGTH / 2
HALF_WIDTH = WIDTH / 2
GOAL_WIDTH = 7.32
PENALTY_AREA_DEPTH = 16.5
PENALTY_AREA_WIDTH = 40.3

CENTER = np.array([HALF_LENGTH, HALF_WIDTH])
GOAL_RIGHT = np.array([LENGTH, HALF_WIDTH])


def to_attacking_frame(xy: np.ndarray, attack_dir: int) -> np.ndarray:
    """Mirror coordinates so the attacking team always plays towards x = 105."""
    xy = np.asarray(xy, dtype=float)
    if attack_dir == 1:
        return xy.copy()
    out = xy.copy()
    out[..., 0] = LENGTH - out[..., 0]
    out[..., 1] = WIDTH - out[..., 1]
    return out


def from_attacking_frame(xy: np.ndarray, attack_dir: int) -> np.ndarray:
    """Inverse of :func:`to_attacking_frame` (the mirror is its own inverse)."""
    return to_attacking_frame(xy, attack_dir)


def goal_opening_angle(xy: np.ndarray) -> np.ndarray:
    """Angle (radians) subtended by the goal mouth at x = 105 from each point."""
    xy = np.atleast_2d(np.asarray(xy, dtype=float))
    post_a = np.array([LENGTH, HALF_WIDTH - GOAL_WIDTH / 2])
    post_b = np.array([LENGTH, HALF_WIDTH + GOAL_WIDTH / 2])
    va = post_a - xy
    vb = post_b - xy
    cos = (va * vb).sum(-1) / (np.linalg.norm(va, axis=-1) * np.linalg.norm(vb, axis=-1) + 1e-9)
    return np.arccos(np.clip(cos, -1.0, 1.0))


def distance_to_goal(xy: np.ndarray) -> np.ndarray:
    xy = np.atleast_2d(np.asarray(xy, dtype=float))
    return np.linalg.norm(GOAL_RIGHT - xy, axis=-1)


def in_bounds(xy: np.ndarray) -> bool:
    return 0.0 <= xy[0] <= LENGTH and 0.0 <= xy[1] <= WIDTH


def clamp_to_pitch(xy: np.ndarray, margin: float = 0.0) -> np.ndarray:
    out = np.array(xy, dtype=float)
    out[..., 0] = np.clip(out[..., 0], margin, LENGTH - margin)
    out[..., 1] = np.clip(out[..., 1], margin, WIDTH - margin)
    return out


def point_segment_distance(points: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Distance from each point to segment a-b."""
    points = np.atleast_2d(points)
    ab = b - a
    denom = float(ab @ ab)
    if denom < 1e-9:
        return np.linalg.norm(points - a, axis=-1)
    t = np.clip(((points - a) @ ab) / denom, 0.0, 1.0)
    proj = a + t[:, None] * ab
    return np.linalg.norm(points - proj, axis=-1)
