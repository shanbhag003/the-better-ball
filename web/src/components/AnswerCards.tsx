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
  const defenders = c.focus === "defenders";
  const Y = (y: number) => 68 - y;
  const s = c.start ?? c.played.target;
  const name = (i: number) => `#${match.players[i].number} ${match.players[i].name.split(" ")[1]}`;

  // Frame the action: passer, both targets and (for defending) the key defenders, with a margin.
  const focusPts: [number, number][] = [s, c.played.target, c.better.target];
  const pos = (i: number | null | undefined) => (i != null && c.players ? ([c.players[i].x, c.players[i].y] as [number, number]) : null);
  if (defenders) for (const i of [c.interceptor, c.threat]) { const q = pos(i); if (q) focusPts.push(q); }
  const xs = focusPts.map((q) => q[0]);
  const ys = focusPts.map((q) => Y(q[1]));
  let x0 = Math.min(...xs) - 9, x1 = Math.max(...xs) + 9, y0 = Math.min(...ys) - 9, y1 = Math.max(...ys) + 9;
  // Keep the pitch aspect (105:68) and stay within the pitch.
  const aspect = 105 / 68;
  if ((x1 - x0) / (y1 - y0) < aspect) { const w = (y1 - y0) * aspect; const cx = (x0 + x1) / 2; x0 = cx - w / 2; x1 = cx + w / 2; }
  else { const h = (x1 - x0) / aspect; const cy = (y0 + y1) / 2; y0 = cy - h / 2; y1 = cy + h / 2; }
  const vw = Math.min(109, x1 - x0), vh = vw / aspect;
  const vx = Math.max(-2, Math.min(107 - vw, x0)), vy = Math.max(-2, Math.min(70 - vh, y0));
  const k = vw / 109; // text and markers scale with the zoom

  const marks = new Map<number, { color: string; dash?: boolean; label?: string }>();
  if (defenders) {
    for (const i of c.beaten_played ?? []) marks.set(i, { color: "#ffffff", dash: true });
    for (const i of c.beaten_better ?? []) marks.set(i, { color: "#00ff85", dash: true });
    if (c.threat != null) marks.set(c.threat, { color: "#ffb900", label: "Main threat" });
    if (c.interceptor != null) marks.set(c.interceptor, { color: "#ff4d8d", label: "Won the ball" });
  } else {
    if (c.played.receiver != null) marks.set(c.played.receiver, { color: "#ffffff" });
    if (c.better.receiver != null) marks.set(c.better.receiver, { color: "#00ff85" });
  }

  const caption = defenders
    ? [
        c.interceptor != null ? `${name(c.interceptor)} won the ball` : c.outcome === "complete" ? "Pass completed" : null,
        c.threat != null && c.threat !== c.interceptor ? `${name(c.threat)} was the main threat` : null,
        c.beaten_better?.length ? `better pass beats ${c.beaten_better.length}` : null,
      ].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="acard">
      <div className="ac-head">
        <span className="num" style={{ background: match.teams[p.team].color }}>{p.number}</span>
        <div>
          <b>{p.name}</b> <span className="muted small">{minute(c.t)}</span>
          <div><span className={`verdict sm ${v.tone}`}>{v.label}</span>{defenders && <span className="tag focus">Defending view</span>}</div>
        </div>
        <span className="gain">+{goalPct(c.cost)}</span>
      </div>
      <svg className="mini-pitch" viewBox={`${vx} ${vy} ${vw} ${vh}`} role="img" aria-label={defenders ? "Defenders around the pass" : "Played pass and better option"}>
        <rect x="-2" y="-2" width="109" height="72" className="mp-grass" />
        <g className="mp-lines" style={{ strokeWidth: 0.5 * k }}>
          <rect x="0" y="0" width="105" height="68" />
          <line x1="52.5" y1="0" x2="52.5" y2="68" />
          <circle cx="52.5" cy="34" r="9.15" />
          <rect x="0" y="13.84" width="16.5" height="40.32" />
          <rect x="88.5" y="13.84" width="16.5" height="40.32" />
        </g>
        {c.players?.map((q, i) => (
          <circle key={i} cx={q.x} cy={Y(q.y)} r={1.5 * Math.max(0.6, k)} fill={match.teams[q.team].color}
            opacity={i === c.player || marks.has(i) ? 1 : defenders && q.team !== p.team ? 0.75 : 0.35} />
        ))}
        <line x1={s[0]} y1={Y(s[1])} x2={c.played.target[0]} y2={Y(c.played.target[1])} className="mp-played" style={{ strokeWidth: 1.1 * k }} markerEnd="url(#mp-head-w)" />
        <line x1={s[0]} y1={Y(s[1])} x2={c.better.target[0]} y2={Y(c.better.target[1])} className="mp-better" style={{ strokeWidth: 1.1 * k }} markerEnd="url(#mp-head-g)" />
        {[...marks.entries()].map(([i, mk]) => {
          const q = pos(i);
          if (!q) return null;
          return (
            <g key={`m${i}`}>
              <circle cx={q[0]} cy={Y(q[1])} r={3 * Math.max(0.6, k)} fill="none" stroke={mk.color}
                strokeWidth={0.7 * Math.max(0.6, k)} strokeDasharray={mk.dash ? `${1.2 * k} ${1 * k}` : undefined} />
              {mk.label && (
                <text x={q[0]} y={Y(q[1]) - 4.2 * Math.max(0.6, k)} textAnchor="middle" className="mp-label" style={{ fontSize: 2.8 * Math.max(0.6, k), fill: mk.color }}>
                  {name(i)} · {mk.label}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={s[0]} cy={Y(s[1])} r={2.2 * Math.max(0.6, k)} fill={match.teams[p.team].color} stroke="#fff" strokeWidth={0.6 * k} />
        <defs>
          <marker id="mp-head-w" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fff" /></marker>
          <marker id="mp-head-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#00ff85" /></marker>
        </defs>
      </svg>
      {caption && <div className="ac-caption small">{caption}</div>}
      <div className="ac-foot">
        <span className="small"><i className="line played" /> {pct(c.played.p)} · {goalPct(c.played.ev)}</span>
        <span className="small"><i className="line better" /> {pct(c.better.p)} · {goalPct(c.better.ev)}</span>
        <button className="btn ghost sm" onClick={() => watch(c.moment_id)}><Play size={12} fill="currentColor" /> Watch</button>
      </div>
    </div>
  );
}
