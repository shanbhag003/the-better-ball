"""Render the project thumbnail (docs/thumbnail.png).

An illustration of the idea, not a screenshot: a pitch in perspective, the
pass that was played (white) and the better option (neon green) cutting
through ringed defenders.

    python docs/make_thumbnail.py
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.patheffects as pe  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib import font_manager  # noqa: E402

W, H = 1920, 1080
OUT = Path(__file__).with_name("thumbnail.png")

PURPLE_DEEP = "#1a0020"
PURPLE = "#37003c"
GREEN = "#00ff85"
CYAN = "#04f5ff"
PINK = "#e90052"
RED = "#f25022"
BLUE = "#00a4ef"


def pick_font():
    names = {f.name for f in font_manager.fontManager.ttflist}
    for n in ("Segoe UI Variable Display", "Segoe UI", "Inter", "DejaVu Sans"):
        if n in names:
            return n
    return "sans-serif"


FONT = pick_font()


def homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.array(A))
    return vt[-1].reshape(3, 3)


# Attacking half of the pitch (x 45..105, y 0..68) seen from behind the attack:
# halfway line near the bottom, goal far away near the top.
SRC = [(45, 0), (105, 0), (105, 68), (45, 68)]
DST = [(2380, -120), (1770, 800), (1110, 800), (620, -120)]
Hm = homography(SRC, DST)


def P(x, y):
    v = Hm @ np.array([x, y, 1.0])
    return v[0] / v[2], v[1] / v[2]


def poly(points, n=40):
    out = []
    for a, b in zip(points[:-1], points[1:]):
        for t in np.linspace(0, 1, n):
            out.append(P(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return np.array(out)


def scale_at(x, y):
    """Approximate screen pixels per metre at a pitch point (for sizing)."""
    a = np.array(P(x, y))
    b = np.array(P(x, y + 1))
    return float(np.linalg.norm(b - a))


fig = plt.figure(figsize=(W / 100, H / 100), dpi=100)
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, W)
ax.set_ylim(0, H)
ax.axis("off")

# Background: purple gradient with soft pink and cyan glows.
yy, xx = np.mgrid[0:H:4, 0:W:4]
t = (xx / W * 0.6 + (H - yy) / H * 0.4)
c0 = np.array(matplotlib.colors.to_rgb(PURPLE_DEEP))
c1 = np.array(matplotlib.colors.to_rgb(PURPLE))
img = c0 * (1 - t[..., None]) + c1 * t[..., None]


def glow(cx, cy, r, color, strength):
    d = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r**2)))
    return d[..., None] * np.array(matplotlib.colors.to_rgb(color)) * strength


img = img + glow(200, 1000, 420, PINK, 0.35) + glow(1750, 150, 480, CYAN, 0.22) + glow(1300, 600, 520, GREEN, 0.06)
ax.imshow(np.clip(img, 0, 1), extent=[0, W, H, 0], origin="upper", zorder=0)

# Pitch surface (dark, translucent green) and mowing stripes.
surface = poly([(45, 0), (105, 0), (105, 68), (45, 68), (45, 0)], 2)
ax.fill(surface[:, 0], surface[:, 1], color="#0e3b26", alpha=0.55, zorder=1)
for k in range(0, 12, 2):
    x0, x1 = 45 + k * 5, 45 + (k + 1) * 5
    s = poly([(x0, 0), (x1, 0), (x1, 68), (x0, 68), (x0, 0)], 2)
    ax.fill(s[:, 0], s[:, 1], color="#ffffff", alpha=0.025, zorder=1)

LINE = dict(color="white", alpha=0.42, lw=2.2, zorder=2, solid_capstyle="round")


def draw(points, **kw):
    p = poly(points)
    ax.plot(p[:, 0], p[:, 1], **{**LINE, **kw})


draw([(45, 0), (105, 0), (105, 68), (45, 68)])
draw([(52.5, 0), (52.5, 68)])
draw([(105, 13.84), (88.5, 13.84), (88.5, 54.16), (105, 54.16)])
draw([(105, 24.84), (99.5, 24.84), (99.5, 43.16), (105, 43.16)])
# Centre circle (half) and penalty arc.
th = np.linspace(-np.pi / 2, np.pi / 2, 80)
cc = np.array([P(52.5 + 9.15 * np.cos(a), 34 + 9.15 * np.sin(a)) for a in th])
ax.plot(cc[:, 0], cc[:, 1], **LINE)
a0 = np.arccos(5.5 / 9.15)
th = np.linspace(np.pi - a0, np.pi + a0, 40)
arc = np.array([P(94 + 9.15 * np.cos(a), 34 + 9.15 * np.sin(a)) for a in th])
ax.plot(arc[:, 0], arc[:, 1], **LINE)
# Goal frame.
g = poly([(105, 30.34), (107.5, 30.34), (107.5, 37.66), (105, 37.66)], 10)
ax.plot(g[:, 0], g[:, 1], color="white", alpha=0.7, lw=2.5, zorder=2)

# Scene: passer, a safe option, the better runner, defenders in between.
passer = (62, 30)
safe_mate = (58, 50)       # sideways/back: the pass that was played
runner = (92, 40)          # in behind: the better option
beaten = [(72, 33), (76, 41), (80, 36)]
others_def = [(70, 52), (88, 22), (97, 31), (84, 55)]
mates = [(74, 12), (86, 58)]
keeper = (103, 34)


def player(xy, color, z=6, ring=None):
    s = scale_at(*xy)
    r = max(12, 0.95 * s)
    x, y = P(*xy)
    ax.add_patch(plt.Circle((x + 3, y - 5), r, color="black", alpha=0.35, zorder=z))
    ax.add_patch(plt.Circle((x, y), r, color=color, zorder=z + 1, ec=(0, 0, 0, 0.35), lw=2))
    if ring:
        ax.add_patch(plt.Circle((x, y), r + 9, fill=False, ec=ring, lw=3, ls=(0, (3, 3)), zorder=z + 1,
                                path_effects=[pe.withStroke(linewidth=8, foreground=ring, alpha=0.25)]))
    return x, y, r


def arrow(a, b, color, dashed=False, glow_w=0.0, lw=5):
    p = poly([a, b], 60)
    # Stop short of the receiver, then draw a head.
    p = p[: int(len(p) * 0.9)]
    effects = [pe.Stroke(linewidth=lw + glow_w, foreground=color, alpha=0.25), pe.Normal()] if glow_w else None
    ax.plot(p[:, 0], p[:, 1], color=color, lw=lw, ls=(0, (2.2, 1.6)) if dashed else "-",
            solid_capstyle="round", dash_capstyle="round", zorder=9, path_effects=effects)
    (x1, y1), (x0, y0) = p[-1], p[-6]
    ang = np.arctan2(y1 - y0, x1 - x0)
    hl = 30
    head = np.array([[x1 + np.cos(ang) * 10, y1 + np.sin(ang) * 10],
                     [x1 - np.cos(ang - 0.45) * hl, y1 - np.sin(ang - 0.45) * hl],
                     [x1 - np.cos(ang + 0.45) * hl, y1 - np.sin(ang + 0.45) * hl]])
    ax.fill(head[:, 0], head[:, 1], color=color, zorder=9, path_effects=effects)


for d in others_def:
    player(d, BLUE)
player(keeper, "#0b5c8a")
for m in mates:
    player(m, RED)
for d in beaten:
    player(d, BLUE, ring=GREEN)
player(safe_mate, RED)
rx, ry, rr = player(runner, RED, z=10)
px, py, pr = player(passer, RED, z=10)

# Ball at the passer's feet with a glow.
bx, by = P(passer[0] + 1.2, passer[1] - 0.6)
ax.add_patch(plt.Circle((bx, by), 9, color="white", zorder=12,
                        path_effects=[pe.withStroke(linewidth=14, foreground="white", alpha=0.25)]))

arrow(passer, safe_mate, "white", lw=5)
arrow(passer, runner, GREEN, dashed=True, glow_w=16, lw=6)

# Small value tags on the arrows (drawn as type, not UI chrome).
sx, sy = P(60, 41)
ax.text(sx, sy + 34, "38%", color="white", fontsize=28, fontweight="bold", family=FONT, ha="center", va="center",
        alpha=0.85, zorder=12)
gx, gy = P(91, 47)
ax.text(gx - 10, gy + 10, "72%", color=GREEN, fontsize=36, fontweight="bold", family=FONT, ha="right", va="bottom",
        zorder=12, path_effects=[pe.withStroke(linewidth=10, foreground=PURPLE_DEEP, alpha=0.8)])

# Title block.
ax.text(110, 700, "The Better", color="white", fontsize=104, fontweight="bold", family=FONT, va="bottom", zorder=20)
ax.text(110, 560, "Ball", color=GREEN, fontsize=104, fontweight="bold", family=FONT, va="bottom", zorder=20)
ax.text(116, 470, "Every pass is a decision.", color="white", fontsize=38, family=FONT, va="bottom", alpha=0.92,
        zorder=20)
ax.text(116, 410, "See the one that should have been made.", color="#d7c3dd", fontsize=28, family=FONT,
        va="bottom", zorder=20)

# Accent bar.
ax.add_patch(plt.Rectangle((116, 360), 120, 8, color=GREEN, zorder=20))
ax.add_patch(plt.Rectangle((244, 360), 40, 8, color=CYAN, zorder=20))
ax.add_patch(plt.Rectangle((292, 360), 20, 8, color=PINK, zorder=20))

# Soft vignette so the left text block stays readable over the pitch.
grad = np.linspace(1, 0, 400)[None, :]
ax.imshow(np.dstack([np.full((1, 400, 3), matplotlib.colors.to_rgb(PURPLE_DEEP)), grad[..., None] * 0.85]),
          extent=[0, 900, 0, H], aspect="auto", zorder=15)

fig.savefig(OUT, dpi=100, facecolor=PURPLE_DEEP)
print(f"wrote {OUT}")
