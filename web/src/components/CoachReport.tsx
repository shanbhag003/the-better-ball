import { ClipboardList, Clock } from "lucide-react";
import { useState } from "react";
import { ai, type AiAnswer } from "../api";
import { useAiPrefs } from "../aiPrefs";
import { asOfLabel, useLive } from "../live";
import type { Match } from "../types";
import { AiBadge, AiOptions, Markdown, Thinking } from "./Ai";

const MIN_MINUTE = 10; // the report needs some football to talk about

/** Coach tab: two specialist agents review a team in parallel, the head coach merges their notes. */
export function CoachPanel({ match }: { match: Match }) {
  const prefs = useAiPrefs();
  const { asOf } = useLive();
  const [team, setTeam] = useState(0);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = match.teams[team];
  const minuteNow = asOf === null ? null : Math.floor(asOf / 60) + 1;
  const tooEarly = minuteNow !== null && minuteNow < MIN_MINUTE;
  const label = asOf === null ? "Full-time report" : `Report ${asOfLabel(asOf)}`;

  const pick = (k: number) => {
    setTeam(k);
    setAnswer(null);
    setError(null);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await ai.coach(t.short, prefs.voice, prefs.language, asOf));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel coach-panel">
      <div className="segmented full">
        {match.teams.map((x) => (
          <button key={x.idx} className={team === x.idx ? "on" : ""} onClick={() => pick(x.idx)}>
            <span className="dot" style={{ background: x.color }} /> {x.name}
          </button>
        ))}
      </div>

      <div className="crew">
        <span className="crew-step">Attack coach</span>
        <span className="crew-plus">+</span>
        <span className="crew-step">Security coach</span>
        <span className="crew-arrow">→</span>
        <span className="crew-step lead">Head coach</span>
      </div>

      <AiOptions {...prefs} />
      <button className="btn ai wide-ai" onClick={run} disabled={busy || prefs.health === null || tooEarly}>
        {tooEarly ? <Clock size={15} /> : <ClipboardList size={15} />}
        {tooEarly ? `Available from ${MIN_MINUTE}'` : answer ? `Rewrite · ${label}` : label}
      </button>

      <div className="cr-body">
        {!answer && !busy && !error && (
          <div className="empty small muted">
            {prefs.health === null
              ? "AI service not reachable."
              : tooEarly
                ? "Too early for a report. Let the game develop."
                : `${t.name}: what worked, what to fix, who stood out${asOf !== null ? " so far" : ""}.`}
          </div>
        )}
        {busy && <Thinking label="Two coaches are reviewing in parallel…" />}
        {error && <div className="eb-text error">⚠️ {error}</div>}
        {answer && (
          <div className="pop">
            <div className="report-stamp">{asOfLabel(answer.as_of ?? null)}</div>
            <Markdown text={answer.text} />
            <AiBadge a={answer} />
          </div>
        )}
      </div>
    </div>
  );
}
