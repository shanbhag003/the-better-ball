import { ArrowRight, Check, ChevronRight, Info, RotateCcw, X } from "lucide-react";
import { goalPct, minute, pct, VERDICT } from "../labels";
import type { Decision, Match, Option } from "../types";

interface Props {
  match: Match;
  d: Decision;
  onReplay: () => void;
  onNext: (() => void) | null;
  nextLabel: string;
  onFinish: (() => void) | null;
  onClose: () => void;
}

export function DecisionCard({ match, d, onReplay, onNext, nextLabel, onFinish, onClose }: Props) {
  const p = match.players[d.player];
  const v = VERDICT[d.verdict];
  const missed = d.cost >= match.meta.good_threshold;
  return (
    <div className={`decision card pop ${d.start[0] < 52.5 ? "right" : "left"}`} role="dialog" aria-label="Decision breakdown">
      <div className="dc-head">
        <span className={`verdict ${v.tone}`}>{missed ? null : <Check size={14} />}{v.label}</span>
        <span className="muted">{minute(d.t)}</span>
        <span className="dc-hint muted">{v.hint}</span>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="dc-who">
        <span className="num" style={{ background: match.teams[p.team].color }}>{p.number}</span>
        <div>
          <b>{p.name}</b>
          <div className="muted small">{p.position} · {match.teams[p.team].short}</div>
        </div>
      </div>

      <div className={`dc-compare ${missed ? "" : "single"}`}>
        <OptionBox match={match} label="Played" o={d.chosen} outcome={d.outcome} tone="played" />
        {missed && <OptionBox match={match} label="Better" o={d.best} tone="better" />}
      </div>

      {missed && (
        <div className="dc-cost">
          <span className="big">+{goalPct(d.cost)}</span>
          <span className="muted">goal chance missed</span>
        </div>
      )}

      <div className="dc-actions">
        <button className="btn ghost" onClick={onReplay}><RotateCcw size={15} /> Replay</button>
        {onNext && <button className="btn primary" onClick={onNext}>{nextLabel} <ChevronRight size={16} /></button>}
        {!onNext && onFinish && <button className="btn primary" onClick={onFinish}><Check size={16} /> Finish tour</button>}
      </div>
    </div>
  );
}

function OptionBox({ match, label, o, outcome, tone }: { match: Match; label: string; o: Option; outcome?: string | null; tone: "played" | "better" }) {
  const r = o.receiver !== null ? match.players[o.receiver] : null;
  return (
    <div className={`opt ${tone}`}>
      <div className="opt-label">
        <span className={`line ${tone}`} /> {label}
        {outcome && <span className={`outcome ${outcome}`}>{OUTCOME[outcome] ?? outcome}</span>}
      </div>
      <div className="opt-target">
        <ArrowRight size={14} />
        {r ? <><b>#{r.number}</b> {r.name.split(" ")[1]}</> : <b>{o.style === "header" ? "Header" : "Shot"}</b>}
      </div>
      <Metric name="Arrives" hint={o.kind === "shot" ? "Chance the shot scores" : "Chance the pass reaches the receiver"} value={pct(o.p)} />
      <Metric name="Goal chance" hint="Chance this move ends in a goal" value={goalPct(o.ev)} strong />
      {o.bypassed > 0 && (
        <div className={`tag beat ${tone}`} title="Ringed on the pitch">
          <i className="ring" /> Beats {o.bypassed} defender{o.bypassed > 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

function Metric({ name, hint, value, strong }: { name: string; hint: string; value: string; strong?: boolean }) {
  return (
    <div className="metric">
      <span className="muted has-tip" data-tip={hint}>{name} <Info size={12} /></span>
      <span className={strong ? "val strong" : "val"}>{value}</span>
    </div>
  );
}

const OUTCOME: Record<string, string> = {
  complete: "Completed",
  intercepted: "Intercepted",
  out: "Out of play",
  goal: "Goal",
  saved: "Saved",
  off_target: "Off target",
  blocked: "Blocked",
};
