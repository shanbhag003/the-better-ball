import type { Bundle, Decision, Match } from "./types";

export async function loadMatch(url: string): Promise<Match> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load match (${res.status})`);
  const b: Bundle = await res.json();

  const stride = b.frames[0].length;
  const frames = new Int16Array(b.frames.length * stride);
  b.frames.forEach((row, i) => frames.set(row, i * stride));

  const startById = new Map<number, [number, number]>();
  for (const e of b.events) if (e.start) startById.set(e.id, e.start);

  const decisions: Decision[] = Object.entries(b.decisions)
    .map(([id, d]) => ({ ...d, id: Number(id), start: startById.get(Number(id)) ?? [0, 0] }))
    .sort((a, z) => a.t - z.t);
  const byId = new Map(decisions.map((d) => [d.id, d]));

  return {
    meta: b.meta,
    teams: b.teams,
    players: b.players,
    frames,
    stride,
    nFrames: b.frames.length,
    kickoff2: b.meta.t0 + Math.max(0, b.frames.findIndex((row) => row[0] === 2)) / b.meta.fps,
    events: b.events,
    decisions,
    byId,
    keyMoments: b.key_moments.map((id) => byId.get(id)!).filter(Boolean).sort((a, z) => a.t - z.t),
    goals: b.events.filter((e) => e.type === "goal"),
    teamStats: b.team_stats,
    playerStats: b.player_stats,
  };
}

export interface Snapshot {
  period: number;
  ball: [number, number, number];
  pos: [number, number][];
}

/** Interpolated positions at match time t (seconds). */
export function snapshot(m: Match, t: number): Snapshot {
  const f = Math.max(0, Math.min(m.nFrames - 1.001, (t - m.meta.t0) * m.meta.fps));
  const i = Math.floor(f);
  const a = f - i;
  const s = m.stride;
  const A = i * s;
  const B = Math.min(i + 1, m.nFrames - 1) * s;
  const F = m.frames;
  // Don't interpolate across the half-time / kickoff teleports.
  const jump = Math.abs(F[A + 1] - F[B + 1]) > 150 || F[A] !== F[B];
  const lerp = (k: number) => (jump ? F[A + k] : F[A + k] + (F[B + k] - F[A + k]) * a) / 10;
  const pos: [number, number][] = [];
  for (let p = 0; p < 22; p++) pos.push([lerp(4 + p * 2), lerp(5 + p * 2)]);
  return { period: F[A], ball: [lerp(1), lerp(2), lerp(3)], pos };
}

export function scoreAt(m: Match, t: number): [number, number] {
  let s: [number, number] = [0, 0];
  for (const g of m.goals) if (g.t <= t && g.score) s = g.score;
  return s;
}

/** Decisions whose ball was played within [t - window, t]. */
export function recentDecisions(m: Match, t: number, window: number): Decision[] {
  const out: Decision[] = [];
  let lo = 0;
  let hi = m.decisions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (m.decisions[mid].t < t - window) lo = mid + 1;
    else hi = mid;
  }
  for (let k = lo; k < m.decisions.length && m.decisions[k].t <= t; k++) out.push(m.decisions[k]);
  return out;
}

export function clock(m: Match, t: number): { label: string; half: string } {
  // The breaks read like TV: 45:00 · Half-time and 90:00 · Full time.
  if (t >= m.meta.t0 + m.meta.duration - 0.5) return { label: "90:00", half: "Full time" };
  if (t >= m.kickoff2 - 0.25 && t < m.kickoff2) return { label: "45:00", half: "Half-time" };
  const half = t >= m.kickoff2 ? "2nd half" : "1st half";
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60);
  return { label: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`, half };
}

/** Half-time or full-time break: players walk off, then the score graphic. */
export interface Interlude {
  kind: "ht" | "ft";
  t: number; // match time the break holds at
  start: number; // performance.now() when it began
}

const WALK_OFF = 5; // seconds for the last player to reach the tunnel

/**
 * Positions while players walk to the tunnel on the near touchline, and how visible each one is.
 * Players closest to the tunnel go first; each team heads for its own side of it.
 */
export function walkOff(m: Match, pos: [number, number][], k: number): { pos: [number, number][]; alpha: number[] } {
  const alpha: number[] = [];
  const out = pos.map(([x, y], i) => {
    const tx = m.players[i].team === 0 ? 50.5 : 54.5;
    const ty = -3;
    const delay = (Math.hypot(tx - x, ty - y) / 110) * 1.2;
    const f = Math.max(0, Math.min(1, (k - delay) / (WALK_OFF - 1.2)));
    const e = f * f * (3 - 2 * f);
    alpha.push(1 - Math.max(0, (e - 0.82) / 0.18));
    return [x + (tx - x) * e, y + (ty - y) * e] as [number, number];
  });
  return { pos: out, alpha };
}

/** Seconds into the break when the score graphic comes up. */
export const BOARD_DELAY = WALK_OFF + 0.2;

/**
 * Body orientation (radians, raw pitch) of every player at time t, using the simulator's rules:
 * on the ball he faces where he carries it, or opens up towards goal; off the ball he faces his
 * run when sprinting, otherwise he watches the ball.
 */
export function bodyFacing(m: Match, t: number, snap: Snapshot): number[] {
  const back = snapshot(m, t - 0.4);
  const [bx, by, bz] = snap.ball;
  let owner = -1;
  let best = 1.6;
  snap.pos.forEach(([x, y], i) => {
    const d = Math.hypot(x - bx, y - by);
    if (d < best && bz < 1.2) [owner, best] = [i, d];
  });
  return snap.pos.map(([x, y], i) => {
    const vx = (x - back.pos[i][0]) / 0.4;
    const vy = (y - back.pos[i][1]) / 0.4;
    const speed = Math.hypot(vx, vy);
    if (speed > 20) return Math.atan2(by - y, bx - x); // half-time teleport: no real velocity
    if (i === owner) {
      if (speed > 1.5) return Math.atan2(vy, vx);
      const team = m.players[i].team;
      const keeper = m.players.findIndex((p) => p.team === team && p.role === "GK");
      const goalX = snap.pos[keeper][0] < 52.5 ? 105 : 0; // attack away from your own keeper
      return Math.atan2(34 - y, goalX - x);
    }
    return speed > 3.5 ? Math.atan2(vy, vx) : Math.atan2(by - y, bx - x);
  });
}
