"""Fit the pass model's physical parameters to observed pass outcomes.

    python -m betterball.analysis.calibrate ../data/match_7.json ../data/match_11.json

Minimises log-loss of predicted P(success) against what actually happened to
each pass, then writes ``pass_params.json`` next to the model together with
before/after Brier scores and a reliability table.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import fields
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

from .. import pitch
from .pass_model import PARAMS_FILE, PassParams, pass_success

# Parameters we fit, with bounds.
FIT = {
    "reaction": (0.2, 1.5),
    "max_speed": (4.0, 9.0),
    "sigma": (0.15, 1.2),
    "lane_control": (0.05, 1.0),
    "contest_bias": (-0.5, 0.8),
    "keeper_advantage": (0.0, 1.5),
    "exec_decay": (40.0, 600.0),
    "passer_clearance": (0.5, 4.0),
    "turn_rate": (1.0, 20.0),
    "blind_exec": (0.0, 0.8),
}


def load_passes(paths: list[Path]) -> list[dict]:
    rows = []
    for path in paths:
        match = json.loads(path.read_text(encoding="utf-8"))
        team = np.array([p["team_idx"] for p in match["players"]])
        is_gk = np.array([p["role"] == "GK" for p in match["players"]])
        for ev in match["events"]:
            if ev["type"] != "pass" or ev.get("outcome") not in ("complete", "intercepted", "out"):
                continue
            d = ev["attack_dir"]
            pos = pitch.to_attacking_frame(np.array(ev["freeze_frame"]["pos"], float), d)
            vel = np.array(ev["freeze_frame"]["vel"], float) * d
            opp = np.where(team != team[ev["player"]])[0]
            face = ev["freeze_frame"].get("face")
            rows.append({
                "face": None if face is None or ev.get("set_piece") else float(pitch.face_to_attacking_frame(face[ev["player"]], d)),
                "passer": pos[ev["player"]],
                "target": pitch.to_attacking_frame(np.array(ev["target"], float), d),
                "rpos": pos[ev["recipient"]],
                "rvel": vel[ev["recipient"]],
                "dpos": pos[opp],
                "dvel": vel[opp],
                "lofted": ev["lofted"],
                "keeper": int(np.where(is_gk[opp])[0][0]),
                "y": 1.0 if ev["outcome"] == "complete" else 0.0,
            })
    return rows


def predict(rows: list[dict], params: PassParams) -> np.ndarray:
    return np.array([
        pass_success(r["passer"], r["target"], r["rpos"], r["rvel"], r["dpos"], r["dvel"], r["lofted"], params,
                     keeper=r["keeper"], passer_face=r["face"]).p_success
        for r in rows
    ])


def reliability(p: np.ndarray, y: np.ndarray, bins: int = 10) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    out = []
    for b in range(bins):
        m = idx == b
        if m.sum():
            out.append({"bin": f"{edges[b]:.1f}-{edges[b + 1]:.1f}", "n": int(m.sum()),
                        "predicted": round(float(p[m].mean()), 3), "actual": round(float(y[m].mean()), 3)})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("matches", nargs="+", type=Path)
    ap.add_argument("--sample", type=int, default=2500)
    ap.add_argument("--out", type=Path, default=PARAMS_FILE)
    args = ap.parse_args(argv)

    rows = load_passes(args.matches)
    rng = np.random.default_rng(0)
    rng.shuffle(rows)
    split = int(len(rows) * 0.8)
    train, test = rows[:split][: args.sample], rows[split:]
    y_train = np.array([r["y"] for r in train])
    y_test = np.array([r["y"] for r in test])
    print(f"{len(rows)} passes ({len(train)} train, {len(test)} test), completion {np.mean([r['y'] for r in rows]):.3f}")

    base = PassParams()
    names = list(FIT)
    lo = np.array([FIT[n][0] for n in names])
    hi = np.array([FIT[n][1] for n in names])

    def unpack(z):
        vals = lo + (hi - lo) / (1 + np.exp(-z))
        return PassParams(**{**base.as_dict(), **dict(zip(names, vals))})

    def pack(params):
        v = np.array([getattr(params, n) for n in names])
        f = np.clip((v - lo) / (hi - lo), 1e-3, 1 - 1e-3)
        return np.log(f / (1 - f))

    def loss(z):
        p = np.clip(predict(train, unpack(z)), 1e-4, 1 - 1e-4)
        return float(-np.mean(y_train * np.log(p) + (1 - y_train) * np.log(1 - p)))

    p0 = predict(test, base)
    res = minimize(loss, pack(base), method="Nelder-Mead",
                   options={"maxiter": 400, "xatol": 1e-3, "fatol": 1e-5, "disp": False})
    fitted = unpack(res.x)
    p1 = predict(test, fitted)

    brier = lambda p, y: float(np.mean((p - y) ** 2))  # noqa: E731
    report = {
        "params": {f.name: round(float(getattr(fitted, f.name)), 4) for f in fields(PassParams)},
        "n_train": len(train),
        "n_test": len(test),
        "brier_before": round(brier(p0, y_test), 4),
        "brier_after": round(brier(p1, y_test), 4),
        "brier_baseline": round(brier(np.full_like(y_test, y_train.mean()), y_test), 4),
        "reliability": reliability(p1, y_test),
        "sources": [p.name for p in args.matches],
    }
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "reliability"}, indent=2))
    for r in report["reliability"]:
        print(f"  {r['bin']}: predicted {r['predicted']:.2f}  actual {r['actual']:.2f}  (n={r['n']})")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
