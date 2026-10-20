import { ChevronRight, PanelRightOpen, RotateCcw, Tv } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { follow, L, projector, W, type Cam, type Geom, type Proj } from "../camera";
import { recentDecisions, snapshot } from "../data";
import { goalPct, minute, pct, VERDICT } from "../labels";
import type { Playback } from "../playback";
import type { Decision, Match } from "../types";

const MARGIN = 3.5;
const BETTER = "#00ff85";
const PLAYED = "#ffffff";
const OFFSIDE = "#ffb900";
const LINE = "#04f5ff";
const FONT = `"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif`;
const HOLD = 3.5; // real seconds a pass overlay stays readable during playback
const HANDOFF = 0.35; // real seconds an older overlay takes to fade once a new pass is played

/** Telestration timeline for a key moment in broadcast mode (seconds after it opens). */
const T = {
  spots: [0.7, 0.4],
  played: [1.1, 0.9],
  rewind: [2.2, 0.4],
  space: [2.5, 0.5],
  line: [2.7, 0.5],
  better: [3.0, 1.0],
  beaten: [3.8, 0.4],
  done: 4.3,
} as const;
const phase = (ph: number, [start, len]: readonly [number, number]) => Math.max(0, Math.min(1, (ph - start) / len));

interface Props {
  match: Match;
  pb: Playback;
  selected: Decision | null;
  showBetter: boolean;
  broadcast: boolean;
  /** Broadcast breakdown finished (true) or (re)started (false). */
  onBreakdown?: (done: boolean) => void;
  /** Lower-third actions. */
  onDetails?: () => void;
  onNext?: (() => void) | null;
}

interface Hover {
  player: number;
  x: number;
  y: number;
}

