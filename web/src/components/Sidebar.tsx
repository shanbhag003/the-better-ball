import { CircleHelp, ClipboardList, MessageCircle, Play, Sparkles, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { GUIDE, goalPct, minute, VERDICT } from "../labels";
import { asOfLabel, liveStats, useLive } from "../live";
import type { Decision, Match } from "../types";
import { AskPanel } from "./AskPanel";
import { CoachPanel } from "./CoachReport";

interface Props {
  match: Match;
  moments: Decision[];
  activeId: number | null;
  onMoment: (d: Decision) => void;
  onTour: () => void;
  totalMoments: number;
  playerFilter: number | null;
  setPlayerFilter: (p: number | null) => void;
  teamFilter: number | null;
  setTeamFilter: (t: number | null) => void;
}

export function Sidebar(props: Props) {
  const [tab, setTab] = useState<"moments" | "players" | "coach" | "ask">("moments");
  return (
    <aside className="sidebar card">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "moments"} className={tab === "moments" ? "on" : ""} onClick={() => setTab("moments")}>
          <Sparkles size={15} /> Moments
        </button>
        <button role="tab" aria-selected={tab === "players"} className={tab === "players" ? "on" : ""} onClick={() => setTab("players")}>
          <Users size={15} /> Players
        </button>
        <button role="tab" aria-selected={tab === "coach"} className={`coach-tab ${tab === "coach" ? "on" : ""}`} onClick={() => setTab("coach")}>
          <ClipboardList size={15} /> Coach
        </button>
        <button role="tab" aria-selected={tab === "ask"} className={`ask-tab ${tab === "ask" ? "on" : ""}`} onClick={() => setTab("ask")}>
          <MessageCircle size={15} /> Ask AI
        </button>
      </div>
      {tab === "moments" && <Moments {...props} />}
      {tab === "players" && <Players {...props} onPick={(p) => { props.setPlayerFilter(p); setTab("moments"); }} />}
      {tab === "coach" && <CoachPanel match={props.match} />}
      {tab === "ask" && <AskPanel match={props.match} />}
    </aside>
  );
}

function Moments({ match, moments, activeId, onMoment, onTour, totalMoments, playerFilter, setPlayerFilter, teamFilter, setTeamFilter }: Props) {
  const fp = playerFilter !== null ? match.players[playerFilter] : null;
  const [guide, setGuide] = useState(false);
  const { asOf } = useLive();
  return (
    <div className="panel">
      <button className="btn primary wide" onClick={onTour} disabled={!totalMoments}>
        <Play size={15} fill="currentColor" /> Guided tour
        <span className="sub">full-match preview</span>
      </button>

      <div className="filters">
        <button className={`chip ${teamFilter === null && !fp ? "on" : ""}`} onClick={() => { setTeamFilter(null); setPlayerFilter(null); }}>All</button>
        {match.teams.map((t) => (
          <button key={t.idx} className={`chip ${teamFilter === t.idx && !fp ? "on" : ""}`} onClick={() => { setTeamFilter(t.idx); setPlayerFilter(null); }}>
            <span className="dot" style={{ background: t.color }} /> {t.short}
          </button>
        ))}
        {fp && (
          <button className="chip on" onClick={() => setPlayerFilter(null)} title="Clear player filter">
            #{fp.number} {fp.name.split(" ")[1]} ✕
          </button>
        )}
        <button className={`chip guide-btn ${guide ? "on" : ""}`} onClick={() => setGuide(!guide)} aria-expanded={guide}>
          <CircleHelp size={13} /> Labels
        </button>
      </div>

      {guide && (
        <div className="guide pop">
          {GUIDE.map((k) => (
            <div key={k} className="guide-row">
              <span className={`verdict sm ${VERDICT[k].tone}`}>{VERDICT[k].label}</span>
              <span className="muted small">{VERDICT[k].hint}</span>
            </div>
          ))}
          <div className="guide-row">
            <span className="gain">+8%</span>
            <span className="muted small">Goal chance the better option adds</span>
          </div>
        </div>
      )}

      <div className="list">
        {asOf !== null && (
          <div className="live-note"><span className="live-dot" /> Live · {moments.length} so far, {asOfLabel(asOf)}</div>
        )}
        {moments.length === 0 && (
          <div className="empty">{asOf !== null ? "No key moments yet. They appear here as the match unfolds." : "No missed chances here 👏"}</div>
        )}
        {moments.map((d) => {
          const p = match.players[d.player];
          const v = VERDICT[d.verdict];
          return (
            <button key={d.id} className={`moment-card ${activeId === d.id ? "active" : ""}`} onClick={() => onMoment(d)}>
              <span className="min">{minute(d.t)}</span>
              <span className="mc-body">
                <span className={`verdict sm ${v.tone}`} title={v.hint}>{v.label}</span>
                <span className="who">
                  <span className="dot" style={{ background: match.teams[p.team].color }} />
                  #{p.number} {p.name}
                </span>
              </span>
              <span className="gain" title="Goal chance missed">+{goalPct(d.cost)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Players({ match, onPick }: Props & { onPick: (p: number) => void }) {
  const [team, setTeam] = useState(0);
  const { asOf } = useLive();
  const { teamStats, playerStats } = useMemo(() => liveStats(match, asOf), [match, asOf]);
  const minDecisions = asOf === null ? 5 : 3;
  const rows = useMemo(
    () =>
      match.players
        .filter((p) => p.team === team)
        .map((p) => ({ p, s: playerStats[String(p.idx)] }))
        .filter((r) => r.s && r.s.decisions >= minDecisions)
        .sort((a, b) => b.s.decision_score - a.s.decision_score),
    [match, team, playerStats, minDecisions],
  );
  const ts = teamStats[String(team)];
  return (
    <div className="panel">
      <div className="segmented full">
        {match.teams.map((t) => (
          <button key={t.idx} className={team === t.idx ? "on" : ""} onClick={() => setTeam(t.idx)}>
            <span className="dot" style={{ background: t.color }} /> {t.name}
          </button>
        ))}
      </div>
      {asOf !== null && <div className="live-note"><span className="live-dot" /> Live stats, {asOfLabel(asOf)}</div>}
      {ts && (
        <div className="stat-strip">
          <Stat label="Good decisions" value={`${Math.round(ts.decision_score)}%`} hint="Passes & shots close to the best option" />
          <Stat label="Pass accuracy" value={`${Math.round(ts.pass_completion ?? 0)}%`} hint="Passes completed" />
          <Stat label="xG" value={(ts.xg ?? 0).toFixed(2)} hint="Expected goals from shots" />
        </div>
      )}
      <div className="list">
        <p className="explain muted small">
          <b>Good decisions</b> = share of passes and shots rated <span className="verdict sm good">Best</span> or{" "}
          <span className="verdict sm good">Good</span> choice.
        </p>
        <div className="list-head muted small"><span>Player</span><span>Good decisions</span></div>
        {rows.length === 0 && <div className="empty small">Too early: players appear after a few decisions.</div>}
        {rows.map(({ p, s }) => (
          <button key={p.idx} className="player-row" onClick={() => onPick(p.idx)} title="See this player's key moments">
            <span className="num" style={{ background: match.teams[p.team].color }}>{p.number}</span>
            <span className="pr-name">
              {p.name}
              <span className="muted small"> {p.position}</span>
            </span>
            <span className="bar"><span style={{ width: `${s.decision_score}%` }} /></span>
            <span className="pr-val">{Math.round(s.decision_score)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat has-tip" data-tip={hint}>
      <span className="val">{value}</span>
      <span className="muted small">{label}</span>
    </div>
  );
}
