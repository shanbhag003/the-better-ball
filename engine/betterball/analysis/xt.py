"""Expected Threat (xT): the value of having the ball at a location.

xT(x, y) ~= probability that a possession at (x, y) ends in a goal within the
next few actions. We use a smooth parametric surface that mirrors the shape of
published 12x8 xT grids (~0.005 in your own half, ~0.02 at 30 m, ~0.07 at the
edge of the box, ~0.18 around the penalty spot, soft-capped at 0.4). It is defined in the
attacking frame (goal at x = 105).
"""

from __future__ import annotations

import numpy as np

from .. import pitch
from .xg import xg_surface

BASE = 0.005
PROGRESSION = 0.012
SHOT_WEIGHT = 0.85
CEILING = 0.4  # published grids top out around 0.3-0.4 even right in front of goal


def xt(xy) -> np.ndarray | float:
    arr = np.asarray(xy, dtype=float)
    pts = np.atleast_2d(arr)
    x_frac = np.clip(pts[:, 0] / pitch.LENGTH, 0.0, 1.0)
    value = BASE + PROGRESSION * x_frac**2 + SHOT_WEIGHT * xg_surface(pts)
    value = CEILING * np.tanh(value / CEILING)  # soft cap
    # Off-pitch locations have no value.
    off = (pts[:, 0] < 0) | (pts[:, 0] > pitch.LENGTH) | (pts[:, 1] < 0) | (pts[:, 1] > pitch.WIDTH)
    value = np.where(off, 0.0, value)
    return float(value[0]) if arr.ndim == 1 else value


def xt_against(xy) -> np.ndarray | float:
    """Threat the *opponent* would have if they won the ball at ``xy``."""
    arr = np.asarray(xy, dtype=float)
    mirrored = arr.copy()
    mirrored[..., 0] = pitch.LENGTH - mirrored[..., 0]
    mirrored[..., 1] = pitch.WIDTH - mirrored[..., 1]
    return xt(mirrored)


def grid(nx: int = 12, ny: int = 8) -> list[list[float]]:
    """xT sampled at cell centres — handy for the UI heatmap."""
    xs = (np.arange(nx) + 0.5) * pitch.LENGTH / nx
    ys = (np.arange(ny) + 0.5) * pitch.WIDTH / ny
    gx, gy = np.meshgrid(xs, ys)
    vals = xt(np.stack([gx.ravel(), gy.ravel()], axis=1)).reshape(ny, nx)
    return np.round(vals, 4).tolist()
