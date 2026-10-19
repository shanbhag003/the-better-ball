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
  const half = t >= m.meta.duration / 2 + m.meta.t0 ? "2nd half" : "1st half";
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60);
  return { label: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`, half };
}
