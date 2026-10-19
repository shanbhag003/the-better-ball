import { ChevronRight, MousePointerClick, Play, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

const STEPS: { icon: ReactNode; title: string; text: string; visual: ReactNode }[] = [
  {
    icon: <Play size={20} fill="currentColor" />,
    title: "Watch the match",
    text: "A full 90 minutes. Every pass tracked.",
    visual: (
      <div className="ob-visual dots">
        <span style={{ background: "#f25022" }} />
        <span style={{ background: "#00a4ef" }} />
        <span className="ball" />
      </div>
    ),
  },
  {
    icon: <Sparkles size={20} />,
    title: "Spot the better pass",
    text: "We score every option. You see the best one.",
    visual: (
      <div className="ob-visual legend">
        <div><i className="line played" /> Played</div>
        <div><i className="line better" /> Better option</div>
      </div>
    ),
  },
  {
    icon: <MousePointerClick size={20} />,
    title: "Jump to key moments",
    text: "Biggest missed chances. One click away.",
    visual: (
      <div className="ob-visual chips">
        <div className="ob-moment">
          <span className="min">4'</span>
          <span className="verdict sm warn">Missed chance</span>
          <span className="gain">+18%</span>
        </div>
      </div>
    ),
  },
];

export function Onboarding({ onDone }: { onDone: (tour: boolean) => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="onboard card pop">
        <div className="ob-step muted small">Step {i + 1} of {STEPS.length}</div>
        <div className="ob-icon">{s.icon}</div>
        <h2>{s.title}</h2>
        <p className="muted">{s.text}</p>
        {s.visual}
        <div className="ob-dots">
          {STEPS.map((_, k) => (
            <button key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Step ${k + 1}`} />
          ))}
        </div>
        <div className="ob-actions">
          <button className="btn ghost" onClick={() => onDone(false)}>Skip</button>
          {last ? (
            <button className="btn primary" onClick={() => onDone(true)}>
              Start guided tour <ChevronRight size={16} />
            </button>
          ) : (
            <button className="btn primary" onClick={() => setI(i + 1)}>
              Next <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
