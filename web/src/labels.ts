import type { Verdict } from "./types";

export const VERDICT: Record<Verdict, { label: string; tone: "good" | "warn" | "bad" | "info"; hint: string }> = {
  optimal: { label: "Best choice", tone: "good", hint: "No better option was on" },
  good: { label: "Good choice", tone: "good", hint: "Close to the best option" },
  missed_progression: { label: "Missed chance", tone: "warn", hint: "Played safe. A more dangerous pass was on" },
  too_risky: { label: "Too risky", tone: "bad", hint: "Low-odds pass. A safer one was worth more" },
  should_shoot: { label: "Should shoot", tone: "warn", hint: "Shooting was worth more than passing" },
  should_pass: { label: "Should pass", tone: "warn", hint: "A pass was worth more than this shot" },
  suboptimal: { label: "Better option", tone: "info", hint: "Another pass was worth more" },
};

/** Verdicts shown in the "what do labels mean" guide, in reading order. */
export const GUIDE: Verdict[] = ["missed_progression", "too_risky", "should_shoot", "should_pass", "good"];

export const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Goal chance in percent with one decimal below 10%. */
export const goalPct = (ev: number) => {
  const v = Math.max(0, ev) * 100;
  return v < 10 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
};

export const minute = (t: number) => `${Math.floor(t / 60) + 1}'`;
