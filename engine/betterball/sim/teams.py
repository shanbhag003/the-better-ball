"""Fictional teams, formations and player attributes for the synthetic league.

All names are generated — no real clubs or players are used.
"""

from __future__ import annotations

import numpy as np

# Base positions in the attacking frame (team attacks towards x = 105) for an
# in-possession shape when the ball is on the centre spot. Facing +x, the
# right flank is low y.
FORMATIONS: dict[str, list[tuple[str, str, float, float]]] = {
    "4-3-3": [
        ("GK", "GK", 6, 34),
        ("RB", "DEF", 40, 7),
        ("RCB", "DEF", 31, 24),
        ("LCB", "DEF", 31, 44),
        ("LB", "DEF", 40, 61),
        ("DM", "MID", 45, 34),
        ("RCM", "MID", 56, 21),
        ("LCM", "MID", 56, 47),
        ("RW", "FWD", 70, 8),
        ("ST", "FWD", 73, 34),
        ("LW", "FWD", 70, 60),
    ],
    "4-2-3-1": [
        ("GK", "GK", 6, 34),
        ("RB", "DEF", 39, 7),
        ("RCB", "DEF", 30, 24),
        ("LCB", "DEF", 30, 44),
        ("LB", "DEF", 39, 61),
        ("RDM", "MID", 45, 26),
        ("LDM", "MID", 45, 42),
        ("RAM", "FWD", 64, 11),
        ("CAM", "MID", 62, 34),
        ("LAM", "FWD", 64, 57),
        ("ST", "FWD", 74, 34),
    ],
}

TEAMS = [
    {"name": "Northbridge Rovers", "short": "NBR", "formation": "4-3-3", "style": "possession",
     "risk": 0.30, "press": 0.65, "color": "#f25022"},
    {"name": "Harbour City", "short": "HBC", "formation": "4-2-3-1", "style": "direct",
     "risk": 0.50, "press": 0.55, "color": "#00a4ef"},
]

_FIRST = ["Ari", "Ben", "Cal", "Dario", "Eli", "Femi", "Gus", "Hugo", "Ivo", "Jonah", "Kai", "Luca",
          "Milo", "Nico", "Omar", "Pip", "Quinn", "Rafa", "Sami", "Theo", "Uri", "Vik", "Wes", "Yan", "Zeke",
          "Ade", "Bram", "Cas", "Dev", "Enzo"]
_LAST_A = ["Ash", "Brook", "Cole", "Dun", "Ever", "Fair", "Glen", "Hart", "Iver", "Kel", "Lang", "Mar",
           "North", "Oak", "Pen", "Rad", "Stan", "Thorn", "Wil", "Yard"]
_LAST_B = ["ford", "ley", "ton", "wood", "by", "well", "more", "ridge", "field", "stone", "worth", "dale"]


def _name(rng: np.random.Generator, used: set[str]) -> str:
    while True:
        n = f"{rng.choice(_FIRST)} {rng.choice(_LAST_A)}{rng.choice(_LAST_B)}"
        if n not in used:
            used.add(n)
            return n


def build_players(rng: np.random.Generator) -> list[dict]:
    """22 players: indices 0-10 home, 11-21 away. Index 0 / 11 are keepers."""
    used: set[str] = set()
    players: list[dict] = []
    numbers = {"GK": 1, "RB": 2, "LB": 3, "RCB": 5, "LCB": 6, "DM": 4, "RDM": 4, "LDM": 8,
               "RCM": 8, "LCM": 10, "CAM": 10, "RW": 7, "RAM": 7, "LW": 11, "LAM": 11, "ST": 9}
    for team_idx, team in enumerate(TEAMS):
        for slot, (pos_code, role, bx, by) in enumerate(FORMATIONS[team["formation"]]):
            g = lambda lo, hi: float(np.round(rng.uniform(lo, hi), 2))  # noqa: E731
            attrs = {
                "pace": g(6.6, 8.3) if role != "GK" else g(5.5, 6.5),
                "passing": g(0.55, 0.95) if role in ("MID",) else g(0.45, 0.85),
                "vision": g(0.5, 0.95) if role in ("MID", "FWD") else g(0.35, 0.8),
                "risk": float(np.clip(team["risk"] + rng.normal(0, 0.12) + (0.1 if role == "FWD" else 0.0), 0.05, 0.95)),
                "tackling": g(0.55, 0.95) if role in ("DEF", "MID") else g(0.25, 0.6),
                "finishing": g(0.55, 0.95) if role == "FWD" else g(0.2, 0.6),
                "composure": g(0.4, 0.95),
            }
            attrs["risk"] = round(attrs["risk"], 2)
            players.append({
                "idx": len(players),
                "team_idx": team_idx,
                "slot": slot,
                "number": numbers.get(pos_code, slot + 1),
                "name": _name(rng, used),
                "position": pos_code,
                "role": role,
                "base": [bx, by],
                "attrs": attrs,
            })
    return players
