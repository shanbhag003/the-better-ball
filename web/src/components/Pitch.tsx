import { useEffect, useRef, useState } from "react";
import { recentDecisions, snapshot } from "../data";
import { pct } from "../labels";
import type { Playback } from "../playback";
import type { Decision, Match } from "../types";

const L = 105;
const W = 68;
const MARGIN = 3.5;
const BETTER = "#00ff85";
const PLAYED = "#ffffff";
const FONT = `"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif`;
const FADE = 1.6; // seconds a pass overlay stays visible during playback

interface Props {
  match: Match;
  pb: Playback;
  selected: Decision | null;
  showBetter: boolean;
}

interface Hover {
  player: number;
  x: number;
  y: number;
}

export function Pitch({ match, pb, selected, showBetter }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ selected, showBetter });
  propsRef.current = { selected, showBetter };
  const geom = useRef({ s: 1, ox: 0, oy: 0, w: 0, h: 0 });
  const posRef = useRef<[number, number][]>([]);
  const [hover, setHover] = useState<Hover | null>(null);

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
    const draw = (now: number) => {
      const canvas = canvasRef.current;
      if (canvas) render(canvas, now);
      raf = requestAnimationFrame(draw);
    };
    const render = (canvas: HTMLCanvasElement, now: number) => {
      const ctx = canvas.getContext("2d")!;
      const { s, ox, oy, w, h } = geom.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const X = (x: number) => ox + x * s;
      const Y = (y: number) => oy + (W - y) * s; // y up on the pitch, down on screen

      drawPitch(ctx, X, Y, s);

      const t = pb.t;
      const snap = snapshot(match, t);
      posRef.current = snap.pos;
      const { selected, showBetter } = propsRef.current;
      const pulse = 0.5 + 0.5 * Math.sin(now / 220);
      const rings = new Map<number, { color: string; alpha: number }>();

      // Decision overlays.
      const showSel = selected && Math.abs(t - selected.t) < 0.25;
      const list: { d: Decision; alpha: number; sticky: boolean }[] = showSel
        ? [{ d: selected!, alpha: 1, sticky: true }]
        : recentDecisions(match, t, FADE).map((d) => ({ d, alpha: 1 - (t - d.t) / FADE, sticky: false }));

      for (const { d, alpha, sticky } of list) {
        const better = showBetter && d.cost >= match.meta.good_threshold && d.best;
        const from = d.start;
        if (better) {
          arrow(ctx, X(from[0]), Y(from[1]), X(d.best.target[0]), Y(d.best.target[1]), {
            color: BETTER, alpha, width: sticky ? 3.5 : 2.5, dash: [8, 6], glow: true, offset: -now / 40,
          });
          const label = d.best.kind === "shot" ? `Shoot · ${pct(d.best.p)}` : `Better · ${pct(d.best.p)}`;
          const [lx, ly] = beyond(X(from[0]), Y(from[1]), X(d.best.target[0]), Y(d.best.target[1]), 30);
          pill(ctx, lx, ly, label, BETTER, "#2a0030", alpha);
          if (d.best.receiver !== null) rings.set(d.best.receiver, { color: BETTER, alpha: alpha * (0.6 + 0.4 * pulse) });
        }
        arrow(ctx, X(from[0]), Y(from[1]), X(d.chosen.target[0]), Y(d.chosen.target[1]), {
          color: PLAYED, alpha: alpha * (sticky ? 0.95 : 0.65), width: sticky ? 3 : 2,
        });
        if (sticky || better) {
          const lbl = d.chosen.kind === "shot" ? `Shot · ${pct(d.chosen.p)}` : `Played · ${pct(d.chosen.p)}`;
          const [lx, ly] = beyond(X(from[0]), Y(from[1]), X(d.chosen.target[0]), Y(d.chosen.target[1]), 30);
          pill(ctx, lx, ly, lbl, "#ffffff", "#1a0020", alpha);
        }
        rings.set(d.player, { color: "#ffffff", alpha: alpha * 0.9 });
      }

      // Players. When a moment is open, fade everyone not involved.
      const r = Math.max(9, 1.05 * s);
      const focus = showSel ? new Set([selected!.player, selected!.chosen.receiver, selected!.best.receiver]) : null;
      // Defenders each option takes out of the game: white = played, green = better.
      const beaten = new Map<number, string>();
      if (showSel) {
        for (const i of selected!.chosen.beaten ?? []) beaten.set(i, PLAYED);
        if (showBetter && selected!.cost >= match.meta.good_threshold)
          for (const i of selected!.best.beaten ?? []) beaten.set(i, BETTER);
        beaten.forEach((_, i) => focus!.add(i));
      }
      match.players.forEach((p, i) => {
        const [x, y] = snap.pos[i];
        const cx = X(x);
        const cy = Y(y);
        ctx.globalAlpha = focus && !focus.has(i) ? 0.45 : 1;
        const bc = beaten.get(i);
        if (bc) {
          ctx.save();
          ctx.strokeStyle = bc;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.lineDashOffset = now / 60;
          ctx.shadowColor = bc;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        const ring = rings.get(i);
        if (ring) {
          ctx.globalAlpha = ring.alpha;
          ctx.strokeStyle = ring.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = match.teams[p.team].color;
        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.lineWidth = p.role === "GK" ? 2.5 : 1.5;
        ctx.strokeStyle = p.role === "GK" ? "#fff6" : "#0006";
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = `700 ${Math.round(r * 0.95)}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(p.number), cx, cy + 0.5);
        ctx.globalAlpha = 1;
      });

      // Ball with height.
      const [bx, by, bz] = snap.ball;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(X(bx), Y(by), 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      const lift = bz * s * 0.35;
      ctx.beginPath();
      ctx.arc(X(bx), Y(by) - lift, 4.5 + bz * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(255,255,255,0.8)";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowColor = "transparent";
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [match, pb]);

  const onMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { s, ox, oy } = geom.current;
    let best = -1;
    let bd = Math.max(12, s * 1.6);
    posRef.current.forEach(([x, y], i) => {
      const d = Math.hypot(ox + x * s - mx, oy + (W - y) * s - my);
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
    </div>
  );
}

type XY = (v: number) => number;

function drawPitch(ctx: CanvasRenderingContext2D, X: XY, Y: XY, s: number) {
  // Grass with mowing stripes.
  const x0 = X(0), y0 = Y(W), pw = L * s, ph = W * s;
  ctx.save();
  roundRect(ctx, x0 - MARGIN * s * 0.6, y0 - MARGIN * s * 0.6, pw + MARGIN * s * 1.2, ph + MARGIN * s * 1.2, 14);
  const g = ctx.createLinearGradient(0, y0, 0, y0 + ph);
  g.addColorStop(0, "#14532d");
  g.addColorStop(1, "#0f3f24");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  const stripes = 14;
  for (let i = 0; i < stripes; i += 2) {
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    ctx.fillRect(x0 + (i * pw) / stripes, y0 - 100, pw / stripes, ph + 200);
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5;
  const rect = (ax: number, ay: number, bx: number, by: number) =>
    ctx.strokeRect(X(ax), Y(by), (bx - ax) * s, (by - ay) * s);
  rect(0, 0, L, W);
  ctx.beginPath();
  ctx.moveTo(X(L / 2), Y(0));
  ctx.lineTo(X(L / 2), Y(W));
  ctx.stroke();
  circle(ctx, X(L / 2), Y(W / 2), 9.15 * s, false);
  circle(ctx, X(L / 2), Y(W / 2), 2.5, true);
  for (const side of [0, 1]) {
    const gx = side ? L : 0;
    const dir = side ? -1 : 1;
    rect(Math.min(gx, gx + dir * 16.5), W / 2 - 20.16, Math.max(gx, gx + dir * 16.5), W / 2 + 20.16);
    rect(Math.min(gx, gx + dir * 5.5), W / 2 - 9.16, Math.max(gx, gx + dir * 5.5), W / 2 + 9.16);
    circle(ctx, X(gx + dir * 11), Y(W / 2), 2.5, true);
    // Penalty arc.
    ctx.beginPath();
    const a = Math.acos(5.5 / 9.15);
    const c = side ? Math.PI : 0;
    ctx.arc(X(gx + dir * 11), Y(W / 2), 9.15 * s, c - a, c + a);
    ctx.stroke();
    // Goal.
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    const gx0 = side ? X(L) : X(-2);
    ctx.fillRect(gx0, Y(W / 2 + 3.66), 2 * s, 7.32 * s);
    ctx.strokeRect(gx0, Y(W / 2 + 3.66), 2 * s, 7.32 * s);
  }
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: boolean) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fill();
  } else ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function arrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  o: { color: string; alpha: number; width: number; dash?: number[]; glow?: boolean; offset?: number },
) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = 10 + o.width * 1.5;
  const ex = x2 - Math.cos(ang) * head * 0.7;
  const ey = y2 - Math.sin(ang) * head * 0.7;
  ctx.save();
  ctx.globalAlpha = Math.max(0, o.alpha);
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
  ctx.moveTo(x1, y1);
  ctx.lineTo(ex, ey);
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

/** A point `dist` px past the end of the segment, so labels clear the receiver. */
function beyond(x1: number, y1: number, x2: number, y2: number, dist: number): [number, number] {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  return [x2 + ((x2 - x1) / len) * dist, y2 + ((y2 - y1) / len) * dist];
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.font = `600 12px ${FONT}`;
  const w = ctx.measureText(text).width + 16;
  const h = 22;
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
