import { CircleHelp, Play, Sparkles, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { GUIDE, goalPct, minute, VERDICT } from "../labels";
import type { Decision, Match } from "../types";

interface Props {
  match: Match;
  moments: Decision[];
  activeId: number | null;
  onMoment: (d: Decision) => void;
  onTour: () => void;
  playerFilter: number | null;
  setPlayerFilter: (p: number | null) => void;
  teamFilter: number | null;
  setTeamFilter: (t: number | null) => void;
}

export function Sidebar(props: Props) {
  const [tab, setTab] = useState<"moments" | "players">("moments");
  return (
    <aside className="sidebar card">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "moments"} className={tab === "moments" ? "on" : ""} onClick={() => setTab("moments")}>
          <Sparkles size={15} /> Key moments
        </button>
        <button role="tab" aria-selected={tab === "players"} className={tab === "players" ? "on" : ""} onClick={() => setTab("players")}>
          <Users size={15} /> Players
        </button>
      </div>
      {tab === "moments" ? <Moments {...props} /> : <Players {...props} onPick={(p) => { props.setPlayerFilter(p); setTab("moments"); }} />}
    </aside>
  );
}

function Moments({ match, moments, activeId, onMoment, onTour, playerFilter, setPlayerFilter, teamFilter, setTeamFilter }: Props) {
  const fp = playerFilter !== null ? match.players[playerFilter] : null;
  const [guide, setGuide] = useState(false);
  return (
    <div className="panel">
      <button className="btn primary wide" onClick={onTour} disabled={!moments.length}>
        <Play size={15} fill="currentColor" /> Guided tour
        <span className="sub">{moments.length} moments</span>
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
        {moments.length === 0 && <div className="empty">No missed chances here 👏</div>}
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
  const rows = useMemo(
    () =>
      match.players
        .filter((p) => p.team === team)
        .map((p) => ({ p, s: match.playerStats[String(p.idx)] }))
        .filter((r) => r.s && r.s.decisions >= 5)
        .sort((a, b) => b.s.decision_score - a.s.decision_score),
    [match, team],
  );
  const ts = match.teamStats[String(team)];
  return (
    <div className="panel">
      <div className="segmented full">
        {match.teams.map((t) => (
          <button key={t.idx} className={team === t.idx ? "on" : ""} onClick={() => setTeam(t.idx)}>
            <span className="dot" style={{ background: t.color }} /> {t.name}
          </button>
        ))}
      </div>
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
