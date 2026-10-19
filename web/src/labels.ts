import type { Decision, Verdict } from "./types";

export const VERDICT: Record<Verdict, { label: string; tone: "good" | "warn" | "bad" | "info"; hint: string }> = {
  optimal: { label: "Best choice", tone: "good", hint: "No better option was on" },
  good: { label: "Good choice", tone: "good", hint: "Close to the best option" },
  clear_upgrade: { label: "Clear upgrade", tone: "warn", hint: "Another pass was safer AND more dangerous" },
  missed_progression: { label: "Missed chance", tone: "warn", hint: "Played safe. A more dangerous pass was on" },
  too_risky: { label: "Too risky", tone: "bad", hint: "Took a gamble. A safer pass was worth more" },
  should_shoot: { label: "Should shoot", tone: "warn", hint: "A shot was worth more than the pass" },
  should_pass: { label: "Should pass", tone: "warn", hint: "A pass was worth more than the shot" },
  suboptimal: { label: "Better option", tone: "info", hint: "Another pass was worth more" },
};

/** Verdicts shown in the "what do labels mean" guide, in reading order. */
export const GUIDE: Verdict[] = ["clear_upgrade", "missed_progression", "too_risky", "should_shoot", "should_pass", "good"];

export const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Goal chance in percent with one decimal below 10%. */
export const goalPct = (ev: number) => {
  const v = Math.max(0, ev) * 100;
  return v < 10 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
};

export const minute = (t: number) => `${Math.floor(t / 60) + 1}'`;

/** One-line, number-backed reason for a decision's verdict. */
export function explain(d: Decision): string {
  const c = d.chosen;
  const b = d.best;
  const arrives = `${pct(b.p)} vs ${pct(c.p)}`;
  const chance = `${goalPct(b.ev)} vs ${goalPct(c.ev)}`;
  switch (d.verdict) {
    case "clear_upgrade":
      return `Other pass: more likely to arrive (${arrives}) and a bigger goal chance (${chance}).`;
    case "missed_progression":
      return `Played safe. The other pass had a bigger goal chance (${chance}).`;
    case "too_risky":
      return `Only ${pct(c.p)} to arrive. A safer pass (${pct(b.p)}) had a bigger goal chance.`;
    case "should_shoot":
      return `Shooting gave a bigger goal chance (${chance}).`;
    case "should_pass":
      return `This shot: ${goalPct(c.ev)}. A pass gave ${goalPct(b.ev)}.`;
    default:
      return VERDICT[d.verdict].hint;
  }
}
