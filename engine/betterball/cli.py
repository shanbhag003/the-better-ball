"""Command line entry point.

    python -m betterball.cli simulate --seed 7 --out ../data/match_7.json
    python -m betterball.cli analyze ../data/match_7.json --out ../data/analysis_7.json
    python -m betterball.cli run --seed 7 --outdir ../data
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

from .analysis.report import analyze_match
from .sim import simulate


def _dump(obj, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")


def match_summary(match: dict) -> str:
    ev = match["events"]
    lines = [f"Score: {match['teams'][0]['name']} {match['meta']['score'][0]} - "
             f"{match['meta']['score'][1]} {match['teams'][1]['name']}"]
    for k, team in enumerate(match["teams"]):
        passes = [e for e in ev if e["type"] == "pass" and e["team_idx"] == k]
        comp = sum(e.get("outcome") == "complete" for e in passes)
        shots = [e for e in ev if e["type"] == "shot" and e["team_idx"] == k]
        xg = sum(e["xg"] for e in shots)
        lines.append(f"  {team['short']}: passes {len(passes)} ({100 * comp / max(len(passes), 1):.0f}% complete), "
                     f"shots {len(shots)}, xG {xg:.2f}")
    counts = Counter(e["type"] for e in ev)
    lines.append("  events: " + ", ".join(f"{k}={v}" for k, v in counts.most_common()))
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="betterball")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("simulate")
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--minutes", type=float, default=90)
    s.add_argument("--fps", type=int, default=5)
    s.add_argument("--out", type=Path, required=True)

    a = sub.add_parser("analyze")
    a.add_argument("match", type=Path)
    a.add_argument("--out", type=Path, required=True)

    r = sub.add_parser("run")
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--minutes", type=float, default=90)
    r.add_argument("--fps", type=int, default=5)
    r.add_argument("--outdir", type=Path, default=Path("data"))

    args = ap.parse_args(argv)

    if args.cmd in ("simulate", "run"):
        t0 = time.time()
        match = simulate(seed=args.seed, minutes=args.minutes, out_fps=args.fps)
        print(f"simulated {args.minutes} min in {time.time() - t0:.1f}s")
        print(match_summary(match))
        out = args.out if args.cmd == "simulate" else args.outdir / f"match_{args.seed}.json"
        _dump(match, out)
    if args.cmd == "analyze":
        match = json.loads(args.match.read_text(encoding="utf-8"))
    if args.cmd in ("analyze", "run"):
        t0 = time.time()
        report = analyze_match(match)
        print(f"analyzed {len(report['decisions'])} decisions in {time.time() - t0:.1f}s")
        for k, t in report["teams"].items():
            print(f"  team {k}: decision score {t['decision_score']}%, xT left on table {t['cost']}")
        out = args.out if args.cmd == "analyze" else args.outdir / f"analysis_{args.seed}.json"
        _dump(report, out)


if __name__ == "__main__":
    main()
