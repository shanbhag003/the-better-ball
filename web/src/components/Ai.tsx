import { Bot, Sparkles } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { LANGUAGES, type AiAnswer, type Voice } from "../api";

/** Fan / Analyst switch plus a language picker, shared by every AI surface. */
export function AiOptions({ voice, setVoice, language, setLanguage }: {
  voice: Voice;
  setVoice: (v: Voice) => void;
  language: string;
  setLanguage: (l: string) => void;
}) {
  return (
    <div className="ai-options">
      <div className="segmented sm" role="radiogroup" aria-label="Audience">
        {(["fan", "analyst"] as Voice[]).map((v) => (
          <button key={v} role="radio" aria-checked={voice === v} className={voice === v ? "on" : ""} onClick={() => setVoice(v)}>
            {v === "fan" ? "Fan" : "Analyst"}
          </button>
        ))}
      </div>
      <select className="lang" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
        {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
      </select>
    </div>
  );
}

/** Small badge saying who wrote the text: a Foundry model, or the offline template. */
export function AiBadge({ a }: { a: Pick<AiAnswer, "mode" | "model"> & { fallback?: boolean } }) {
  return a.mode === "foundry" ? (
    <span className="ai-badge on" title={a.fallback ? "Primary model unavailable: answered by the backup deployment" : "Written by Microsoft Foundry agents"}>
      <Sparkles size={11} /> Foundry · {a.model}{a.fallback ? " (backup)" : ""}
    </span>
  ) : (
    <span className="ai-badge" title="No Foundry model connected: template text"><Bot size={11} /> Offline template</span>
  );
}

export function Thinking({ label }: { label: string }) {
  return (
    <div className="thinking">
      <span className="dots"><i /><i /><i /></span> {label}
    </div>
  );
}

/** Minimal, safe markdown: ### headings, - bullets, **bold**. No HTML injection. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(<ul key={`ul${blocks.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^[-*•]\s+/.test(line)) { list.push(line.replace(/^[-*•]\s+/, "")); continue; }
    flush();
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) blocks.push(<h4 key={`h${blocks.length}`}>{inline(h[1])}</h4>);
    else blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b>
      : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i>
        : <Fragment key={i}>{p}</Fragment>,
  );
}
