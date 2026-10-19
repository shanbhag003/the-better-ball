import type { Verdict } from "./types";

export const VERDICT: Record<Verdict, { label: string; tone: "good" | "warn" | "bad" | "info" }> = {
  optimal: { label: "Best choice", tone: "good" },
  good: { label: "Good choice", tone: "good" },
  missed_progression: { label: "Missed chance", tone: "warn" },
  too_risky: { label: "Too risky", tone: "bad" },
  should_shoot: { label: "Should shoot", tone: "warn" },
  should_pass: { label: "Should pass", tone: "warn" },
  suboptimal: { label: "Better option", tone: "info" },
};

export const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Goal chance in percent with one decimal below 10%. */
export const goalPct = (ev: number) => {
  const v = Math.max(0, ev) * 100;
  return v < 10 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
};

export const minute = (t: number) => `${Math.floor(t / 60) + 1}'`;
