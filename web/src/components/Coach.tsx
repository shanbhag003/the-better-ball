import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useLayoutEffect, useState } from "react";

interface Step {
  sel: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  { sel: ".pitch-legend", title: "Read the arrows", text: "White = the pass played. Green dashed = the better option." },
  { sel: ".timeline", title: "Find the moments", text: "Amber ticks are key moments. Click one to jump there." },
  { sel: ".sidebar .list", title: "Biggest missed chances", text: "Every card is a moment. Click to replay it." },
  { sel: ".toggles", title: "Your controls", text: "Hide the better passes or stop auto-pausing." },
  { sel: ".coach-tab", title: "AI coach", text: "Two AI coaches review a team in parallel. The head coach writes the report." },
  { sel: ".ask-tab", title: "Ask the AI", text: "Microsoft Foundry agents answer questions about the match, for fans or analysts." },
  { sel: ".pitch-card", title: "Let's watch one", text: "We play the build-up, pause on the pass, then explain it." },
];

const PAD = 8;

/** Spotlight walkthrough of the interface, then hands over to the moment tour. */
export function Coach({ onFinish, onExit }: { onFinish: () => void; onExit: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useLayoutEffect(() => {
    const el = document.querySelector(step.sel);
    el?.scrollIntoView({ block: "nearest" });
    const measure = () => setRect(el ? el.getBoundingClientRect() : null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step.sel]);

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      if (e.key === "ArrowRight" || e.key === "Enter") (last ? onFinish() : setI((k) => k + 1));
      if (e.key === "ArrowLeft") setI((k) => Math.max(0, k - 1));
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [last, onExit, onFinish]);

  if (!rect) return null;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const below = vh - rect.bottom > 220 || rect.top < 220;
  const big = rect.height > vh * 0.5; // large targets: put the tip inside, near the bottom
  const width = Math.min(320, vw - 24);
  const left = Math.max(12, Math.min(vw - width - 12, rect.left + rect.width / 2 - width / 2));
  const tipStyle = big
    ? { left, top: rect.bottom - 200 }
    : below
      ? { left, top: rect.bottom + PAD + 12 }
      : { left, top: rect.top - PAD - 12, transform: "translateY(-100%)" };

  return (
    <div className="coach" role="dialog" aria-modal="true" aria-label="Guided tour">
      <div
        className="spot"
        style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
      />
      <div className="coach-tip card pop" key={i} style={{ width, ...tipStyle }}>
        <div className="coach-top">
          <span className="muted small">Tour · {i + 1} of {STEPS.length}</span>
          <button className="link" onClick={onExit}>Skip</button>
        </div>
        <h3>{step.title}</h3>
        <p className="muted">{step.text}</p>
        <div className="coach-actions">
          <button className="icon-btn sm" onClick={() => setI(i - 1)} disabled={i === 0} aria-label="Back">
            <ChevronLeft size={16} />
          </button>
          <div className="ob-dots inline">
            {STEPS.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}
          </div>
          {last ? (
            <button className="btn primary" onClick={onFinish}><Play size={14} fill="currentColor" /> Play first moment</button>
          ) : (
            <button className="btn primary" onClick={() => setI(i + 1)}>Next <ChevronRight size={16} /></button>
          )}
        </div>
      </div>
    </div>
  );
}
