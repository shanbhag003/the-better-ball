import { CircleHelp, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coach } from "./components/Coach";
import { Controls } from "./components/Controls";
import { DecisionCard } from "./components/DecisionCard";
import { Onboarding } from "./components/Onboarding";
import { Pitch } from "./components/Pitch";
import { ScoreBoard } from "./components/ScoreBoard";
import { Sidebar } from "./components/Sidebar";
import { BOARD_DELAY, clock, loadMatch, scoreAt, type Interlude } from "./data";
import { useAiPrefs } from "./aiPrefs";
import { prefetchPundit } from "./pundit";
import { AiBadge } from "./components/Ai";
import { cutoffFor, LiveContext, seen } from "./live";
import { Playback, usePlayback } from "./playback";
import type { Decision, Match } from "./types";

const DATA_URL = `${import.meta.env.BASE_URL}data/match_7.json`;
const ONBOARD_KEY = "tbb-onboarded-v1";
const HELP_KEY = "tbb-help-opened";
const BROADCAST_OFF_KEY = "tbb-broadcast-off";
const MUTE_KEY = "tbb-pundit-muted";
const PUNDIT_LANGUAGE = "British English"; // the pundit voice is British English only
const LEAD_IN = 4; // seconds of build-up shown before a key moment

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
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
  const [broadcast, setBroadcastState] = useState(() => readFlag(BROADCAST_OFF_KEY) === false);
  const setBroadcast = (on: boolean) => {
    setBroadcastState(on);
    writeValue(BROADCAST_OFF_KEY, on ? "0" : "1");
  };
  const [breakdownDone, setBreakdownDone] = useState(false);
  const aiPrefs = useAiPrefs();
  const [sound, setSoundState] = useState(() => !readFlag(MUTE_KEY));
  const setSound = (on: boolean) => {
    setSoundState(on);
    writeValue(MUTE_KEY, on ? "0" : "1");
  };
  const punditOn = broadcast && aiPrefs.health !== null;
  const prefetch = useCallback(
    (id: number) => {
      if (punditOn) prefetchPundit(id, aiPrefs.voice, PUNDIT_LANGUAGE);
    },
    [punditOn, aiPrefs.voice],
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [autoStop, setAutoStop] = useState(true);
  const [teamFilter, setTeamFilter] = useState<number | null>(null);
  const [playerFilter, setPlayerFilter] = useState<number | null>(null);
  const [onboarding, setOnboarding] = useState(() => !readFlag(ONBOARD_KEY));
  // Nudge first-time visitors towards "How it works" until they open it once.
  const [helpOpened, setHelpOpened] = useState(() => readFlag(HELP_KEY));
  const [started, setStarted] = useState(false);
  const [coach, setCoach] = useState(false); // spotlight walkthrough
  const [tourOn, setTourOn] = useState(false); // stepping through moments
  const [tourIdx, setTourIdx] = useState(0);
  const pending = useRef<Decision | null>(null);

  // Half-time and full-time breaks: players walk off, then the TV score graphic.
  const kickoff2 = match.kickoff2;
  const htStop = kickoff2 - 0.2; // last frame of the first half
  const [interlude, setInterlude] = useState<Interlude | null>(null);
  const [boardUp, setBoardUp] = useState(false); // the graphic comes up once the players are off
  useEffect(() => {
    setBoardUp(false);
    if (!interlude) return;
    const id = window.setTimeout(() => setBoardUp(true), BOARD_DELAY * 1000);
    return () => window.clearTimeout(id);
  }, [interlude]);
  const secondHalf = useCallback(() => {
    setInterlude(null);
    pb.seek(kickoff2);
    pb.play();
  }, [pb, kickoff2]);
  useEffect(() => {
    if (interlude?.kind !== "ht") return;
    const id = window.setTimeout(secondHalf, (BOARD_DELAY + 6) * 1000);
    return () => window.clearTimeout(id);
  }, [interlude, secondHalf]);
  // Seeking away or pressing play ends the break.
  useEffect(() => {
    if (interlude && (pb.playing || Math.abs(pb.t - interlude.t) > 0.5)) setInterlude(null);
  });

  const allMoments = useMemo(() => {
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

  // Live mode starts once the tour is over (or skipped); the tour previews the full match.
  const touring = onboarding || coach || tourOn;
  const asOf = cutoffFor(match, pb.t, !touring);
  const minuteKey = asOf === null ? -1 : asOf;
  const moments = useMemo(
    () => allMoments.filter((d) => seen(d.t, asOf)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allMoments, minuteKey],
  );

  const goTo = useCallback(
    (d: Decision) => {
      setStarted(true);
      setSelected(null);
      setTourIdx(Math.max(0, allMoments.indexOf(d)));
      pending.current = d;
      prefetch(d.id);
      pb.pause();
      pb.setSpeed(1);
      pb.seek(d.t - LEAD_IN);
      pb.play();
    },
    [pb, allMoments, prefetch],
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
      if (!p && from < htStop && to >= htStop) return htStop;
      if (autoStop) {
        const soon = allMoments.find((d) => d.t > to && d.t - to < 10);
        if (soon) prefetch(soon.id);
        const hit = allMoments.find((d) => from < d.t && to >= d.t);
        if (hit) return hit.t;
      }
      return null;
    };
    pb.onStop = (t) => {
      if (t === htStop && !pending.current) {
        setSelected(null);
        setInterlude({ kind: "ht", t, start: performance.now() });
        return;
      }
      const d = pending.current && Math.abs(pending.current.t - t) < 1e-6 ? pending.current : allMoments.find((m) => m.t === t) ?? null;
      pending.current = null;
      setSelected(d);
    };
    pb.onEnd = () => {
      setSelected(null);
      setInterlude({ kind: "ft", t: pb.max, start: performance.now() });
    };
  }, [pb, allMoments, autoStop, prefetch, htStop]);

  // Drop the card once playback moves on.
  useEffect(() => {
    if (selected && Math.abs(pb.t - selected.t) > 2) setSelected(null);
  });

  const nextMoment = useMemo(() => {
    const ref = selected?.t ?? pb.t;
    return allMoments.find((d) => d.t > ref + 0.01) ?? null;
  }, [allMoments, selected, pb.t]);

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

  // In broadcast mode the lower-third shows first; the full card follows on its own so it isn't missed.
  useEffect(() => {
    if (!broadcast || !breakdownDone) return;
    const id = window.setTimeout(() => setDetailsOpen(true), 2500);
    return () => window.clearTimeout(id);
  }, [broadcast, breakdownDone, selected?.id]);

  const atMoment = !!selected && Math.abs(pb.t - selected.t) < 0.3;
  const showCard = selected && !pb.playing && Math.abs(pb.t - selected.t) < 0.3 && (!broadcast || (breakdownDone && detailsOpen));

  const live = useMemo(
    () => ({
      asOf,
      watch: (id: number) => {
        const d = match.byId.get(id);
        if (d) goTo(d);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minuteKey, goTo, match],
  );

  return (
    <LiveContext.Provider value={live}>
    <div className="app">
      <Header
        match={match}
        pb={pb}
        nudge={!helpOpened && !touring}
        onHelp={() => {
          writeFlag(HELP_KEY);
          setHelpOpened(true);
          setOnboarding(true);
        }}
      />

      <main className="layout">
        <section className="stage">
          <div className={`pitch-card card ${broadcast ? "broadcast" : ""}`}>
            <div className="pitch-legend">
              <span><i className="line played" /> Played</span>
              <span><i className="line better" /> Better option</span>
              <span><i className="arc" /> Lofted</span>
              {showCard && (selected!.chosen.beaten?.length || selected!.best.beaten?.length) ? (
                <span><i className="ring" /> Defender beaten</span>
              ) : null}
              {showCard && selected!.offside_line !== null && selected!.offside_line !== undefined && (
                <span><i className="offline" /> Offside line</span>
              )}
              {atMoment && selected!.face != null && (
                <span className="has-tip down" data-tip="What he can play without turning"><i className="lg-fov" /> Field of view</span>
              )}
              {atMoment && (
                <span className="has-tip down" data-tip="Green: clear · amber: tight · red: likely cut out"><i className="lg-lane" /> Passing lane</span>
              )}
              <span className="muted">Hover a player for details</span>
            </div>
            <Pitch match={match} pb={pb} selected={selected} showBetter={showBetter} broadcast={broadcast}
              onBreakdown={(done) => { setBreakdownDone(done); if (!done) setDetailsOpen(false); }}
              onDetails={() => setDetailsOpen(true)}
              onNext={nextMoment ? () => goTo(nextMoment) : null}
              pundit={punditOn ? { voice: aiPrefs.voice, language: PUNDIT_LANGUAGE, sound } : null}
              interlude={interlude}
            />

            {!started && !pb.playing && !interlude && (
              <button className="big-play" onClick={() => { setStarted(true); pb.play(); }}>
                <span className="circle"><Play size={30} fill="currentColor" /></span>
                <span>Play match</span>
              </button>
            )}

            {interlude && boardUp && (
              <ScoreBoard
                key={interlude.start}
                match={match}
                interlude={interlude}
                onContinue={secondHalf}
                onRestart={() => { setInterlude(null); pb.seek(pb.min); pb.play(); }}
                onClose={() => setInterlude(null)}
              />
            )}

            {showCard && (
              <DecisionCard
                match={match}
                d={selected!}
                onReplay={() => goTo(selected!)}
                onNext={nextMoment ? () => goTo(nextMoment) : null}
                nextLabel={tourOn ? `Next · ${tourIdx + 2}/${allMoments.length}` : "Next moment"}
                onFinish={tourOn ? () => { setTourOn(false); setSelected(null); } : null}
                onClose={() => (broadcast ? setDetailsOpen(false) : setSelected(null))}
              />
            )}

            {tourOn && (
              <div className="tour-banner pop">
                <span className="tb-label">Guided tour</span>
                <span className="tb-count"><b>{tourIdx + 1}</b> / {allMoments.length}</span>
                <span className="tb-bar"><span style={{ width: `${((tourIdx + 1) / Math.max(1, allMoments.length)) * 100}%` }} /></span>
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
            broadcast={broadcast}
            setBroadcast={setBroadcast}
            sound={sound}
            setSound={setSound}
            punditOn={punditOn}
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
          totalMoments={allMoments.length}
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
            if (allMoments[0]) goTo(allMoments[0]);
          }}
        />
      )}
    </div>
    </LiveContext.Provider>
  );
}

function Header({ match, pb, nudge, onHelp }: { match: Match; pb: Playback; nudge: boolean; onHelp: () => void }) {
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

      <div className="head-right">
      <AiStatus />
      <button className={`btn ghost help ${nudge ? "nudge" : ""}`} onClick={onHelp}>
        <CircleHelp size={16} /> <span>How it works</span>
      </button>
      </div>
    </header>
  );
}

function AiStatus() {
  const { health } = useAiPrefs();
  if (!health) return <span className="ai-badge off" title="Start the API service to enable AI features">AI offline</span>;
  return <AiBadge a={health} />;
}
