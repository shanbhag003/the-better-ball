import { Play, RotateCcw, X } from "lucide-react";
import { scoreAt, type Interlude } from "../data";
import { liveStats } from "../live";
import type { Match } from "../types";

interface Props {
  match: Match;
  interlude: Interlude;
  onContinue: () => void; // half-time: start the second half now
  onRestart: () => void; // full-time: watch again
  onClose: () => void;
}

/** TV-style half-time / full-time graphic over the empty pitch. */
export function ScoreBoard({ match, interlude, onContinue, onRestart, onClose }: Props) {
  const { kind, t } = interlude;
  const score = scoreAt(match, t);
  const stats = liveStats(match, kind === "ft" ? null : t).teamStats;
  const scorers = (team: number) => {
    const byPlayer = new Map<number, string[]>();
    for (const g of match.goals) {
      if (g.t > t || g.team !== team || g.player === null) continue;
      byPlayer.set(g.player, [...(byPlayer.get(g.player) ?? []), `${Math.floor(g.t / 60) + 1}'`]);
    }
    return [...byPlayer].map(([p, mins]) => `${match.players[p].name.split(" ").slice(-1)[0]} ${mins.join(", ")}`);
  };
  const rows: [string, (k: number) => string][] = [
    ["Shots", (k) => String(stats[k]?.shots ?? 0)],
    ["Good decisions", (k) => `${Math.round(stats[k]?.decision_score ?? 0)}%`],
  ];

  return (
    <div className="scoreboard-tv" role="status" aria-live="polite">
      <div className="sb-strip">{kind === "ht" ? "HALF-TIME" : "FULL-TIME"}</div>
      <div className="sb-main">
        {match.teams.map((tm, k) => (
          <div key={k} className={`sb-team ${k ? "away" : "home"}`}>
            <span className="sb-bar" style={{ background: tm.color }} />
            <span className="sb-name">{tm.name}</span>
          </div>
        ))}
        <div className="sb-score">{score[0]}<span>–</span>{score[1]}</div>
        {[0, 1].map((k) => (
          <div key={k} className={`sb-scorers ${k ? "away" : "home"}`}>
            {scorers(k).map((s) => <span key={s}>⚽ {s}</span>)}
          </div>
        ))}
      </div>
      <div className="sb-stats">
        {rows.map(([label, v]) => (
          <div key={label} className="sb-stat">
            <b>{v(0)}</b>
            <span>{label}</span>
            <b>{v(1)}</b>
          </div>
        ))}
      </div>
      <div className="sb-actions">
        {kind === "ht" ? (
          <button className="btn primary" onClick={onContinue}><Play size={15} fill="currentColor" /> Second half</button>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}><X size={15} /> Close</button>
            <button className="btn primary" onClick={onRestart}><RotateCcw size={15} /> Watch again</button>
          </>
        )}
      </div>
    </div>
  );
}
