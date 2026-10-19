import { CircleHelp, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coach } from "./components/Coach";
import { Controls } from "./components/Controls";
import { DecisionCard } from "./components/DecisionCard";
import { Onboarding } from "./components/Onboarding";
import { Pitch } from "./components/Pitch";
import { Sidebar } from "./components/Sidebar";
import { clock, loadMatch, scoreAt } from "./data";
import { Playback, usePlayback } from "./playback";
import type { Decision, Match } from "./types";

const DATA_URL = `${import.meta.env.BASE_URL}data/match_7.json`;
const ONBOARD_KEY = "tbb-onboarded-v1";
const LEAD_IN = 4; // seconds of build-up shown before a key moment

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* storage unavailable */
  }
}

export default function App() {
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pb = useMemo(() => new Playback(), []);

  useEffect(() => {
    loadMatch(DATA_URL)
      .then((m) => {
        pb.min = m.meta.t0;
        pb.max = m.meta.t0 + m.meta.duration;
        pb.seek(m.meta.t0);
        setMatch(m);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [pb]);

  if (error) return <div className="splash">⚠️ {error}</div>;
  if (!match) return <div className="splash"><div className="spinner" /> Loading match…</div>;
  return <Replay match={match} pb={pb} />;
}

function Replay({ match, pb }: { match: Match; pb: Playback }) {
  usePlayback(pb);
  const [selected, setSelected] = useState<Decision | null>(null);
  const [showBetter, setShowBetter] = useState(true);
  const [autoStop, setAutoStop] = useState(true);
  const [teamFilter, setTeamFilter] = useState<number | null>(null);
  const [playerFilter, setPlayerFilter] = useState<number | null>(null);
  const [onboarding, setOnboarding] = useState(() => !readFlag(ONBOARD_KEY));
  const [started, setStarted] = useState(false);
  const [coach, setCoach] = useState(false); // spotlight walkthrough
  const [tourOn, setTourOn] = useState(false); // stepping through moments
  const [tourIdx, setTourIdx] = useState(0);
  const pending = useRef<Decision | null>(null);

  const moments = useMemo(() => {
    if (playerFilter !== null) {
      // A player's own biggest missed chances.
      return match.decisions
        .filter((d) => d.player === playerFilter && !d.set_piece && d.cost >= match.meta.good_threshold)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10)
        .sort((a, b) => a.t - b.t);
    }
    return match.keyMoments.filter((d) => teamFilter === null || d.team === teamFilter);
  }, [match, teamFilter, playerFilter]);

  const goTo = useCallback(
    (d: Decision) => {
      setStarted(true);
      setSelected(null);
      setTourIdx(Math.max(0, moments.indexOf(d)));
      pending.current = d;
      pb.pause();
      pb.setSpeed(1);
      pb.seek(d.t - LEAD_IN);
      pb.play();
    },
    [pb, moments],
  );

  const startTour = useCallback(() => {
    pb.pause();
    setSelected(null);
    setCoach(true);
  }, [pb]);

  // Auto-stop at the requested moment, and (optionally) at every key moment.
  useEffect(() => {
    pb.stopAt = (from, to) => {
      const p = pending.current;
      if (p && from < p.t && to >= p.t) return p.t;
      if (autoStop) {
        const hit = moments.find((d) => from < d.t && to >= d.t);
        if (hit) return hit.t;
      }
      return null;
    };
    pb.onStop = (t) => {
      const d = pending.current && Math.abs(pending.current.t - t) < 1e-6 ? pending.current : moments.find((m) => m.t === t) ?? null;
      pending.current = null;
      setSelected(d);
    };
  }, [pb, moments, autoStop]);

  // Drop the card once playback moves on.
  useEffect(() => {
    if (selected && Math.abs(pb.t - selected.t) > 2) setSelected(null);
  });

  const nextMoment = useMemo(() => {
    const ref = selected?.t ?? pb.t;
    return moments.find((d) => d.t > ref + 0.01) ?? null;
  }, [moments, selected, pb.t]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setStarted(true);
        pb.toggle();
      } else if (e.key === "ArrowLeft") pb.seek(pb.t - 5);
      else if (e.key === "ArrowRight") pb.seek(pb.t + 5);
      else if (e.key.toLowerCase() === "n" && nextMoment) goTo(nextMoment);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pb, nextMoment, goTo]);

  const showCard = selected && !pb.playing && Math.abs(pb.t - selected.t) < 0.3;

  return (
    <div className="app">
      <Header match={match} pb={pb} onHelp={() => setOnboarding(true)} />

      <main className="layout">
        <section className="stage">
          <div className="pitch-card card">
            <div className="pitch-legend">
              <span><i className="line played" /> Played</span>
              <span><i className="line better" /> Better option</span>
              {showCard && (selected!.chosen.beaten?.length || selected!.best.beaten?.length) ? (
                <span><i className="ring" /> Defender beaten</span>
              ) : null}
              {showCard && selected!.offside_line !== null && selected!.offside_line !== undefined && (
                <span><i className="offline" /> Offside line</span>
              )}
              <span className="muted">Hover a player for details</span>
            </div>
            <Pitch match={match} pb={pb} selected={selected} showBetter={showBetter} />

            {!started && !pb.playing && (
              <button className="big-play" onClick={() => { setStarted(true); pb.play(); }}>
                <span className="circle"><Play size={30} fill="currentColor" /></span>
                <span>Play match</span>
              </button>
            )}

            {showCard && (
              <DecisionCard
                match={match}
                d={selected!}
                onReplay={() => goTo(selected!)}
                onNext={nextMoment ? () => goTo(nextMoment) : null}
                nextLabel={tourOn ? `Next · ${tourIdx + 2}/${moments.length}` : "Next moment"}
                onFinish={tourOn ? () => { setTourOn(false); setSelected(null); } : null}
                onClose={() => setSelected(null)}
              />
            )}

            {tourOn && (
              <div className="tour-banner pop">
                <span className="tb-label">Guided tour</span>
                <span className="tb-count"><b>{tourIdx + 1}</b> / {moments.length}</span>
                <span className="tb-bar"><span style={{ width: `${((tourIdx + 1) / Math.max(1, moments.length)) * 100}%` }} /></span>
                <button className="icon-btn sm" onClick={() => setTourOn(false)} aria-label="Exit tour"><X size={15} /></button>
              </div>
            )}
          </div>
          <Controls
            match={match}
            pb={pb}
            showBetter={showBetter}
            setShowBetter={setShowBetter}
            autoStop={autoStop}
            setAutoStop={setAutoStop}
            moments={moments}
            onMoment={goTo}
          />
        </section>

        <Sidebar
          match={match}
          moments={moments}
          activeId={selected?.id ?? null}
          onMoment={goTo}
          onTour={startTour}
          playerFilter={playerFilter}
          setPlayerFilter={setPlayerFilter}
          teamFilter={teamFilter}
          setTeamFilter={setTeamFilter}
        />
      </main>

      {onboarding && (
        <Onboarding
          onDone={(tour) => {
            writeFlag(ONBOARD_KEY);
            setOnboarding(false);
            if (tour) startTour();
          }}
        />
      )}

      {coach && (
        <Coach
          onExit={() => setCoach(false)}
          onFinish={() => {
            setCoach(false);
            setTourOn(true);
            if (moments[0]) goTo(moments[0]);
          }}
        />
      )}
    </div>
  );
}

