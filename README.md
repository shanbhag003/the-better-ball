# The Better Ball ⚽

> **Every pass is a decision. The Better Ball shows which one would have been better, and by how much.**

The Better Ball replays a (synthetic) football match and checks every on-ball decision.
For each pass it computes the probability that each available option would succeed and the
threat it would create, then compares the option the player chose with the best one available.
AI agents turn those numbers into plain-language explanations: tactical detail for coaches and
analysts, and a simple story for fans.

Built for the [Microsoft × Premier League "Inside the Game" Hackathon](https://github.com/microsoft/insidethegamehackathon).

---

## How it works

```
 ┌──────────────────────┐   tracking + events    ┌─────────────────────────┐
 │ Synthetic match      │ ─────────────────────▶ │ Decision engine         │
 │ engine (22 agents,   │   freeze frame at       │  • P(pass success)      │
 │ 10 Hz, bounded-      │   every pass & shot     │  • Expected Threat (xT) │
 │ rational decisions)  │                         │  • Expected Goals (xG)  │
 └──────────────────────┘                         │  • option ranking       │
                                                  └───────────┬─────────────┘
                                                              │ decisions.json
                                    ┌─────────────────────────▼─────────────────────────┐
                                    │ Agent layer (Microsoft Foundry / Agent Framework)  │
                                    │  Tactical Analyst · Narrator · Coach · Q&A         │
                                    └─────────────────────────┬─────────────────────────┘
                                                              │
                                                  ┌───────────▼───────────┐
                                                  │ Web app: animated     │
                                                  │ pitch, chosen vs best │
                                                  │ pass, decision report │
                                                  └───────────────────────┘
```

### 1. Synthetic match engine (`engine/betterball/sim`)
The hackathon requires synthetic data, so we built a match generator. 22 agent-players and a ball are
simulated at 10 Hz:
- **Team shape:** formations (4-3-3, 4-2-3-1) slide with the ball, hold a defensive line, and keep their lines compact out of possession.
- **Off-ball behaviour:** pressing, cover, partial man-marking, attacking runs in behind, and recovery runs.
- **Ball physics:** rolling resistance, lofted passes with flight arcs, interceptions, aerial duels, keepers claiming balls, and restarts.
- **Bounded rationality:** players choose with a noisy heuristic (lane openness, receiver space, progression) that differs from the analysis model, shaped by their own vision, risk appetite and passing skill. That gap is what makes "was there a better option?" a meaningful question.

Every pass and shot event carries a **freeze frame**: the positions and velocities of all 22 players at the moment the ball was played.

Typical 90-minute output: 1,500–1,650 passes at 73–84% completion, 12–19 shots and 1.2–2.3 xG per team, and scores like 2–2, 1–2 and 3–1.

### 2. Decision engine (`engine/betterball/analysis`)
| Model | What it does |
|---|---|
| **Pass success** (`pass_model.py`) | Physics-based time-to-intercept model, in the spirit of Spearman's pitch control. It combines execution accuracy, lane interception by every defender, and the race at the target, including a keeper's advantage in the box. |
| **Calibration** (`calibrate.py`) | Fits the model's physical parameters (reaction time, top speed, arrival uncertainty, …) to observed pass outcomes by minimising log-loss. It reports the Brier score and a reliability table on held-out passes. |
| **xT** (`xt.py`) | Smooth Expected Threat surface: how dangerous it is to have the ball at each location. |
| **xG** (`xg.py`) | Logistic model on distance, angle, defenders blocking the goal, and headers. |
| **Options** (`options.py`) | For each decision it scores passes to every teammate (to feet, and into space ahead of runners) plus a shot. `EV = P(success)·xT(target) − P(fail)·xT_against(turnover spot)`, and **decision cost = EV(best) − EV(chosen)**. |
| **Report** (`report.py`) | Per-player and per-team decision scores, "xT left on the table", and the key moments ranked by decision cost. |

Verdicts: `optimal` · `good` · `missed_progression` · `too_risky` · `should_shoot` · `should_pass`.

### 3. Pitch replay (`web/`)
A React app that replays the match on an animated 2D pitch:
- **Played pass:** a solid white arrow. **Better option:** a glowing dashed green arrow, each labelled with its success %.
- **Key moments:** the biggest missed chances, shown as amber markers on the timeline and as a list. A guided tour plays the build-up, pauses, and explains each one.
- **Decision card:** played option vs better option, showing chance the pass arrives, goal chance, and how much goal chance was missed.
- **Players tab:** each player's share of smart decisions. Click a player to see their own moments.
- First-run walkthrough, keyboard shortcuts, and a mobile layout.

### 4. Agents (in progress)
- **Tactical Analyst agent:** uses the decision engine as a tool (MCP) and finds the key moments.
- **Narrator agent:** explains each moment for an *analyst* or a *fan* audience.
- **Coach agent:** writes half-time and full-time decision reports per player.
- **Web app:** an animated 2D pitch showing the chosen pass (solid) and the better option (glowing dashed) with probabilities, plus a decision timeline.

---

## Quick start

```bash
cd engine
pip install -e ".[dev]"

# simulate a full match and analyse every decision
python -m betterball.cli run --seed 7 --outdir ../data

# (re)fit the pass model to simulated outcomes
python -m betterball.analysis.calibrate ../data/match_7.json ../data/match_11.json ../data/match_23.json

pytest

# export a replay bundle and run the web app
python -m betterball.cli export ../data/match_7.json ../data/analysis_7.json --out ../web/public/data/match_7.json
cd ../web && npm install && npm run dev
```

Outputs:
- `data/match_<seed>.json`: players, events (with freeze frames), and tracking at 5 fps
- `data/analysis_<seed>.json`: every decision with its top options, verdict and cost, plus team and player summaries and key moments

## Repository layout
```
engine/      Python: synthetic match engine + decision analysis
web/         React + Vite pitch replay (canvas)
agents/      Foundry agents (coming next)
data/        Generated matches (git-ignored)
```

## Data and fair play
All data is **synthetic**: fictional clubs (Northbridge Rovers, Harbour City) with generated player names.
No real match footage, tracking data, club or player identities are used.

## License
MIT
