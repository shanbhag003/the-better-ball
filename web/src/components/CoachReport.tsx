import { ChevronLeft, ClipboardList } from "lucide-react";
import { useEffect, useState } from "react";
import { ai, type AiAnswer } from "../api";
import { useAiPrefs } from "../aiPrefs";
import type { Team } from "../types";
import { AiBadge, AiOptions, Markdown, Thinking } from "./Ai";

/** Head coach report: two specialist agents review in parallel, the head coach merges them. */
export function CoachReport({ team, onBack }: { team: Team; onBack: () => void }) {
  const prefs = useAiPrefs();
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setAnswer(null);
    setError(null);
    ai.coach(team.short, prefs.voice, prefs.language)
      .then((a) => live && setAnswer(a))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [team.short, prefs.voice, prefs.language]);

  return (
    <div className="coach-report">
      <div className="cr-head">
        <button className="icon-btn sm" onClick={onBack} aria-label="Back to players"><ChevronLeft size={16} /></button>
        <ClipboardList size={16} />
        <b>Coach report</b>
        <span className="dot" style={{ background: team.color }} />
        <span className="muted small">{team.name}</span>
      </div>
      <AiOptions {...prefs} />
      <div className="cr-body">
        {!answer && !error && <Thinking label="Attack and ball-security coaches are reviewing in parallel…" />}
        {error && <div className="eb-text error">⚠️ {error}</div>}
        {answer && (
          <>
            <Markdown text={answer.text} />
            <AiBadge a={answer} />
          </>
        )}
      </div>
    </div>
  );
}
