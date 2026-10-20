import { Sparkles } from "lucide-react";
import { useState } from "react";
import { ai, type AiAnswer } from "../api";
import { useAiPrefs } from "../aiPrefs";
import { AiBadge, AiOptions, Thinking } from "./Ai";

/** "Explain with AI" for one decision: the Narrator agent, in the chosen voice and language. */
export function ExplainBox({ momentId }: { momentId: number }) {
  const prefs = useAiPrefs();
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setAnswer(await ai.explain(momentId, prefs.voice, prefs.language));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (prefs.health === null) return null; // API not reachable: hide rather than tease

  return (
    <div className="explain-box">
      <div className="eb-row">
        <AiOptions {...prefs} />
        <button className="btn ai" onClick={run} disabled={busy}>
          <Sparkles size={14} /> {answer ? "Again" : "Explain"}
        </button>
      </div>
      {busy && <Thinking label="Narrator is writing…" />}
      {error && <div className="eb-text error">⚠️ {error}</div>}
      {answer && !busy && (
        <div className="eb-text pop">
          {answer.text}
          <AiBadge a={answer} />
        </div>
      )}
    </div>
  );
}