export function Pitch({ match, pb, selected, showBetter, broadcast, onBreakdown, onDetails, onNext }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ selected, showBetter, broadcast, onBreakdown });
  propsRef.current = { selected, showBetter, broadcast, onBreakdown };
  const geom = useRef<Geom>({ s: 1, ox: 0, oy: 0, w: 0, h: 0 });
  const cam = useRef<Cam>({ mode: 0, fx: L / 2, fy: W / 2, zoom: 1 });
  const projRef = useRef<Proj | null>(null);
  const posRef = useRef<[number, number][]>([]);
  const tele = useRef<{ id: number | null; start: number; done: boolean }>({ id: null, start: 0, done: false });
  const [hover, setHover] = useState<Hover | null>(null);
  const [lowerThird, setLowerThird] = useState<Decision | null>(null);

  // Size the canvas to its container.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const fit = () => {
      // The wrapper is sized by the layout; the pitch keeps its aspect inside it.
      const w = wrap.clientWidth;
      const ideal = (w * (W + MARGIN * 2)) / (L + MARGIN * 2);
      const h = wrap.clientHeight > 40 ? Math.min(wrap.clientHeight, ideal) : ideal;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const s = Math.min(w / (L + MARGIN * 2), h / (W + MARGIN * 2));
      geom.current = { s, ox: (w - L * s) / 2, oy: (h - W * s) / 2, w, h };
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  // Draw loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const canvas = canvasRef.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (canvas) render(canvas, now, dt);
      raf = requestAnimationFrame(draw);
    };

    const render = (canvas: HTMLCanvasElement, now: number, dt: number) => {
      const ctx = canvas.getContext("2d")!;
      const g = geom.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, g.w, g.h);

      const t = pb.t;
      const snap = snapshot(match, t);
      posRef.current = snap.pos;
      const { selected, showBetter, broadcast, onBreakdown } = propsRef.current;
      const sticky = selected && Math.abs(t - selected.t) < 0.25 ? selected : null;

      // ---- telestration clock (broadcast breakdown of a key moment)
      const breakdown = broadcast && sticky ? sticky : null;
      if (breakdown && tele.current.id !== breakdown.id) {
        tele.current = { id: breakdown.id, start: now, done: false };
        setLowerThird(null);
        onBreakdown?.(false);
      }
      if (!breakdown && tele.current.id !== null) {
        tele.current = { id: null, start: 0, done: false };
        setLowerThird(null);
      }
      const ph = breakdown ? (now - tele.current.start) / 1000 : 99;
      if (breakdown && !tele.current.done && ph >= T.done) {
        tele.current.done = true;
        setLowerThird(breakdown);
        onBreakdown?.(true);
      }

      // ---- camera
      const target: Cam = { mode: 0, fx: L / 2, fy: W / 2, zoom: 1 };
      if (broadcast) {
        target.mode = 1;
        if (breakdown) {
          const pts = [breakdown.start, breakdown.chosen.target, breakdown.best.target];
          target.fx = pts.reduce((a, p) => a + p[0], 0) / 3;
          target.fy = pts.reduce((a, p) => a + p[1], 0) / 3 - 1;
          const spread = Math.max(...pts.map((p) => Math.hypot(p[0] - target.fx, p[1] - target.fy)));
          target.zoom = Math.max(0.74, Math.min(1.05, 24 / Math.max(14, spread)));
        } else {
          target.fx = snap.ball[0];
          target.fy = snap.ball[1] - 4;
          target.zoom = 0.82;
        }
      }
      follow(cam.current, target, dt, breakdown ? 0.3 : 0.6);
      const proj = projector(g, cam.current);
      projRef.current = proj;
      const { P } = proj;

      drawPitch(ctx, proj, g);

      // ---- dim the pitch around the breakdown
      if (breakdown) {
        const [cx, cy] = P(cam.current.fx, cam.current.fy);
        const grad = ctx.createRadialGradient(cx, cy, g.w * 0.12, cx, cy, g.w * 0.6);
        grad.addColorStop(0, "rgba(10,0,14,0)");
        grad.addColorStop(1, `rgba(10,0,14,${0.55 * proj.mode})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, g.w, g.h);
      }

      const pulse = 0.5 + 0.5 * Math.sin(now / 220);
      const rings = new Map<number, { color: string; alpha: number }>();
      const better = (d: Decision) => showBetter && d.cost >= match.meta.good_threshold && !!d.best;

      // ---- breakdown layers under the players: space, back line, offside line, spotlights
      if (breakdown) {
        const d = breakdown;
        if (better(d) && d.best.receiver !== null) {
          drawSpace(ctx, proj, snap.pos, match, d, phase(ph, T.space));
        }
        drawBackLine(ctx, proj, snap.pos, match, d.team, snap.period, phase(ph, T.line));
        const spotA = phase(ph, T.spots);
        spotlight(ctx, proj, snap.pos[d.player], PLAYED, spotA);
        if (d.chosen.receiver !== null) spotlight(ctx, proj, snap.pos[d.chosen.receiver], PLAYED, spotA);
        if (better(d) && d.best.receiver !== null) spotlight(ctx, proj, snap.pos[d.best.receiver], BETTER, spotA);
      }
      if (sticky && sticky.offside_line != null) {
        const x = sticky.offside_line;
        line(ctx, P, [[x, 0], [x, W]], { color: OFFSIDE, width: 2, alpha: 0.85, dash: [7, 6] });
        const [lx, ly] = P(x, W);
        pill(ctx, lx, ly + 14, "Offside line", OFFSIDE, "#2a0030", 0.95);
      }

      // ---- pass overlays
      const list: { d: Decision; alpha: number; sticky: boolean }[] = sticky
        ? [{ d: sticky, alpha: 1, sticky: true }]
        : holdOverlays(recentDecisions(match, t, HOLD * pb.speed), t, pb.speed);
      const labelled = list.length ? list[list.length - 1].d : null;
      for (const { d, alpha, sticky: isSticky } of list) {
        const from = d.start;
        const withLabels = d === labelled && alpha > 0.35;
        const tele = breakdown === d;
        const playedProgress = tele ? phase(ph, T.played) : 1;
        const playedAlpha = tele ? 1 - 0.55 * phase(ph, T.rewind) : 1;
        const betterProgress = tele ? phase(ph, T.better) : 1;

        if (better(d) && betterProgress > 0) {
          passArrow(ctx, proj, from, d.best.target, {
            color: BETTER, alpha, width: isSticky ? 3.5 : 2.5, dash: [8, 6], glow: true, offset: -now / 40,
            lofted: d.best.lofted, progress: betterProgress,
          });
          if (withLabels && betterProgress >= 1) {
            const label = d.best.kind === "shot" ? `Shoot · ${pct(d.best.p)}` : `Better · ${pct(d.best.p)}${d.best.lofted ? " · lofted" : ""}`;
            const [lx, ly] = beyond(P(...from), P(...d.best.target), 30);
            pill(ctx, lx, ly, label, BETTER, "#2a0030", alpha);
          }
          if (d.best.receiver !== null && betterProgress >= 1) rings.set(d.best.receiver, { color: BETTER, alpha: alpha * (0.6 + 0.4 * pulse) });
        }
        if (playedProgress > 0) {
          passArrow(ctx, proj, from, d.chosen.target, {
            color: PLAYED, alpha: alpha * (isSticky ? 0.95 : 0.65) * playedAlpha, width: isSticky ? 3 : 2,
            lofted: d.chosen.lofted, progress: playedProgress,
          });
        }
        if (withLabels && (isSticky || better(d)) && playedProgress >= 1) {
          const lbl = d.chosen.kind === "shot" ? `Shot · ${pct(d.chosen.p)}` : `Played · ${pct(d.chosen.p)}${d.chosen.lofted ? " · lofted" : ""}`;
          const [lx, ly] = beyond(P(...from), P(...d.chosen.target), 30);
          pill(ctx, lx, ly, lbl, "#ffffff", "#1a0020", alpha * playedAlpha);
        }
        rings.set(d.player, { color: "#ffffff", alpha: alpha * 0.9 });
      }

      // ---- players (far ones first so near ones overlap them in broadcast view)
      const focus = sticky ? new Set([sticky.player, sticky.chosen.receiver, sticky.best.receiver]) : null;
      const beaten = new Map<number, string>();
      if (sticky) {
        const beatenA = breakdown ? phase(ph, T.beaten) : 1;
        if (beatenA > 0) {
          for (const i of sticky.chosen.beaten ?? []) beaten.set(i, PLAYED);
          if (better(sticky)) for (const i of sticky.best.beaten ?? []) beaten.set(i, BETTER);
        }
        beaten.forEach((_, i) => focus!.add(i));
      }
      const order = match.players.map((_, i) => i).sort((a, b) => snap.pos[b][1] - snap.pos[a][1]);
      for (const i of order) {
        const p = match.players[i];
        const [x, y] = snap.pos[i];
        const [cx, cy] = P(x, y);
        const r = Math.max(7, Math.min(17, 0.8 * proj.scale(x, y)));
        const lift = r * 0.55 * proj.mode; // stand players up a little in broadcast view
        const dim = focus && !focus.has(i) ? (breakdown ? 0.3 : 0.45) : 1;
        ctx.save();
        ctx.globalAlpha = dim;
        // Ground shadow.
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(cx, cy + 1, r * 0.95, r * (0.55 + 0.4 * (1 - proj.mode)), 0, 0, Math.PI * 2);
        ctx.fill();
        const py = cy - lift;
        const bc = beaten.get(i);
        if (bc) {
          ctx.strokeStyle = bc;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.lineDashOffset = now / 60;
          ctx.shadowColor = bc;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(cx, py, r + 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.shadowColor = "transparent";
        }
        const ring = rings.get(i);
        if (ring) {
          ctx.globalAlpha = ring.alpha * dim;
          ctx.strokeStyle = ring.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(cx, py, r + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = dim;
        }
        ctx.beginPath();
        ctx.arc(cx, py, r, 0, Math.PI * 2);
        ctx.fillStyle = match.teams[p.team].color;
        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowOffsetY = 0;
        ctx.lineWidth = p.role === "GK" ? 2.5 : 1.5;
        ctx.strokeStyle = p.role === "GK" ? "#fff6" : "#0006";
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = `700 ${Math.round(r * 0.95)}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(p.number), cx, py + 0.5);
        if (sticky && sticky.offside_players?.includes(i)) flag(ctx, cx + r * 0.6, py - r - 2);
        ctx.restore();
      }

      // ---- name tags for the players in the story
      if (breakdown) {
        const a = phase(ph, T.spots);
        const tags: [number | null, string][] = [
          [breakdown.player, PLAYED],
          [breakdown.chosen.receiver, PLAYED],
          [better(breakdown) ? breakdown.best.receiver : null, BETTER],
        ];
        const seen = new Set<number>();
        const placed: [number, number][] = []; // tag centres already drawn
        for (const [i, color] of tags) {
          if (i === null || seen.has(i)) continue;
          seen.add(i);
          const [x, y] = snap.pos[i];
          const [cx, cy] = P(x, y);
          const r = Math.max(7, Math.min(17, 0.8 * proj.scale(x, y)));
          let ty = cy - r * 0.55 * proj.mode - r - 16;
          // Nudge up until clear of earlier tags (they are ~130 x 22 px).
          while (placed.some(([px, py]) => Math.abs(px - cx) < 120 && Math.abs(py - ty) < 26)) ty -= 26;
          placed.push([cx, ty]);
          nameTag(ctx, cx, ty, match.players[i], color, a);
        }
      }

      // ---- ball with height
      const [bx, by, bz] = snap.ball;
      const [gx, gy] = P(bx, by);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(gx, gy, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      const [ballX, ballY] = P(bx, by, bz);
      ctx.beginPath();
      ctx.arc(ballX, ballY, 4.5 + bz * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(255,255,255,0.8)";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowColor = "transparent";
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [match, pb]);

  const replay = () => {
    tele.current = { id: null, start: 0, done: false };
    setLowerThird(null);
  };

  const onMove = (e: React.PointerEvent) => {
    const proj = projRef.current;
    if (!proj) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = -1;
    let bd = 16;
    posRef.current.forEach(([x, y], i) => {
      const [px, py] = proj.P(x, y);
      const d = Math.hypot(px - mx, py - my);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    const wr = wrapRef.current!.getBoundingClientRect();
    setHover(best >= 0 ? { player: best, x: e.clientX - wr.left, y: e.clientY - wr.top } : null);
  };

  const hp = hover ? match.players[hover.player] : null;
  return (
    <div className="pitch-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      {hp && hover && (
        <div className="tip" style={{ left: hover.x, top: hover.y - 14 }}>
          <span className="dot" style={{ background: match.teams[hp.team].color }} />
          <b>#{hp.number}</b> {hp.name}
          <span className="muted"> · {hp.position}</span>
        </div>
      )}
      {broadcast && lowerThird && (
        <LowerThird match={match} d={lowerThird} onReplay={replay} onDetails={onDetails} onNext={onNext ?? null} />
      )}
    </div>
  );
}

