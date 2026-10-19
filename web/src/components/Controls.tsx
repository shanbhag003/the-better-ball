import { Eye, EyeOff, Pause, Play, RotateCcw, RotateCw, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { minute } from "../labels";
import { usePlayback, type Playback } from "../playback";
import type { Decision, Match } from "../types";

interface Props {
  match: Match;
  pb: Playback;
  showBetter: boolean;
  setShowBetter: (v: boolean) => void;
  autoStop: boolean;
  setAutoStop: (v: boolean) => void;
  moments: Decision[];
  onMoment: (d: Decision) => void;
}

const SPEEDS = [1, 2, 4, 8];

export function Controls({ match, pb, showBetter, setShowBetter, autoStop, setAutoStop, moments, onMoment }: Props) {
  usePlayback(pb);
  return (
    <div className="controls card">
      <Timeline match={match} pb={pb} moments={moments} onMoment={onMoment} />
      <div className="tl-legend">
        <span><i className="lg moment" /> Key moment</span>
        <span>⚽ Goal</span>
        <span className="muted">Click or drag to jump</span>
      </div>
      <div className="controls-row">
        <div className="group">
          <button className="icon-btn" onClick={() => pb.seek(pb.t - 5)} title="Back 5s" aria-label="Back 5 seconds">
            <RotateCcw size={18} />
          </button>
          <button className="play-btn" onClick={() => pb.toggle()} aria-label={pb.playing ? "Pause" : "Play"}>
            {pb.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => pb.seek(pb.t + 5)} title="Forward 5s" aria-label="Forward 5 seconds">
            <RotateCw size={18} />
          </button>
        </div>

        <div className="segmented" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={pb.speed === s} className={pb.speed === s ? "on" : ""} onClick={() => pb.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>

        <div className="group toggles">
          <button className={`chip-toggle ${showBetter ? "on better" : ""}`} onClick={() => setShowBetter(!showBetter)} title="Show the better option on every pass">
            {showBetter ? <Eye size={15} /> : <EyeOff size={15} />} Better passes
          </button>
          <button className={`chip-toggle ${autoStop ? "on" : ""}`} onClick={() => setAutoStop(!autoStop)} title="Pause automatically at key moments">
            <Sparkles size={15} /> Stop at key moments
          </button>
        </div>
      </div>
    </div>
  );
}

function Timeline({ match, pb, moments, onMoment }: { match: Match; pb: Playback; moments: Decision[]; onMoment: (d: Decision) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const { t0, duration } = match.meta;
  const frac = (t: number) => ((t - t0) / duration) * 100;
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return t0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };
  const dragging = useRef(false);

  return (
    <div
      className="timeline"
      ref={ref}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        pb.seek(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        setHover({ x: e.clientX - r.left, t: timeAt(e.clientX) });
        if (dragging.current) pb.seek(timeAt(e.clientX));
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => setHover(null)}
      role="slider"
      aria-label="Match timeline"
      aria-valuemin={t0}
      aria-valuemax={t0 + duration}
      aria-valuenow={pb.t}
    >
      <div className="track">
        <div className="fill" style={{ width: `${frac(pb.t)}%` }} />
        <div className="half" style={{ left: "50%" }} />
      </div>
      {moments.map((d) => (
        <button
          key={d.id}
          className="marker moment"
          style={{ left: `${frac(d.t)}%` }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onMoment(d)}
          title={`Key moment · ${minute(d.t)}`}
          aria-label={`Key moment at ${minute(d.t)}`}
        />
      ))}
      {match.goals.map((g) => (
        <span key={g.id} className="marker goal" style={{ left: `${frac(g.t)}%`, background: match.teams[g.team ?? 0].color }} title={`Goal · ${minute(g.t)}`}>
          ⚽
        </span>
      ))}
      <div className="knob" style={{ left: `${frac(pb.t)}%` }} />
      {hover && <div className="time-tip" style={{ left: hover.x }}>{minute(hover.t)}</div>}
    </div>
  );
}
