import { Play } from "lucide-react";
import type { Card, MomentCard, PlayerCard, TeamsCard } from "../api";
import { goalPct, minute, pct, VERDICT } from "../labels";
import { useLive } from "../live";
import type { Match, Verdict } from "../types";

/** Visual cards under an AI answer. The agent picks the card; the numbers come from the engine. */
export function AnswerCards({ cards, match }: { cards: Card[]; match: Match }) {
  if (!cards.length) return null;
  return (
    <div className="answer-cards">
      {cards.map((c, i) =>
        c.kind === "player" ? <Player key={i} c={c} match={match} />
          : c.kind === "teams" ? <Teams key={i} c={c} match={match} />
            : <Moment key={i} c={c} match={match} />,
      )}
    </div>
  );
}

function Player({ c, match }: { c: PlayerCard; match: Match }) {
  const team = match.teams[c.team];
  const total = Math.max(1, c.mix.good + c.mix.missed + c.mix.risky);
  return (
    <div className="acard">
      <div className="ac-head">
        <span className="num" style={{ background: team.color }}>{c.number}</span>
        <div>
          <b>{c.name}</b>
          <div className="muted small">{c.position} · {team.short} · {c.decisions} decisions</div>
        </div>
      </div>
      <div className="ac-tiles">
        <Tile value={c.good_decisions === null ? "–" : `${c.good_decisions}%`} label="Good decisions" />
        <Tile value={c.pass_accuracy === null ? "–" : `${c.pass_accuracy}%`} label="Pass accuracy" />
        <Tile value={String(c.line_breaking)} label="Line-breaking" />
      </div>
      <div className="mix" aria-label="Decision mix">
        <span className="good" style={{ width: `${(100 * c.mix.good) / total}%` }} />
        <span className="missed" style={{ width: `${(100 * c.mix.missed) / total}%` }} />
        <span className="risky" style={{ width: `${(100 * c.mix.risky) / total}%` }} />
      </div>
      <div className="mix-legend small">
        <span><i className="good" /> Good {c.mix.good}</span>
        <span><i className="missed" /> Missed {c.mix.missed}</span>
        <span><i className="risky" /> Risky {c.mix.risky}</span>
      </div>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="ac-tile">
      <span className="val">{value}</span>
      <span className="muted small">{label}</span>
    </div>
  );
}

function Teams({ c, match }: { c: TeamsCard; match: Match }) {
  const [h, a] = match.teams;
  return (
    <div className="acard">
      <div className="ac-score">
        <span><span className="dot" style={{ background: h.color }} /> {h.short}</span>
        <b>{c.score[0]} – {c.score[1]}</b>
        <span>{a.short} <span className="dot" style={{ background: a.color }} /></span>
      </div>
      {c.rows.map((r) => {
        const max = Math.max(...r.values, r.pct ? 100 : 0.0001);
        const lead = r.values[0] === r.values[1] ? -1 : (r.values[0] > r.values[1]) !== r.lower_better ? 0 : 1;
        const fmt = (v: number) => (r.pct ? `${v}%` : String(v));
        return (
          <div key={r.label} className="vs-row">
            <span className={`vs-val ${lead === 0 ? "lead" : ""}`}>{fmt(r.values[0])}</span>
            <span className="vs-bar left"><span style={{ width: `${(100 * r.values[0]) / max}%`, background: h.color }} /></span>
            <span className="vs-label">{r.label}</span>
            <span className="vs-bar"><span style={{ width: `${(100 * r.values[1]) / max}%`, background: a.color }} /></span>
            <span className={`vs-val ${lead === 1 ? "lead" : ""}`}>{fmt(r.values[1])}</span>
          </div>
        );
      })}
    </div>
  );
}

function Moment({ c, match }: { c: MomentCard; match: Match }) {
  const { watch } = useLive();
  const p = match.players[c.player];
  const v = VERDICT[c.verdict as Verdict] ?? VERDICT.suboptimal;
  const Y = (y: number) => 68 - y;
  const s = c.start ?? c.played.target;
  return (
    <div className="acard">
      <div className="ac-head">
        <span className="num" style={{ background: match.teams[p.team].color }}>{p.number}</span>
        <div>
          <b>{p.name}</b> <span className="muted small">{minute(c.t)}</span>
          <div><span className={`verdict sm ${v.tone}`}>{v.label}</span></div>
        </div>
        <span className="gain">+{goalPct(c.cost)}</span>
      </div>
      <svg className="mini-pitch" viewBox="-2 -2 109 72" role="img" aria-label="Played pass and better option">
        <rect x="0" y="0" width="105" height="68" rx="2" className="mp-grass" />
        <g className="mp-lines">
          <rect x="0" y="0" width="105" height="68" />
          <line x1="52.5" y1="0" x2="52.5" y2="68" />
          <circle cx="52.5" cy="34" r="9.15" />
          <rect x="0" y="13.84" width="16.5" height="40.32" />
          <rect x="88.5" y="13.84" width="16.5" height="40.32" />
        </g>
        <line x1={s[0]} y1={Y(s[1])} x2={c.played.target[0]} y2={Y(c.played.target[1])} className="mp-played" markerEnd="url(#mp-head-w)" />
        <line x1={s[0]} y1={Y(s[1])} x2={c.better.target[0]} y2={Y(c.better.target[1])} className="mp-better" markerEnd="url(#mp-head-g)" />
        <circle cx={s[0]} cy={Y(s[1])} r="2.2" fill={match.teams[p.team].color} stroke="#fff" strokeWidth="0.6" />
        <defs>
          <marker id="mp-head-w" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fff" /></marker>
          <marker id="mp-head-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#00ff85" /></marker>
        </defs>
      </svg>
      <div className="ac-foot">
        <span className="small"><i className="line played" /> {pct(c.played.p)} · {goalPct(c.played.ev)}</span>
        <span className="small"><i className="line better" /> {pct(c.better.p)} · {goalPct(c.better.ev)}</span>
        <button className="btn ghost sm" onClick={() => watch(c.moment_id)}><Play size={12} fill="currentColor" /> Watch</button>
      </div>
    </div>
  );
}