/** Broadcast lower-third graphic summarising the breakdown. */
function LowerThird({ match, d, onReplay, onDetails, onNext }: {
  match: Match;
  d: Decision;
  onReplay: () => void;
  onDetails?: () => void;
  onNext: (() => void) | null;
}) {
  const p = match.players[d.player];
  const team = match.teams[p.team];
  const v = VERDICT[d.verdict];
  const missed = d.cost >= match.meta.good_threshold;
  const who = (i: number | null) => (i === null ? "Shot" : `#${match.players[i].number} ${match.players[i].name.split(" ")[1]}`);
  return (
    <div className="lower-third" role="status">
      <div className="lt-brand"><Tv size={13} /> BETTER BALL ANALYSIS</div>
      <div className="lt-main">
        <span className="lt-bar" style={{ background: team.color }} />
        <span className="lt-num" style={{ background: team.color }}>{p.number}</span>
        <div className="lt-text">
          <div className="lt-title">
            <span className={`lt-verdict ${v.tone}`}>{v.label}</span>
            <b>{p.name.toUpperCase()}</b>
            <span className="lt-min">{minute(d.t)}</span>
          </div>
          <div className="lt-sub">
            Played → {who(d.chosen.receiver)} · {pct(d.chosen.p)} to arrive
            {missed && <> &nbsp;|&nbsp; Better → {who(d.best.receiver)} · {pct(d.best.p)}{d.best.bypassed ? ` · beats ${d.best.bypassed}` : ""}</>}
          </div>
        </div>
        {missed && (
          <div className="lt-stat">
            <span className="lt-big">+{goalPct(d.cost)}</span>
            <span className="lt-cap">GOAL CHANCE</span>
          </div>
        )}
        <div className="lt-actions">
          <button onClick={onReplay} title="Replay the breakdown" aria-label="Replay the breakdown"><RotateCcw size={14} /></button>
          {onDetails && <button onClick={onDetails} title="Full breakdown and AI explanation"><PanelRightOpen size={14} /> Details</button>}
          {onNext && <button className="next" onClick={onNext} title="Next key moment">Next <ChevronRight size={14} /></button>}
        </div>
      </div>
    </div>
  );
}

