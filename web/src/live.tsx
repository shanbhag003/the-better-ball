import { createContext, useContext } from "react";
import type { Decision, Match, Stat } from "./types";

/**
 * Live mode: once the guided tour is skipped or finished, the app only shows what has
 * happened up to the current match minute (no spoilers). During the tour it previews
 * the full match. `asOf` is the cutoff in match seconds, or null for the full match.
 */
export interface Live {
  asOf: number | null;
  watch: (momentId: number) => void;
}

export const LiveContext = createContext<Live>({ asOf: null, watch: () => {} });

export const useLive = () => useContext(LiveContext);

/** Whole-minute cutoff for the current time (null once the match has ended or outside live mode). */
export function cutoffFor(match: Match, t: number, live: boolean): number | null {
  if (!live) return null;
  const end = match.meta.t0 + match.meta.duration;
  if (t >= end - 1) return null;
  return Math.floor(t / 60) * 60;
}

export const seen = (t: number, asOf: number | null) => asOf === null || t <= asOf;

export const asOfLabel = (asOf: number | null) => (asOf === null ? "Full time" : `as of ${Math.floor(asOf / 60) + 1}'`);

/** Team and player stats computed from the decisions made so far. */
export function liveStats(match: Match, asOf: number | null) {
  if (asOf === null) return { teamStats: match.teamStats, playerStats: match.playerStats };
  const teams: Record<string, Stat & { passes: number; completed: number }> = {};
  const players: Record<string, Stat> = {};
  const add = (bag: Record<string, Stat & Partial<{ passes: number; completed: number }>>, key: string, d: Decision) => {
    const s = (bag[key] ??= { decisions: 0, optimal: 0, cost: 0, decision_score: 0, shots: 0, xg: 0, passes: 0, completed: 0 });
    s.decisions += 1;
    if (d.verdict === "optimal" || d.verdict === "good") s.optimal += 1;
    s.cost += d.cost;
    if (d.type === "shot") {
      s.shots = (s.shots ?? 0) + 1;
      s.xg = (s.xg ?? 0) + d.chosen.ev;
    } else if (d.outcome) {
      s.passes = (s.passes ?? 0) + 1;
      if (d.outcome === "complete") s.completed = (s.completed ?? 0) + 1;
    }
  };
  for (const d of match.decisions) {
    if (d.t > asOf) break; // decisions are sorted by time
    add(teams, String(d.team), d);
    add(players, String(d.player), d);
  }
  for (const s of [...Object.values(teams), ...Object.values(players)]) {
    s.decision_score = s.decisions ? (100 * s.optimal) / s.decisions : 0;
    const x = s as Stat & { passes?: number; completed?: number };
    if (x.passes) s.pass_completion = (100 * (x.completed ?? 0)) / x.passes;
    s.xg = Math.round((s.xg ?? 0) * 100) / 100;
  }
  return { teamStats: teams, playerStats: players };
}
