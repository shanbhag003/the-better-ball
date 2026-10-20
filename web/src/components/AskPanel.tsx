import { ArrowUp, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ai, type AiAnswer } from "../api";
import { useAiPrefs } from "../aiPrefs";
import { asOfLabel, useLive } from "../live";
import type { Match } from "../types";
import { AiBadge, AiOptions, Markdown, Thinking } from "./Ai";
import { AnswerCards } from "./AnswerCards";

interface Turn {
  q: string;
  a?: AiAnswer;
  error?: string;
}

export function AskPanel({ match }: { match: Match }) {
  const prefs = useAiPrefs();
  const { asOf } = useLive();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [h] = match.teams;

  // Spoiler-free starters: nothing here gives away how the match ends.
  const suggestions = [
    "Who is playing better so far?",
    "Who has made the riskiest passes?",
    "Who is the best decision maker?",
    `What has ${h.short} done well?`,
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
      const ans = await ai.ask(text, prefs.voice, prefs.language, asOf);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: ans } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
    }
  };

  const unreachable = prefs.health === null;
  const last = turns.length - 1;

  return (
    <div className="panel ask">
      <AiOptions {...prefs} />
      <div className="list chat" ref={listRef}>
        {turns.length === 0 && (
          <div className="ask-empty">
            <span className="ob-icon sm"><Sparkles size={18} /></span>
            <b>Ask the match</b>
            <span className="muted small">
              Agents dig through every decision{asOf !== null ? ` played so far (${asOfLabel(asOf)})` : ""}, then answer.
            </span>
            <div className="suggest">
              {suggestions.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)} disabled={busy || unreachable}>{s}</button>
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
                <AnswerCards cards={t.a.cards ?? []} match={match} />
                <div className="answer-meta">
                  <AiBadge a={t.a} />
                  <span className="muted small">{asOfLabel(t.a.as_of ?? null)}</span>
                </div>
              </div>
            )}
            {t.error && <div className="bubble a error">⚠️ {t.error}</div>}
            {i === last && t.a?.follow_ups?.length ? (
              <div className="follow-ups">
                {t.a.follow_ups.map((f) => (
                  <button key={f} className="chip follow" onClick={() => send(f)} disabled={busy}>{f}</button>
                ))}
              </div>
            ) : null}
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