/**
 * The latest pass stays fully visible for HOLD real seconds (fading only at the
 * end), so it is readable at any playback speed. When a newer pass is played the
 * older one hands off quickly instead of cluttering the pitch.
 */
function holdOverlays(list: Decision[], t: number, speed: number) {
  const hold = HOLD * speed;
  const handoff = HANDOFF * speed;
  return list
    .map((d, k) => {
      const next = list[k + 1];
      let alpha = Math.min(1, (hold - (t - d.t)) / (hold * 0.2));
      if (next) alpha = Math.min(alpha, 1 - (t - next.t) / handoff);
      return { d, alpha, sticky: false };
    })
    .filter((o) => o.alpha > 0.01);
}

type PFn = Proj["P"];
type Pt = [number, number];

function path(ctx: CanvasRenderingContext2D, P: PFn, pts: Pt[], close = false) {
  ctx.beginPath();
  pts.forEach(([x, y], k) => {
    const [sx, sy] = P(x, y);
    if (k === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  if (close) ctx.closePath();
}

function line(ctx: CanvasRenderingContext2D, P: PFn, pts: Pt[], o: { color: string; width: number; alpha: number; dash?: number[] }) {
  ctx.save();
  ctx.globalAlpha = o.alpha;
  ctx.strokeStyle = o.color;
  ctx.lineWidth = o.width;
  ctx.setLineDash(o.dash ?? []);
  path(ctx, P, pts);
  ctx.stroke();
  ctx.restore();
}

const rectPts = (ax: number, ay: number, bx: number, by: number): Pt[] => [[ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay]];
const circlePts = (cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2, n = 48): Pt[] =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

function drawPitch(ctx: CanvasRenderingContext2D, proj: Proj, g: Geom) {
  const { P } = proj;
  const m = MARGIN * 0.6;
  // Grass and mowing stripes.
  ctx.save();
  path(ctx, P, rectPts(-m, -m, L + m, W + m), true);
  const [, top] = P(L / 2, W + m);
  const [, bottom] = P(L / 2, -m);
  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, proj.mode > 0.5 ? "#0f3f24" : "#14532d");
  grad.addColorStop(1, proj.mode > 0.5 ? "#17633a" : "#0f3f24");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.clip();
  const stripes = 14;
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (let i = 0; i < stripes; i += 2) {
    path(ctx, P, rectPts((i * L) / stripes, -m, ((i + 1) * L) / stripes, W + m), true);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5;
  const stroke = (pts: Pt[]) => {
    path(ctx, P, pts);
    ctx.stroke();
  };
  stroke(rectPts(0, 0, L, W));
  stroke([[L / 2, 0], [L / 2, W]]);
  stroke(circlePts(L / 2, W / 2, 9.15));
  for (const side of [0, 1]) {
    const gx = side ? L : 0;
    const dir = side ? -1 : 1;
    stroke(rectPts(gx, W / 2 - 20.16, gx + dir * 16.5, W / 2 + 20.16));
    stroke(rectPts(gx, W / 2 - 9.16, gx + dir * 5.5, W / 2 + 9.16));
    const a = Math.acos(5.5 / 9.15);
    const c = side ? Math.PI : 0;
    stroke(circlePts(gx + dir * 11, W / 2, 9.15, c - a, c + a, 20));
    // Goal (frame on the ground plus posts and crossbar in broadcast view).
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    path(ctx, P, rectPts(gx, W / 2 - 3.66, gx - dir * 2, W / 2 + 3.66), true);
    ctx.fill();
    ctx.stroke();
    if (proj.mode > 0.05) {
      ctx.save();
      ctx.globalAlpha = proj.mode;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      const posts = [P(gx, W / 2 - 3.66), P(gx, W / 2 - 3.66, 2.44), P(gx, W / 2 + 3.66, 2.44), P(gx, W / 2 + 3.66)];
      ctx.beginPath();
      posts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
    }
  }
  // Spots.
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  for (const [x, y] of [[L / 2, W / 2], [11, W / 2], [L - 11, W / 2]] as Pt[]) {
    const [sx, sy] = P(x, y);
    ctx.beginPath();
    ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  void g;
}

/** Glowing disc on the grass under a player (the "spotlight"). */
function spotlight(ctx: CanvasRenderingContext2D, proj: Proj, pos: Pt, color: string, alpha: number) {
  if (alpha <= 0) return;
  const [x, y] = pos;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Soft pool of light.
  path(ctx, proj.P, circlePts(x, y, 2.6, 0, Math.PI * 2, 36), true);
  ctx.fillStyle = color === BETTER ? "rgba(0,255,133,0.22)" : "rgba(255,255,255,0.18)";
  ctx.fill();
  // Bright ring.
  path(ctx, proj.P, circlePts(x, y, 1.9, 0, Math.PI * 2, 36), true);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.restore();
}

/** Area the better receiver reaches before any defender: the gap the pass should have found. */
function drawSpace(ctx: CanvasRenderingContext2D, proj: Proj, pos: Pt[], match: Match, d: Decision, alpha: number) {
  if (alpha <= 0 || d.best.receiver === null) return;
  const recv = pos[d.best.receiver];
  const defenders = match.players.filter((p) => p.team !== d.team && p.role !== "GK").map((p) => pos[p.idx]);
  const [tx, ty] = d.best.target;
  const R = 10;
  const step = 1.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(0,255,133,0.28)";
  for (let x = tx - R; x <= tx + R; x += step) {
    for (let y = ty - R; y <= ty + R; y += step) {
      if (x < 0 || x > L || y < 0 || y > W) continue;
      const fromTarget = Math.hypot(x - tx, y - ty);
      if (fromTarget > R) continue;
      const tR = Math.hypot(x - recv[0], y - recv[1]);
      const tD = Math.min(...defenders.map(([dx, dy]) => Math.hypot(x - dx, y - dy)));
      if (tR + 1.0 < tD) {
        path(ctx, proj.P, rectPts(x - step / 2, y - step / 2, x + step / 2 + 0.05, y + step / 2 + 0.05), true);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** The defending team's back line, joined like a rope. */
function drawBackLine(ctx: CanvasRenderingContext2D, proj: Proj, pos: Pt[], match: Match, attackingTeam: number, period: number, alpha: number) {
  if (alpha <= 0) return;
  // Team 0 attacks +x in the first half, -x in the second (and vice versa for team 1).
  const dir = (attackingTeam === 0) === (period === 1) ? 1 : -1;
  const back = match.players
    .filter((p) => p.team !== attackingTeam && p.role !== "GK")
    .map((p) => pos[p.idx])
    .sort((a, b) => b[0] * dir - a[0] * dir)
    .slice(0, 4)
    .sort((a, b) => a[1] - b[1]);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = LINE;
  ctx.shadowBlur = 10;
  line(ctx, proj.P, back, { color: LINE, width: 3, alpha });
  ctx.fillStyle = LINE;
  for (const [x, y] of back) {
    const [sx, sy] = proj.P(x, y);
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const near = back[0];
  if (near) {
    const [sx, sy] = proj.P(near[0], near[1]);
    pill(ctx, sx, sy + 24, "Back line", LINE, "#1a0020", alpha);
  }
}

function passArrow(
  ctx: CanvasRenderingContext2D,
  proj: Proj,
  from: Pt,
  to: Pt,
  o: { color: string; alpha: number; width: number; dash?: number[]; glow?: boolean; offset?: number; lofted?: boolean; progress?: number },
) {
  const progress = o.progress ?? 1;
  if (progress <= 0) return;
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  // Lofted balls really arc through the air (z), with a dotted shadow on the grass.
  const height = o.lofted ? Math.min(12, len / 4) : 0;
  const n = o.lofted ? 28 : 2;
  const pts: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const f = (k / n) * progress;
    const x = from[0] + (to[0] - from[0]) * f;
    const y = from[1] + (to[1] - from[1]) * f;
    // In the flat top-down view, fake the arc sideways so it still reads as "in the air".
    const z = height * 4 * f * (1 - f);
    pts.push(proj.P(x, y, z + (proj.mode < 1 ? z * 1.4 * (1 - proj.mode) : 0)));
  }
  const [x2, y2] = pts[pts.length - 1];
  const [xp, yp] = pts[pts.length - 2];
  const ang = Math.atan2(y2 - yp, x2 - xp);
  const head = 10 + o.width * 1.5;
  ctx.save();
  ctx.globalAlpha = Math.max(0, o.alpha);
  if (o.lofted) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, o.alpha) * 0.35;
    line(ctx, proj.P, [from, [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress]], {
      color: o.color, width: 1.5, alpha: Math.max(0, o.alpha) * 0.35, dash: [2, 5],
    });
    ctx.restore();
  }
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.width;
  ctx.lineCap = "round";
  if (o.glow) {
    ctx.shadowColor = o.color;
    ctx.shadowBlur = 12;
  }
  ctx.setLineDash(o.dash ?? []);
  ctx.lineDashOffset = o.offset ?? 0;
  ctx.beginPath();
  pts.forEach(([x, y], k) => {
    if (k === pts.length - 1) {
      x -= Math.cos(ang) * head * 0.7;
      y -= Math.sin(ang) * head * 0.7;
    }
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(ang - 0.42) * head, y2 - Math.sin(ang - 0.42) * head);
  ctx.lineTo(x2 - Math.cos(ang + 0.42) * head, y2 - Math.sin(ang + 0.42) * head);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Broadcast-style name tag: shirt number block plus surname. */
function nameTag(ctx: CanvasRenderingContext2D, x: number, y: number, p: Match["players"][number], color: string, alpha: number) {
  if (alpha <= 0) return;
  const surname = p.name.split(" ").slice(1).join(" ").toUpperCase();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 12px ${FONT}`;
  const tw = ctx.measureText(surname).width;
  const nw = 24;
  const w = nw + tw + 14;
  const h = 22;
  const left = x - w / 2;
  ctx.beginPath();
  ctx.roundRect(left, y - h / 2, w, h, 5);
  ctx.fillStyle = "rgba(26,0,32,0.92)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(left, y - h / 2, nw, h, [5, 0, 0, 5]);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = "#1a0020";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(p.number), left + nw / 2, y + 0.5);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.fillText(surname, left + nw + 7, y + 0.5);
  // Pointer down to the player.
  ctx.beginPath();
  ctx.moveTo(x - 5, y + h / 2);
  ctx.lineTo(x + 5, y + h / 2);
  ctx.lineTo(x, y + h / 2 + 6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Small assistant-referee flag marking a player in an offside position. */
function flag(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 14);
  ctx.stroke();
  ctx.fillStyle = OFFSIDE;
  ctx.fillRect(x, y - 14, 9, 7);
  ctx.restore();
}

/** A point `dist` px past the end of the segment, so labels clear the receiver. */
function beyond([x1, y1]: Pt, [x2, y2]: Pt, dist: number): Pt {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  return [x2 + ((x2 - x1) / len) * dist, y2 + ((y2 - y1) / len) * dist];
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.font = `600 12px ${FONT}`;
  const w = ctx.measureText(text).width + 16;
  const h = 22;
  // Keep labels fully on the canvas near the touchlines.
  const cw = ctx.canvas.width / (window.devicePixelRatio || 1);
  const ch = ctx.canvas.height / (window.devicePixelRatio || 1);
  x = Math.min(Math.max(x, w / 2 + 4), cw - w / 2 - 4);
  y = Math.min(Math.max(y, h / 2 + 4), ch - h / 2 - 4);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 11);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}
