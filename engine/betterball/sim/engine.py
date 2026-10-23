"""Agent-based synthetic match engine.

Simulates 22 players and a ball at 10 Hz and emits:
  * tracking frames (every player + ball position),
  * an event log (passes, shots, pressures, tackles, interceptions, goals...),
    where every pass and shot carries a "freeze frame" of all 22 positions and
    velocities — exactly what the analysis engine needs.

Players decide with *bounded rationality*: a simple, noisy heuristic (lane
openness, receiver space, progression, personal risk appetite, vision range)
that is deliberately different from the analysis model. That gap is what makes
"was there a better option?" a meaningful question.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .. import pitch
from ..analysis.xg import xg as xg_model
from .teams import FORMATIONS, TEAMS, build_players

DT = 0.1
ACCEL = 5.0          # m/s^2
JOG = 4.2            # m/s, default shape-keeping speed
BALL_DECEL = 3.0     # m/s^2, rolling resistance
CONTROL_R = 1.0
# Body orientation: how fast players turn and what they can see.
TURN_ON_BALL = 3.0    # rad/s, turning with the ball
TURN_PRESSED = 1.6    # rad/s, with a defender tight (hard to turn)
TURN_OFF_BALL = 4.5   # rad/s, without the ball
FOV = 2.1             # rad: options within ~120 degrees of the body are seen
OPEN_BODY = 1.2       # rad: beyond ~70 degrees off the body, a pass has to be wrapped round
GOAL_HALF = pitch.GOAL_WIDTH / 2


@dataclass
class Flight:
    passer: int
    recipient: int | None
    target: np.ndarray
    lofted: bool
    start: np.ndarray
    length: float
    event: dict
    kind: str = "pass"   # "pass" | "shot"
    shot_result: str | None = None
    landed: bool = False


@dataclass
class State:
    t: float = 0.0
    period: int = 1
    ball: np.ndarray = field(default_factory=lambda: pitch.CENTER.copy())
    ball_v: np.ndarray = field(default_factory=lambda: np.zeros(2))
    ball_z: float = 0.0
    mode: str = "owned"       # owned | flight | loose | dead | pause
    owner: int | None = None
    poss_team: int = 0
    last_touch: int | None = None
    received_air_at: float = -99.0  # time the owner controlled a lofted ball
    flight: Flight | None = None
    decide_at: float = 0.0
    dead_taker: int | None = None
    dead_kind: str | None = None
    pause_until: float = 0.0
    no_touch: dict = field(default_factory=dict)   # player -> time until they may touch the ball
    stunned: dict = field(default_factory=dict)
    runs: dict = field(default_factory=dict)       # player -> (until, lane_y)
    pressured: set = field(default_factory=set)
    spell_id: int = 0


def same_team_pass(f, team, i) -> bool:
    return f is not None and team[i] == team[f.passer]


class MatchEngine:
    def __init__(self, seed: int = 7, minutes: float = 90.0, out_fps: int = 5):
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        self.minutes = minutes
        self.out_every = max(1, int(round(1 / (DT * out_fps))))
        self.out_fps = out_fps
        self.players = build_players(self.rng)
        self.n = len(self.players)
        self.team = np.array([p["team_idx"] for p in self.players])
        self.is_gk = np.array([p["role"] == "GK" for p in self.players])
        self.base = np.array([p["base"] for p in self.players], float)
        self.pace = np.array([p["attrs"]["pace"] for p in self.players])
        self.pos = np.zeros((self.n, 2))
        self.vel = np.zeros((self.n, 2))
        self.noise = np.zeros((self.n, 2))
        self.face = np.zeros(self.n)  # body orientation, radians in raw pitch coordinates
        self.attack_dir = [1, -1]
        self.s = State()
        self.events: list[dict] = []
        self.frames: list[list[float]] = []
        self.score = [0, 0]

    # ------------------------------------------------------------------ utils
    def a(self, attr: str, i: int) -> float:
        return self.players[i]["attrs"][attr]

    def att(self, xy, team: int):
        return pitch.to_attacking_frame(xy, self.attack_dir[team])

    def raw(self, xy, team: int):
        return pitch.from_attacking_frame(xy, self.attack_dir[team])

    def mates(self, i: int):
        return [j for j in range(self.n) if self.team[j] == self.team[i] and j != i]

    def opps(self, team: int):
        return np.where(self.team != team)[0]

    def log(self, etype: str, player: int | None, **kw) -> dict:
        ev = {
            "id": len(self.events),
            "type": etype,
            "period": self.s.period,
            "t": round(self.s.t, 1),
            "player": int(player) if player is not None else None,
            "team_idx": int(self.team[player]) if player is not None else kw.pop("team_idx", None),
        }
        ev.update(kw)
        self.events.append(ev)
        return ev

    def freeze(self) -> dict:
        return {"pos": np.round(self.pos, 2).tolist(), "vel": np.round(self.vel, 2).tolist(),
                "face": np.round(self.face, 3).tolist()}

    def angle_off(self, i: int, target_raw: np.ndarray) -> float:
        return pitch.angle_off_body(self.face[i], self.pos[i], target_raw)

    # ------------------------------------------------------------- set pieces
    def kickoff(self, team: int):
        for i in range(self.n):
            t = self.team[i]
            b = self.base[i].copy()
            x = 2 + b[0] * 0.62
            y = 34 + (b[1] - 34) * 0.85
            x = min(x, 50.5 if t == team else 43.0)
            self.pos[i] = self.raw(np.array([x, y]), t)
        self.vel[:] = 0
        self.face[:] = [0.0 if self.attack_dir[t] == 1 else np.pi for t in self.team]
        striker = next(i for i in range(self.n) if self.team[i] == team and self.players[i]["position"] == "ST")
        self.pos[striker] = pitch.CENTER + np.array([-0.6 * self.attack_dir[team], 0])
        self.s.ball = pitch.CENTER.copy()
        self.s.ball_v[:] = 0
        self.s.ball_z = 0
        self.gain(striker, quiet=True)
        self.s.decide_at = self.s.t + 1.0
        self.log("kickoff", striker, start=self.s.ball.round(2).tolist())

    def gain(self, i: int, quiet: bool = False):
        s = self.s
        s.mode = "owned"
        s.owner = i
        s.poss_team = int(self.team[i])
        s.last_touch = int(self.team[i])
        s.flight = None
        s.pressured = set()
        s.spell_id += 1
        s.ball_v[:] = 0
        s.ball_z = 0
        pressured = self.nearest_opp_dist(i) < 4.0
        hold = 0.5 + self.rng.exponential(0.5) if pressured else 1.1 + self.rng.exponential(1.0)
        s.decide_at = s.t + hold
        if self.is_gk[i]:
            s.decide_at = s.t + 2.5  # keeper takes his time; opponents drop off
        s.dead_kind = None

    def nearest_opp_dist(self, i: int) -> float:
        o = self.opps(self.team[i])
        return float(np.min(np.linalg.norm(self.pos[o] - self.pos[i], axis=1)))

    def go_dead(self, kind: str, team: int, spot: np.ndarray):
        s = self.s
        s.mode = "dead"
        s.owner = None
        s.flight = None
        s.poss_team = team
        s.dead_kind = kind
        s.ball = spot.copy()
        s.ball_v[:] = 0
        s.ball_z = 0
        if kind == "goal_kick":
            taker = next(i for i in range(self.n) if self.team[i] == team and self.is_gk[i])
        else:
            cands = [i for i in range(self.n) if self.team[i] == team and not self.is_gk[i]]
            taker = min(cands, key=lambda i: np.linalg.norm(self.pos[i] - spot))
        s.dead_taker = taker
        self.log(kind, None, team_idx=team, start=spot.round(2).tolist())

    def ball_out(self):
        s = self.s
        b = s.ball
        last = s.last_touch if s.last_touch is not None else s.poss_team
        restart = 1 - last
        if 0 <= b[0] <= pitch.LENGTH:
            spot = np.array([np.clip(b[0], 1, pitch.LENGTH - 1), 0.2 if b[1] < 0 else pitch.WIDTH - 0.2])
            self.go_dead("throw_in", restart, spot)
            return
        # Over a goal line: whose goal is it?
        goal_line_x = 0.0 if b[0] < 0 else pitch.LENGTH
        defending = 0 if self.raw(np.array([0.0, 34.0]), 0)[0] == goal_line_x else 1
        if last == defending:
            spot = np.array([0.5 if b[0] < 0 else pitch.LENGTH - 0.5, 0.5 if b[1] < 34 else pitch.WIDTH - 0.5])
            self.go_dead("corner", 1 - defending, spot)
        else:
            self.go_dead("goal_kick", defending, self.raw(np.array([5.5, 34.0]), defending))

    # --------------------------------------------------------------- targets
    def team_targets(self, team: int):
        s = self.s
        idx = np.where(self.team == team)[0]
        P = self.att(self.pos, team)
        B = self.att(s.ball, team)
        base = self.base[idx]
        in_poss = s.poss_team == team and s.mode != "loose"
        tgt = np.zeros((len(idx), 2))
        cap = np.full(len(idx), JOG)
        opp = self.opps(team)

        if in_poss:
            # Shape slides with the ball but keeps its structure in deep build-up.
            tgt[:, 0] = np.maximum(base[:, 0] + (B[0] - 52.5) * 0.6, 4 + (base[:, 0] - 6) * 0.35)
            tgt[:, 1] = 34 + (base[:, 1] - 34) * 1.0 + (B[1] - 34) * 0.2
            # Shape cannot run beyond the opponents' second-last defender (offside line).
            opp_x = np.sort(P[opp, 0])[::-1]
            line = max(opp_x[1], B[0], 52.5)
            tgt[:, 0] = np.minimum(tgt[:, 0], line - 0.5)
        else:
            # Compact block: the back line holds a depth set by the ball, the
            # other lines keep fixed distances in front of it.
            press = TEAMS[team]["press"]
            back_line = float(np.clip(B[0] - 14 + 6 * press, 7, 42 + 8 * press))
            # Never leave an attacker in behind: the line drops to cover the deepest one.
            outfield_opp = opp[~self.is_gk[opp]]
            back_line = max(4.0, min(back_line, float(P[outfield_opp, 0].min()) - 1.5))
            tgt[:, 0] = back_line + (base[:, 0] - 31) * 0.65
            tgt[:, 1] = 34 + (base[:, 1] - 34) * 0.65 + (B[1] - 34) * 0.4
            # Partial man-marking: blend zone with goal-side of the nearest attacker.
            for k, i in enumerate(idx):
                if self.is_gk[i]:
                    continue
                d = np.linalg.norm(P[opp] - tgt[k], axis=1)
                j = int(np.argmin(d))
                if d[j] < 10:
                    mark = P[opp[j]] + np.array([-2.5, (34 - P[opp[j], 1]) * 0.05])
                    w = 0.65 if B[0] < 35 else 0.4  # tighter marking near our own goal
                    tgt[k] = (1 - w) * tgt[k] + w * mark

        tgt += self.noise[idx]

        # Keeper: on the line between ball and own goal.
        for k, i in enumerate(idx):
            if self.is_gk[i]:
                g = np.array([0.5, 34.0])
                v = B - g
                dist = np.linalg.norm(v) + 1e-9
                tgt[k] = g + v / dist * min(8.0, dist * 0.12) if B[0] < 60 else g + np.array([min(16.0, (B[0] - 30) * 0.2), (B[1] - 34) * 0.1])

        # Attacking runs.
        if in_poss and s.mode in ("owned", "flight"):
            opp_x = np.sort(P[opp, 0])[::-1]
            line = opp_x[1]
            for k, i in enumerate(idx):
                if i == s.owner or self.is_gk[i]:
                    continue
                role = self.players[i]["role"]
                if i in s.runs:
                    until, lane = s.runs[i]
                    if s.t > until:
                        del s.runs[i]
                    else:
                        tgt[k] = [min(line + 10, 94), lane]
                        cap[k] = self.pace[i]
                        continue
                p_run = {"FWD": 0.015, "MID": 0.006, "DEF": 0.002}.get(role, 0) * (0.6 + self.a("risk", i))
                if B[0] > 35 and P[i, 0] < line + 1 and self.rng.random() < p_run:
                    lane = float(np.clip(P[i, 1] + self.rng.normal(0, 6) + (34 - P[i, 1]) * 0.25, 4, 64))
                    s.runs[i] = (s.t + self.rng.uniform(2.0, 3.5), lane)

        # Out of possession: press the ball.
        keeper_has_it = s.mode == "owned" and s.owner is not None and self.is_gk[s.owner]
        if not in_poss and s.mode in ("owned", "dead") and not keeper_has_it:
            out = [k for k, i in enumerate(idx) if not self.is_gk[i]]
            d = np.array([np.linalg.norm(P[idx[k]] - B) for k in out])
            order = np.argsort(d)
            first, second = out[order[0]], out[order[1]]
            press = TEAMS[team]["press"]
            if s.mode == "dead":
                tgt[first] = B + np.array([-7.0, 0.0])
            elif d[order[0]] < 8 + 10 * press or B[0] < 30:
                tgt[first] = B + np.array([-0.8, 0.0])
                cap[first] = self.pace[idx[first]] * (0.8 + 0.2 * press)
            cover = B + (np.array([0.0, 34.0]) - B) / (np.linalg.norm(np.array([0.0, 34.0]) - B) + 1e-9) * 6
            if B[0] < 30 and s.mode == "owned":
                tgt[second] = B + np.array([-1.5, 0.0])  # double up near our box
                cap[second] = self.pace[idx[second]]
            else:
                tgt[second] = cover
            cap[second] = 6.0

        # Loose ball or ball in flight: chase / intercept.
        if s.mode == "loose":
            d = np.linalg.norm(P[idx] - B, axis=1)
            for k in np.argsort(d)[:2]:
                tgt[k] = B
                cap[k] = self.pace[idx[k]]
        if s.mode == "flight" and s.flight is not None:
            f = s.flight
            T = self.att(f.target, team)
            if team == self.team[f.passer]:
                if f.recipient is not None and f.kind == "pass":
                    k = int(np.where(idx == f.recipient)[0][0])
                    tgt[k] = T
                    cap[k] = self.pace[f.recipient]
            elif f.kind == "pass":
                # Defenders who can get to the ball's remaining path go for it.
                remaining = [B, T]
                cand = []
                for k, i in enumerate(idx):
                    dd = pitch.point_segment_distance(P[i][None], remaining[0], remaining[1])[0]
                    cand.append((dd, k))
                cand.sort()
                # The defender closest to the target attacks the reception.
                dt_ = np.linalg.norm(P[idx] - T, axis=1)
                kt = int(np.argmin(dt_))
                if dt_[kt] < 8:
                    tgt[kt] = T
                    cap[kt] = self.pace[idx[kt]]
                for dd, k in cand[:2]:
                    if dd < 4:
                        a_, b_ = remaining
                        ab = b_ - a_
                        tt = np.clip(((P[idx[k]] - a_) @ ab) / (ab @ ab + 1e-9), 0, 1)
                        tgt[k] = a_ + tt * ab
                        cap[k] = self.pace[idx[k]]

        # Ball carrier dribbles.
        if s.mode == "owned" and s.owner is not None and self.team[s.owner] == team:
            k = int(np.where(idx == s.owner)[0][0])
            tgt[k], cap[k] = self.dribble_target(s.owner)

        if s.mode == "dead" and s.dead_taker is not None and self.team[s.dead_taker] == team:
            k = int(np.where(idx == s.dead_taker)[0][0])
            tgt[k] = B
            cap[k] = 6.0

        # Shape-keepers spread out instead of stacking on teammates.
        shape = (cap == JOG) & ~self.is_gk[idx]
        if shape.any():
            Pi = P[idx]
            diff = tgt[shape][:, None, :] - Pi[None, :, :]
            dist = np.linalg.norm(diff, axis=-1) + 1e-9
            push = np.clip(6.0 - dist, 0, None) / dist
            push[np.arange(shape.sum()), np.where(shape)[0]] = 0.0
            tgt[shape] += (diff * push[..., None]).sum(axis=1) * 0.8

        tgt[:, 0] = np.clip(tgt[:, 0], 0.5, 104.5)
        tgt[:, 1] = np.clip(tgt[:, 1], 0.5, 67.5)
        return idx, self.raw(tgt, team), cap

    def dribble_target(self, i: int):
        team = self.team[i]
        P = self.att(self.pos, team)
        me = P[i]
        goal = np.array([105.0, 34.0])
        d_goal = goal - me
        dir_ = d_goal / (np.linalg.norm(d_goal) + 1e-9)
        dir_ = 0.7 * dir_ + 0.3 * np.array([1.0, 0.0])
        rep = np.zeros(2)
        near = 99.0
        for j in self.opps(team):
            v = me - P[j]
            d = np.linalg.norm(v) + 1e-9
            near = min(near, d)
            if d < 7:
                rep += v / d**2
        # Steer away from touchlines.
        if me[1] < 5:
            rep[1] += 0.3
        if me[1] > 63:
            rep[1] -= 0.3
        dir_ = dir_ + 4.0 * rep
        dir_ /= np.linalg.norm(dir_) + 1e-9
        speed = (5.2 if near > 6 else 3.6) * (0.75 if me[0] > 88 else 1.0)
        return self.raw(me + dir_ * 4.0, team), speed

    # ---------------------------------------------------------------- moves
    def move_players(self):
        targets = np.zeros((self.n, 2))
        caps = np.zeros(self.n)
        for team in (0, 1):
            idx, tgt, cap = self.team_targets(team)
            targets[idx] = tgt
            caps[idx] = cap
        for i, until in list(self.s.stunned.items()):
            if self.s.t < until:
                caps[i] = 1.0
            else:
                del self.s.stunned[i]
        diff = targets - self.pos
        dist = np.linalg.norm(diff, axis=1, keepdims=True) + 1e-9
        # Players far from their shape position make a recovery run.
        recovery = JOG + 0.3 * dist[:, 0]
        caps = np.where(caps == JOG, np.maximum(caps, recovery), caps)
        caps = np.minimum(caps, self.pace)
        speed = np.minimum(caps[:, None], dist * 1.4)
        desired = diff / dist * speed
        dv = desired - self.vel
        mag = np.linalg.norm(dv, axis=1, keepdims=True) + 1e-9
        dv = np.where(mag > ACCEL * DT, dv / mag * ACCEL * DT, dv)
        self.vel += dv
        self.pos += self.vel * DT
        self.pos = pitch.clamp_to_pitch(self.pos, -1.0)
        # Slow-varying positional noise (Ornstein-Uhlenbeck).
        self.noise += -0.05 * self.noise + self.rng.normal(0, 0.35, self.noise.shape)
        self.turn_bodies()

    def turn_bodies(self):
        """Rotate each body towards where the player wants to face, at a human turning speed."""
        s = self.s
        speed = np.linalg.norm(self.vel, axis=1)
        for i in range(self.n):
            if s.mode == "owned" and s.owner == i:
                # On the ball: towards where he is carrying it, else open up towards goal.
                goal = self.raw(np.array([105.0, 34.0]), self.team[i])
                d = self.vel[i] if speed[i] > 1.5 else goal - self.pos[i]
                rate = TURN_PRESSED if self.nearest_opp_dist(i) < 2.5 else TURN_ON_BALL
            else:
                # Off the ball: running players face their run, the rest watch the ball.
                d = self.vel[i] if speed[i] > 3.5 else s.ball - self.pos[i]
                rate = TURN_OFF_BALL
            want = math.atan2(d[1], d[0])
            diff = (want - self.face[i] + math.pi) % (2 * math.pi) - math.pi
            step = rate * DT
            self.face[i] += float(np.clip(diff, -step, step))

    # ------------------------------------------------------------- decisions
    def decide(self):
        s = self.s
        i = s.owner
        team = self.team[i]
        P = self.att(self.pos, team)
        V = self.vel * self.attack_dir[team]
        me = P[i]
        opp = self.opps(team)
        risk, vision = self.a("risk", i), self.a("vision", i)
        near = self.nearest_opp_dist(i)
        dead = s.dead_kind is not None
        offside = set() if s.dead_kind in pitch.OFFSIDE_EXEMPT else pitch.offside_players(
            P, self.mates(i), opp, self.att(s.ball, team)[0], i)

        options: list[tuple[float, str, int | None, np.ndarray]] = []

        dist_goal = float(pitch.distance_to_goal(me)[0])
        if dist_goal < 28 and not dead:
            q = xg_model(me, P[opp[~self.is_gk[opp]]], header=self.is_header())
            shoot = q * 4.0 * (0.7 + 0.6 * self.a("finishing", i)) + (0.1 if dist_goal < 22 else 0) - 0.12
            options.append((shoot, "shot", None, np.array([105.0, 34.0])))

        for j in self.mates(i):
            if self.is_gk[j] and not (near < 4 and me[0] < 40):
                continue
            # Players mostly spot a team-mate standing offside; sometimes they don't.
            if j in offside and self.rng.random() < 0.9 + 0.09 * vision:
                continue
            cand = [P[j] + V[j] * 0.6]
            if V[j][0] > 2.5 and self.rng.random() < vision:
                cand.append(P[j] + V[j] * 0.6 + V[j] / (np.linalg.norm(V[j]) + 1e-9) * 6)
            for tgt in cand:
                tgt = pitch.clamp_to_pitch(tgt, 1.0)
                d = float(np.linalg.norm(tgt - me))
                if d < 4 or d > 25 + 35 * vision:
                    continue
                # Body shape: options behind him are often not seen at all, and are harder to play.
                off = 0.0 if dead else self.angle_off(i, self.raw(tgt, team))  # set pieces: body set first
                if off > FOV and self.rng.random() > 0.2 + 0.5 * vision:
                    continue
                lane = float(np.min(pitch.point_segment_distance(P[opp], me, tgt)))
                space = float(np.min(np.linalg.norm(P[opp] - tgt, axis=1)))
                L, S = min(lane, 5) / 5, min(space, 8) / 8
                prog = float(np.clip((tgt[0] - me[0]) / 40, -0.5, 1.0))
                score = L * S * (1.25 - risk) + prog * (0.15 + 0.4 * risk)
                score -= max(0.0, d - 25) / 40
                if tgt[0] > 88 and 14 < tgt[1] < 54:
                    score += 0.25 * risk
                score -= 0.35 * max(0.0, off - OPEN_BODY) / (math.pi - OPEN_BODY)
                options.append((score, "pass", j, tgt))

        if not dead and not self.is_gk[i]:
            ahead = [np.linalg.norm(P[o] - me) for o in opp if P[o, 0] > me[0]]
            space_ahead = min(ahead) if ahead else 30
            carry = 0.15 + 0.35 * min(space_ahead, 12) / 12 - (0.35 if near < 2.5 else 0) - (0.3 if me[0] > 88 else 0)
            options.append((carry, "carry", None, me))

        if not options:
            s.decide_at = s.t + 0.5
            return
        scores = np.array([o[0] for o in options])
        temp = 0.05 + 0.12 * (1 - vision)
        p = np.exp((scores - scores.max()) / temp)
        p /= p.sum()
        choice = options[int(self.rng.choice(len(options), p=p))]
        _, kind, j, tgt = choice

        if kind == "carry":
            s.decide_at = s.t + 0.5 + self.rng.exponential(0.6)
            return
        if kind == "shot":
            self.shoot(i)
        else:
            self.pass_ball(i, j, self.raw(tgt, team), offside=j in offside)
        if s.mode != "dead":  # an offside call has already set up the free kick
            s.dead_kind = None

    def pass_ball(self, i: int, j: int, target: np.ndarray, offside: bool = False):
        s = self.s
        team = self.team[i]
        start = s.ball.copy() if s.mode == "dead" else self.pos[i].copy()
        d = float(np.linalg.norm(target - start))
        P = self.att(self.pos, team)
        lane = float(np.min(pitch.point_segment_distance(P[self.opps(team)], self.att(start, team), self.att(target, team))))
        lofted = d > 35 or (s.dead_kind in ("corner", "goal_kick") and d > 25) or (lane < 1.2 and d > 18 and self.rng.random() < 0.3)
        pressure = max(0.0, (3.0 - self.nearest_opp_dist(i)) / 3.0)
        acc = self.a("passing", i)
        # Wrong body shape (ball played across or behind the body): less accurate, less pace.
        wrap = 0.0 if s.dead_kind else max(0.0, self.angle_off(i, target) - OPEN_BODY) / (math.pi - OPEN_BODY)
        ang_sd = (0.02 + 0.07 * (1 - acc)) * (1 + pressure) * (1.3 if lofted else 1.0) * (1 + 1.5 * wrap)
        len_sd = (0.05 + 0.1 * (1 - acc)) * (1 + wrap)
        vec = target - start
        ang = math.atan2(vec[1], vec[0]) + self.rng.normal(0, ang_sd)
        dist = d * max(0.3, self.rng.normal(1.0, len_sd))
        aim = start + np.array([math.cos(ang), math.sin(ang)]) * dist

        ev = self.log(
            "pass", i,
            attack_dir=self.attack_dir[team],
            start=start.round(2).tolist(),
            target=target.round(2).tolist(),
            recipient=int(j),
            lofted=bool(lofted),
            set_piece=s.dead_kind,
            freeze_frame=self.freeze(),
        )
        if offside:
            # Flag goes up as soon as the ball is played: indirect free kick where the receiver stood.
            ev["outcome"] = "offside"
            ev["end"] = self.pos[j].round(2).tolist()
            self.log("offside", j, start=self.pos[j].round(2).tolist())
            spot = pitch.clamp_to_pitch(self.pos[j], 1.0)
            self.go_dead("free_kick", 1 - int(team), spot)
            return
        self.launch(i, j, aim, lofted, ev, kind="pass", pace=1.0 - 0.3 * wrap)

    def launch(self, i, j, aim, lofted, ev, kind, pace: float = 1.0):
        s = self.s
        start = s.ball.copy()
        d = float(np.linalg.norm(aim - start)) + 1e-6
        if kind == "shot":
            v0 = 24.0
        else:
            v_end = 4.0 if not lofted else 6.0
            v0 = math.sqrt(v_end**2 + 2 * BALL_DECEL * d)
            if lofted:
                v0 = max(14.0, d / 2.4)
            v0 *= pace
        s.ball_v = (aim - start) / d * v0
        s.mode = "flight"
        s.owner = None
        s.last_touch = int(self.team[i])
        s.flight = Flight(passer=i, recipient=j, target=aim, lofted=lofted, start=start, length=d, event=ev, kind=kind)
        s.no_touch = {i: s.t + 0.4}

    def shoot(self, i: int):
        s = self.s
        team = self.team[i]
        P = self.att(self.pos, team)
        me = P[i]
        opp = self.opps(team)
        header = self.is_header()
        q = xg_model(me, P[opp[~self.is_gk[opp]]], header=header)
        fin = self.a("finishing", i)
        p_goal = float(np.clip(q * (0.8 + 0.3 * fin), 0, 0.97))
        r = self.rng.random()
        if r < p_goal:
            result = "goal"
            y = 34 + self.rng.uniform(-GOAL_HALF + 0.3, GOAL_HALF - 0.3)
        elif r < p_goal + (1 - p_goal) * 0.4:
            result = "saved"
            y = 34 + self.rng.uniform(-2.0, 2.0)
        elif r < p_goal + (1 - p_goal) * 0.6:
            result = "blocked"
            y = 34
        else:
            result = "off_target"
            y = 34 + self.rng.choice([-1, 1]) * self.rng.uniform(GOAL_HALF + 0.3, GOAL_HALF + 4)
        aim = self.raw(np.array([106.0, y]), team)
        ev = self.log(
            "shot", i,
            attack_dir=self.attack_dir[team],
            start=self.pos[i].round(2).tolist(),
            target=aim.round(2).tolist(),
            xg=round(q, 4),
            header=header,
            outcome=result,
            freeze_frame=self.freeze(),
        )
        self.launch(i, None, aim, False, ev, kind="shot")
        self.s.flight.shot_result = result
        if result == "blocked":
            # The ball will hit a defender ~ a third of the way.
            self.s.flight.target = self.s.ball + (aim - self.s.ball) * 0.3

    # ---------------------------------------------------------------- ball
    def step_ball(self):
        s = self.s
        if s.mode == "pause":
            if s.t >= s.pause_until:
                self.kickoff(s.poss_team)
            return
        if s.mode == "owned":
            i = s.owner
            v = self.vel[i]
            sp = np.linalg.norm(v)
            off = v / sp * 0.5 if sp > 0.5 else np.zeros(2)
            s.ball = self.pos[i] + off
            self.check_pressure_and_tackles()
            if s.mode == "owned" and s.t >= s.decide_at:
                self.decide()
            return
        if s.mode == "dead":
            taker = s.dead_taker
            if np.linalg.norm(self.pos[taker] - s.ball) < 1.0:
                s.mode = "owned"
                s.owner = taker
                s.decide_at = s.t + 0.8
                kind = s.dead_kind
                self.pos[taker] = s.ball.copy()
                s.last_touch = int(self.team[taker])
                s.dead_kind = kind
                s.pressured = set()
            return

        # flight / loose: integrate
        speed = np.linalg.norm(s.ball_v)
        f = s.flight
        if f is not None and f.kind == "shot":
            new_speed = speed
        else:
            airborne = f is not None and f.lofted and not f.landed
            new_speed = max(0.0, speed - BALL_DECEL * DT * (0.4 if airborne else 1.0))
        if speed > 1e-6:
            s.ball_v = s.ball_v / speed * new_speed
        s.ball = s.ball + s.ball_v * DT

        if f is not None and f.lofted and not f.landed:
            k = np.linalg.norm(s.ball - f.start) / f.length
            h = min(12.0, f.length / 5)
            s.ball_z = max(0.0, 4 * h * k * (1 - k)) if k < 1 else 0.0
            if k >= 1:
                f.landed = True
                s.ball_v *= 0.4
        else:
            s.ball_z = 0.0

        if f is not None and f.kind == "shot":
            self.step_shot()
            return

        if not pitch.in_bounds(s.ball):
            if f is not None and f.event.get("outcome") is None:
                f.event["outcome"] = "out"
                f.event["end"] = s.ball.round(2).tolist()
            self.ball_out()
            return

        if s.ball_z < 2.0:
            d = np.linalg.norm(self.pos - s.ball, axis=1)
            for i in np.argsort(d)[:4]:
                if s.no_touch.get(i, -1) > s.t:
                    continue
                if self.is_gk[i]:
                    gb = self.att(s.ball, self.team[i])
                    six_yard = gb[0] < 5.5 and abs(gb[1] - 34) < 9.2
                    r = 2.5 if ((f and f.lofted and gb[0] < 16.5) or six_yard) else 1.5
                elif f and i == f.recipient:
                    r = 1.3
                else:
                    in_own_box = self.att(s.ball, self.team[i])[0] < 16.5 and 13.8 < self.att(s.ball, self.team[i])[1] < 54.2
                    r = 1.6 if (in_own_box and not same_team_pass(f, self.team, i)) else CONTROL_R
                if d[i] > r:
                    continue
                same = f is not None and self.team[i] == self.team[f.passer]
                aerial = f is not None and f.lofted and not f.landed
                own_box = self.att(s.ball, self.team[i])[0] < 16.5
                if s.mode == "loose":
                    p = 0.7
                elif self.is_gk[i] and not same:
                    p = 0.9
                elif aerial:
                    p = 0.5  # aerial duel
                elif same:
                    p = 0.88 if new_speed < 18 else 0.7
                else:
                    p = 0.5 if own_box else 0.2
                if self.rng.random() < p:
                    self.take(i)
                    return

        if new_speed < 1.0 and s.mode == "flight":
            s.mode = "loose"

    def is_header(self) -> bool:
        return self.s.t - self.s.received_air_at < 1.0

    def take(self, i: int):
        s = self.s
        if np.linalg.norm(s.ball_v) > 1.0:
            self.face[i] = math.atan2(-s.ball_v[1], -s.ball_v[0])  # receives facing the ball
        f = s.flight
        aerial = f is not None and f.lofted and not f.landed and s.ball_z > 1.0
        prev_team = s.last_touch
        if f is not None and f.event.get("outcome") is None:
            same = self.team[i] == self.team[f.passer]
            f.event["outcome"] = "complete" if same else "intercepted"
            f.event["receiver"] = int(i)
            f.event["end"] = s.ball.round(2).tolist()
            if not same:
                self.log("interception", i, start=s.ball.round(2).tolist())
        elif s.mode == "loose" and prev_team is not None and prev_team != self.team[i]:
            self.log("ball_recovery", i, start=s.ball.round(2).tolist())
        self.gain(i)
        if aerial:
            s.received_air_at = s.t

    def step_shot(self):
        s = self.s
        f = s.flight
        team = self.team[f.passer]
        B = self.att(s.ball, team)
        if f.shot_result == "blocked" and np.linalg.norm(s.ball - f.target) < 1.0:
            # Deflects loose near the blocker.
            s.flight = None
            s.mode = "loose"
            s.ball_v = self.rng.normal(0, 4, 2)
            s.last_touch = 1 - int(team)
            return
        if f.shot_result == "saved" and B[0] > 103.5:
            gk = next(i for i in range(self.n) if self.team[i] != team and self.is_gk[i])
            self.pos[gk] = s.ball.copy()
            self.log("save", gk, start=s.ball.round(2).tolist())
            self.take(gk)
            return
        if B[0] >= 105.0:
            if f.shot_result == "goal":
                self.score[team] += 1
                self.log("goal", f.passer, start=s.ball.round(2).tolist(), score=list(self.score))
                s.mode = "pause"
                s.flight = None
                s.ball_v[:] = 0
                s.pause_until = s.t + 4.0
                s.poss_team = 1 - int(team)
            else:
                s.flight = None
                self.go_dead("goal_kick", 1 - int(team), self.raw(np.array([5.5, 34.0]), 1 - int(team)))

    def check_pressure_and_tackles(self):
        s = self.s
        i = s.owner
        opp = self.opps(self.team[i])
        d = np.linalg.norm(self.pos[opp] - self.pos[i], axis=1)
        for k, j in enumerate(opp):
            if d[k] < 2.5 and s.spell_id not in s.pressured:
                s.pressured.add(s.spell_id)
                self.log("pressure", j, on=int(i), start=self.pos[j].round(2).tolist())
                s.decide_at = min(s.decide_at, s.t + 0.3 + self.rng.exponential(0.3))
            if d[k] < 1.3 and j not in s.stunned and not self.is_gk[j]:
                in_box = self.att(self.pos[i], self.team[i])[0] > 88
                p = (0.07 if in_box else 0.035) * self.a("tackling", j) * (1.3 - 0.6 * self.a("composure", i))
                if self.rng.random() < p:
                    loose = self.rng.random() < 0.35
                    self.log("tackle", j, on=int(i), won=not loose, start=self.pos[i].round(2).tolist())
                    s.stunned[i] = s.t + 0.8
                    if loose:
                        s.mode = "loose"
                        s.owner = None
                        s.flight = None
                        s.last_touch = int(self.team[j])
                        s.ball_v = self.rng.normal(0, 3.5, 2)
                    else:
                        self.gain(j)
                    return

    # ----------------------------------------------------------------- run
    def record(self):
        s = self.s
        row = [round(s.t, 1), s.period, round(float(s.ball[0]), 2), round(float(s.ball[1]), 2), round(s.ball_z, 2)]
        row.extend(np.round(self.pos, 2).ravel().tolist())
        self.frames.append(row)

    def run(self) -> dict:
        half = self.minutes * 60 / 2
        step = 0
        for period in (1, 2):
            self.s.period = period
            self.attack_dir = [1, -1] if period == 1 else [-1, 1]
            self.s.no_touch, self.s.runs, self.s.stunned = {}, {}, {}
            self.kickoff(0 if period == 1 else 1)
            end = half * period
            while self.s.t < end:
                self.move_players()
                self.step_ball()
                if step % self.out_every == 0:
                    self.record()
                self.s.t += DT
                step += 1
            self.log("period_end", None, team_idx=None)
        return self.result()

    def result(self) -> dict:
        teams = []
        for k, t in enumerate(TEAMS):
            teams.append({**t, "idx": k, "players": [p["idx"] for p in self.players if p["team_idx"] == k]})
        return {
            "meta": {
                "generator": "the-better-ball/sim",
                "seed": self.seed,
                "minutes": self.minutes,
                "pitch": [pitch.LENGTH, pitch.WIDTH],
                "fps": self.out_fps,
                "score": self.score,
                "synthetic": True,
            },
            "teams": teams,
            "players": self.players,
            "events": self.events,
            "tracking_columns": ["t", "period", "ball_x", "ball_y", "ball_z"]
            + [f"p{i}_{c}" for i in range(self.n) for c in ("x", "y")],
            "tracking": self.frames,
        }


def simulate(seed: int = 7, minutes: float = 90.0, out_fps: int = 5) -> dict:
    return MatchEngine(seed=seed, minutes=minutes, out_fps=out_fps).run()
