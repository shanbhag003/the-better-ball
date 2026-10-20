import { Eye, EyeOff, Keyboard, Pause, Play, RotateCcw, RotateCw, Sparkles, Tv, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { minute, VERDICT } from "../labels";
import { seen, useLive } from "../live";
import { usePlayback, type Playback } from "../playback";
import type { Decision, Match, MatchEvent } from "../types";

interface Props {
  match: Match;
  pb: Playback;
  showBetter: boolean;
  setShowBetter: (v: boolean) => void;
  autoStop: boolean;
  setAutoStop: (v: boolean) => void;
  broadcast: boolean;
  setBroadcast: (v: boolean) => void;
  sound: boolean;
  setSound: (v: boolean) => void;
  punditOn: boolean;
  moments: Decision[];
  onMoment: (d: Decision) => void;
}

const SPEEDS = [1, 2, 4, 8];

export function Controls({ match, pb, showBetter, setShowBetter, autoStop, setAutoStop, broadcast, setBroadcast, sound, setSound, punditOn, moments, onMoment }: Props) {
  usePlayback(pb);
  return (
    <div className="controls card">
      <div className="controls-row">
        <div className="group">
          <button className="icon-btn" onClick={() => pb.seek(pb.t - 5)} data-tip="Back 5s" aria-label="Back 5 seconds">
            <RotateCcw size={17} />
          </button>
          <button className="play-btn" onClick={() => pb.toggle()} aria-label={pb.playing ? "Pause" : "Play"}>
            {pb.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => pb.seek(pb.t + 5)} aria-label="Forward 5 seconds">
            <RotateCw size={17} />
          </button>
        </div>

        <Timeline match={match} pb={pb} moments={moments} onMoment={onMoment} />

        <div className="segmented" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={pb.speed === s} className={pb.speed === s ? "on" : ""} onClick={() => pb.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="controls-row sub">
        <div className="tl-legend">
          <span><i className="lg moment" /> Key moment</span>
          <span><i className="lg goal" /> Goal</span>
        </div>
        <div className="group toggles">
          <button className={`chip-toggle broadcast-toggle ${broadcast ? "on broadcast" : ""}`} onClick={() => setBroadcast(!broadcast)} aria-pressed={broadcast}>
            <Tv size={14} /> Broadcast view
          </button>
          {punditOn && (
            <button className={`chip-toggle pundit-toggle ${sound ? "on broadcast" : ""}`} onClick={() => setSound(!sound)} aria-pressed={sound}
              title="AI Pundit commentary, voiced by Azure AI Speech">
              {sound ? <Volume2 size={14} /> : <VolumeX size={14} />} Pundit voice
            </button>
          )}
          <button className={`chip-toggle ${showBetter ? "on better" : ""}`} onClick={() => setShowBetter(!showBetter)} aria-pressed={showBetter}>
            {showBetter ? <Eye size={14} /> : <EyeOff size={14} />} Better passes
          </button>
          <button className={`chip-toggle ${autoStop ? "on" : ""}`} onClick={() => setAutoStop(!autoStop)} aria-pressed={autoStop}>
            <Sparkles size={14} /> Stop at key moments
          </button>
          <span className="keys has-tip up" data-tip="Space play · ← → 5s · N next moment" aria-label="Keyboard shortcuts">
            <Keyboard size={16} />
          </span>
        </div>
      </div>
    </div>
  );
}

const TICKS = [0, 15, 30, 45, 60, 75, 90];

function Timeline({ match, pb, moments, onMoment }: { match: Match; pb: Playback; moments: Decision[]; onMoment: (d: Decision) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { asOf } = useLive();
  const [hover, setHover] = useState<{ x: number; text: string } | null>(null);
  const { t0, duration } = match.meta;
  const frac = (t: number) => ((t - t0) / duration) * 100;
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return t0 + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };
  const dragging = useRef(false);
  const tipAt = (e: React.PointerEvent, text: string) => {
    const r = ref.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, text });
  };
  const goalText = (g: MatchEvent) =>
    `Goal · ${match.teams[g.team ?? 0].short} · ${minute(g.t)}${g.score ? ` · ${g.score[0]}–${g.score[1]}` : ""}`;

  return (
    <div
      className="timeline"
      ref={ref}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        pb.seek(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).closest(".marker")) tipAt(e, minute(timeAt(e.clientX)));
        if (dragging.current) pb.seek(timeAt(e.clientX));
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => setHover(null)}
      role="slider"
      aria-label="Match timeline"
      aria-valuemin={t0}
      aria-valuemax={t0 + duration}
      aria-valuenow={Math.round(pb.t)}
    >
      {/* Goals ride above the track. */}
      <div className="lane goals">
        {match.goals.filter((g) => seen(g.t, asOf)).map((g) => (
          <span
            key={g.id}
            className="marker goal"
            style={{ left: `${frac(g.t)}%`, background: match.teams[g.team ?? 0].color }}
            onPointerMove={(e) => tipAt(e, goalText(g))}
          />
        ))}
      </div>

      <div className="track">
        <div className="fill" style={{ width: `${frac(pb.t)}%` }} />
        <div className="half" />
      </div>
      <div className="knob" style={{ left: `${frac(pb.t)}%` }} />

      {/* Key moments sit just below it. */}
      <div className="lane moments">
        {moments.map((d) => (
          <button
            key={d.id}
            className="marker moment"
            style={{ left: `${frac(d.t)}%` }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => tipAt(e, `${minute(d.t)} · ${VERDICT[d.verdict].label} · #${match.players[d.player].number}`)}
            onClick={() => onMoment(d)}
            aria-label={`Key moment at ${minute(d.t)}: ${VERDICT[d.verdict].label}`}
          />
        ))}
      </div>

      <div className="ticks">
        {TICKS.map((m) => (
          <span key={m} style={{ left: `${(m / 90) * 100}%` }}>{m === 45 ? "HT" : `${m}'`}</span>
        ))}
      </div>

      {hover && <div className="time-tip" style={{ left: hover.x }}>{hover.text}</div>}
    </div>
  );
}
