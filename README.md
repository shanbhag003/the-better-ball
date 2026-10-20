# The Better Ball ⚽

> **Every pass is a decision. The Better Ball shows which one would have been better, and by how much.**

The Better Ball replays a (synthetic) football match and checks every on-ball decision.
For each pass it computes the probability that each available option would succeed and the
threat it would create, then compares the option the player chose with the best one available.
AI agents built with Microsoft Agent Framework on Microsoft Foundry turn those numbers into plain-language
explanations: tactical detail for coaches and analysts, a simple story for fans, in several languages.

Built for the [Microsoft × Premier League "Inside the Game" Hackathon](https://github.com/microsoft/insidethegamehackathon).

---

## How it works

```
 ┌──────────────────────┐   tracking + events    ┌─────────────────────────┐
 │ Synthetic match      │ ─────────────────────▶ │ Decision engine         │
 │ engine (22 simulated │   freeze frame at       │  • P(pass success)      │
 │ players, 10 Hz, rule-│   every pass & shot     │  • Expected Threat (xT) │
 │ based decisions)     │                         │  • Expected Goals (xG)  │
 └──────────────────────┘                         │  • option ranking       │
                                                  └───────────┬─────────────┘
                                                              │ decisions.json
                                    ┌─────────────────────────▼─────────────────────────┐
                                    │ AI agents: Microsoft Foundry + Agent Framework     │
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
The hackathon requires synthetic data, so we built a match generator. It simulates 22 players and a ball
at 10 Hz. The players are rule-based simulation entities, not AI or LLM agents:
- **Team shape:** formations (4-3-3, 4-2-3-1) slide with the ball, hold a defensive line, and keep their lines compact out of possession.
- **Off-ball behaviour:** pressing, cover, partial man-marking, attacking runs in behind, and recovery runs.
- **Ball physics:** rolling resistance, lofted passes with flight arcs, interceptions, aerial duels, keepers claiming balls, and restarts.
- **Laws of the game:** offside (Law 11) is called when the ball is played, giving an indirect free kick. Throw-ins, goal kicks and corners are exempt. Players usually spot a team-mate standing offside, but not always (about 4–5 offsides per match).
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
| **Offside** (`pitch.py`) | Team-mates in an offside position at the moment of the pass are never suggested as the better option, and a pass to one is rated *Offside*. |
| **Report** (`report.py`) | Per-player and per-team decision scores, "xT left on the table", and the key moments ranked by decision cost. |

Verdicts: `optimal` · `good` · `clear_upgrade` (the other pass was safer **and** more dangerous) · `missed_progression` (played safe) · `too_risky` (a gamble) · `should_shoot` · `should_pass` · `offside`.

### 3. Pitch replay (`web/`)
A React app that replays the match on an animated 2D pitch:
- **Played pass:** a solid white arrow. **Better option:** a glowing dashed green arrow, each labelled with its success %.
- **Key moments:** the biggest missed chances, shown as amber markers on the timeline and as a list. A guided tour plays the build-up, pauses, and explains each one.
- **Decision card:** played option vs better option, showing chance the pass arrives, goal chance, and how much goal chance was missed.
- **Players tab:** each player's share of good decisions. Click a player to see their own moments.
- First-run walkthrough, keyboard shortcuts, and a mobile layout.

### 4. Where AI is used

| Today | How |
|---|---|
| **Machine-learned pass model** | The pass model's physical parameters are *learned* from about 5,000 simulated passes by minimising log-loss (`calibrate.py`), then validated on held-out passes. Brier score 0.138 vs 0.160 for a constant baseline. |
| **Decision intelligence** | An algorithmic search over every option at every pass (expected value, threat, interception risk). This is analytics, not generative AI. |

| AI agents (Microsoft Foundry + Agent Framework, `service/`) | What it does |
|---|---|
| **MCP server** (`mcp_server.py`) | Exposes the decision engine as 7 tools (`match_summary`, `key_moments`, `get_moment`, `search_decisions`, `player_report`, `team_report`, `compare_players`) over streamable HTTP at `/mcp`. Any MCP client can use it, including the agents below and VS Code. |
| **Narrator agent** | **Explain** button on each decision card: turns the moment's facts into 3–4 sentences in *fan* or *analyst* voice, in 8 languages. |
| **Analyst → Narrator** (sequential workflow) | **Ask AI** tab: the Analyst calls the MCP tools to gather evidence, then the Narrator answers for the chosen audience. |
| **Attack coach ‖ Ball-security coach → Head coach** (concurrent workflow) | **AI coach report**: two specialists review the team in parallel; the head coach merges their notes into *What worked / Fix next / Player spotlight*. |

**Grounding:** agents may only use numbers returned by the tools; the prompts forbid inventing players, minutes or stats.
**Resilience:** if the primary deployment (gpt-4.1-mini) fails or is rate-limited, the API retries on a backup deployment (gpt-5-mini) and the UI badge says so. Tool calls are capped (12 calls, 90 s) so an agent can't loop.
**Offline mode:** without a Foundry model configured, the API returns clearly labelled template text, so the app still works.

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

# AI service: API + MCP server + agents (offline mode until Foundry is configured)
cd ../service && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
cp .env.example .env        # add FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_MODEL, then: az login
.venv/Scripts/uvicorn betterball_service.api:app --port 8000

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
service/     FastAPI + MCP server + Foundry agents (Agent Framework)
data/        Generated matches (git-ignored)
```

## Data and fair play
All data is **synthetic**: fictional clubs (Northbridge Rovers, Harbour City) with generated player names.
No real match footage, tracking data, club or player identities are used.

## License
MIT