function Header({ match, pb, onHelp }: { match: Match; pb: Playback; onHelp: () => void }) {
  usePlayback(pb);
  const [h, a] = match.teams;
  const score = scoreAt(match, pb.t);
  const c = clock(match, pb.t);
  return (
    <header className="header">
      <div className="brand">
        <span className="logo">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7l4 3-1.5 4.5h-5L8 10z" fill="currentColor" />
          </svg>
        </span>
        <span className="brand-text">
          <span className="brand-name">The Better Ball</span>
          <span className="brand-sub">Synthetic match · fictional clubs</span>
        </span>
      </div>

      <div className="scoreboard" aria-live="polite">
        <span className="team"><span className="dot" style={{ background: h.color }} /><span className="tname">{h.name}</span><span className="tshort">{h.short}</span></span>
        <span className="score">{score[0]}<span className="sep">–</span>{score[1]}</span>
        <span className="team right"><span className="tname">{a.name}</span><span className="tshort">{a.short}</span><span className="dot" style={{ background: a.color }} /></span>
        <span className="clock">{c.label} <span className="muted">· {c.half}</span></span>
      </div>

      <button className="btn ghost help" onClick={onHelp}>
        <CircleHelp size={16} /> <span>How it works</span>
      </button>
    </header>
  );
}
