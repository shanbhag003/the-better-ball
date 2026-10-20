import { ArrowUp, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ai, type AiAnswer } from "../api";
import { useAiPrefs } from "../aiPrefs";
import type { Match } from "../types";
import { AiBadge, AiOptions, Markdown, Thinking } from "./Ai";

interface Turn {
  q: string;
  a?: AiAnswer;
  error?: string;
}

export function AskPanel({ match }: { match: Match }) {
  const prefs = useAiPrefs();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [h, a] = match.teams;

  const suggestions = [
    `Why did ${match.meta.score[0] >= match.meta.score[1] ? h.name : a.name} win?`,
    "Who made the riskiest passes?",
    "Who was the best decision maker?",
    `How did ${h.short} play in the 2nd half?`,
  ];

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const send = async (question: string) => {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: text }]);
    try {
      const ans = await ai.ask(text, prefs.voice, prefs.language);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: ans } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
    }
  };

  const unreachable = prefs.health === null;

  return (
    <div className="panel ask">
      <AiOptions {...prefs} />
      <div className="list chat" ref={listRef}>
        {turns.length === 0 && (
          <div className="ask-empty">
            <span className="ob-icon sm"><Sparkles size={18} /></span>
            <b>Ask the match</b>
            <span className="muted small">Agents dig through every decision, then answer.</span>
            <div className="suggest">
              {suggestions.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="turn">
            <div className="bubble q">{t.q}</div>
            {t.a && (
              <div className="bubble a">
                <Markdown text={t.a.text} />
                <AiBadge a={t.a} />
              </div>
            )}
            {t.error && <div className="bubble a error">⚠️ {t.error}</div>}
          </div>
        ))}
        {busy && <Thinking label="Analyst is checking the data…" />}
      </div>
      <form className="ask-input" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={unreachable ? "AI service not reachable" : "Ask about players, teams, moments…"}
          maxLength={300}
          disabled={busy || unreachable}
          aria-label="Ask a question about the match"
        />
        <button className="send" disabled={busy || q.trim().length < 3 || unreachable} aria-label="Send"><ArrowUp size={16} /></button>
      </form>
    </div>
  );
}
