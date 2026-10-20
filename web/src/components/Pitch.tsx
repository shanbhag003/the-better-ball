import { ChevronRight, Maximize2, Mic, Minus, PanelRightOpen, Pause, Play, Plus, RotateCcw, Tv } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { follow, L, projector, W, type Cam, type Geom, type Proj } from "../camera";
import { recentDecisions, snapshot } from "../data";
import type { PunditScript, Voice } from "../api";
import { goalPct, minute, pct, VERDICT } from "../labels";
import { getPundit, lineTimes } from "../pundit";
import { drawStadium } from "../stadium";
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

type Span = readonly [number, number];
interface Timeline {
  spots: Span;
  played: Span;
  rewind: Span;
  space: Span;
  line: Span;
  better: Span;
  beaten: Span;
  done: number;
}

/** Telestration timeline for a key moment in broadcast mode (seconds after it opens). */
const DEFAULT_T: Timeline = {
  spots: [0.7, 0.4],
  played: [1.1, 0.9],
  rewind: [2.2, 0.4],
  space: [2.5, 0.5],
  line: [2.7, 0.5],
  better: [3.0, 1.0],
  beaten: [3.8, 0.4],
  done: 4.3,
};

/** Timeline that follows the pundit: line 1 = the pass played, line 2 = rewind + space, line 3 = better pass. */
function timelineFor(starts: number[], total: number): Timeline {
  const b1 = starts[1] ?? total * 0.35;
  const b2 = starts[2] ?? total * 0.66;
  return {
    spots: [0.1, 0.4],
    played: [0.5, Math.max(0.8, Math.min(1.6, (b1 - 0.5) * 0.8))],
    rewind: [b1, 0.4],
    space: [b1 + 0.2, 0.5],
    line: [b1 + 0.4, 0.5],
    better: [b2, Math.max(0.8, Math.min(1.4, (total - b2) * 0.5))],
    beaten: [b2 + 0.8, 0.4],
    done: total + 0.4,
  };
}

const PUNDIT_TIMEOUT = 20000; // after this the plain breakdown runs; a late script still takes over
const phase = (ph: number, [start, len]: Span) => Math.max(0, Math.min(1, (ph - start) / len));

interface Tele {
  id: number | null;
  start: number;
  done: boolean;
  state: "waiting" | "running";
  T: Timeline;
  script: PunditScript | null;
  starts: number[];
  audio: HTMLAudioElement | null;
  line: number;
  pausedAt: number | null; // performance.now() when the viewer paused the pundit
}
const IDLE: Tele = { id: null, start: 0, done: false, state: "running", T: DEFAULT_T, script: null, starts: [], audio: null, line: -1, pausedAt: null };

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
  /** AI Pundit: script + voice for breakdowns (null when the AI service is unavailable). */
  pundit?: { voice: Voice; language: string; sound: boolean } | null;
}

interface Hover {
  player: number;
  x: number;
  y: number;
}

export function Pitch({ match, pb, selected, showBetter, broadcast, onBreakdown, onDetails, onNext, pundit }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Height of the caption / lower-third: on phones they sit under the pitch and need room.
  const [overlayH, setOverlayH] = useState(0);
  const overlayObs = useRef<ResizeObserver | null>(null);
  const overlayEl = useRef<HTMLDivElement | null>(null);
  const overlayRef = useCallback((el: HTMLDivElement | null) => {
    overlayObs.current?.disconnect();
    overlayEl.current = el;
    if (!el) return setOverlayH(0);
    setOverlayH(el.offsetHeight);
    overlayObs.current = new ResizeObserver(() => setOverlayH(el.offsetHeight));
    overlayObs.current.observe(el);
  }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ selected, showBetter, broadcast, onBreakdown, pundit });
  propsRef.current = { selected, showBetter, broadcast, onBreakdown, pundit };
  const geom = useRef<Geom>({ s: 1, ox: 0, oy: 0, w: 0, h: 0 });
  const cam = useRef<Cam>({ mode: 0, fx: L / 2, fy: W / 2, zoom: 1 });
  const projRef = useRef<Proj | null>(null);
  // The viewer's own zoom and pan, applied on top of the automatic camera.
  const view = useRef({ k: 1, px: 0, py: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const posRef = useRef<[number, number][]>([]);
  const tele = useRef<Tele>({ ...IDLE });
  const [caption, setCaption] = useState<{ waiting: boolean; text: string } | null>(null);
  const [headline, setHeadline] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [lowerThird, setLowerThird] = useState<Decision | null>(null);
  // Re-measure when the caption text or the lower-third changes.
  useLayoutEffect(() => {
    if (overlayEl.current) setOverlayH(overlayEl.current.offsetHeight);
  }, [caption, headline, lowerThird]);

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
      if (breakdown && tele.current.id !== breakdown.id) startBreakdown(breakdown, now);
      if (!breakdown && tele.current.id !== null) stopBreakdown();
      const tl = tele.current;
      const T = tl.T;
      const waiting = !!breakdown && tl.state === "waiting";
      // While the pundit's script loads, only the set-up (camera, dim, spotlights) plays.
      const clock = tl.pausedAt ?? now; // a paused pundit freezes the telestration too
      const ph = breakdown ? (waiting ? Math.min((clock - tl.start) / 1000, T.played[0] - 0.05) : (clock - tl.start) / 1000) : 99;
      if (breakdown && !waiting) {
        const idx = tl.starts.length ? tl.starts.filter((s0) => ph >= s0).length - 1 : -1;
        if (idx !== tl.line && tl.script) {
          tl.line = idx;
          if (idx >= 0) setCaption({ waiting: false, text: tl.script.lines[idx] });
        }
        if (!tl.done && ph >= T.done) {
          tl.done = true;
          setCaption(null);
          setLowerThird(breakdown);
          onBreakdown?.(true);
        }
      }
      const show = tl.script?.show ?? { space: true, back_line: true, beaten: true, offside: true };

      const better = (d: Decision) => showBetter && d.cost >= match.meta.good_threshold && !!d.best;
      const list: { d: Decision; alpha: number; sticky: boolean }[] = sticky
        ? [{ d: sticky, alpha: 1, sticky: true }]
        : holdOverlays(recentDecisions(match, t, HOLD * pb.speed), t, pb.speed);

      // ---- camera: frame everything that is on screen (passes, lofted arcs, the ball)
      const target: Cam = { mode: 0, fx: L / 2, fy: W / 2, zoom: 1 };
      if (broadcast) {
        target.mode = 1;
        const pts: Pt3[] = [[snap.ball[0], snap.ball[1], 0]];
        for (const { d } of list) {
          pts.push(...passPoints(d.start, d.chosen.target, d.chosen.lofted));
          if (better(d)) pts.push(...passPoints(d.start, d.best.target, d.best.lofted));
        }
        if (breakdown) pts.splice(0, 1); // the story, not the ball, sets the frame
        const xs = pts.map((q) => q[0]);
        const ys = pts.map((q) => q[1]);
        target.fx = (Math.min(...xs) + Math.max(...xs)) / 2;
        target.fy = (Math.min(...ys) + Math.max(...ys)) / 2 - (breakdown ? 1 : 3);
        // Leave room for name tags above and the lower-third below during a breakdown.
        const pad = breakdown ? { t: 0.15, b: 0.26, l: 0.06, r: 0.06 } : { t: 0.08, b: 0.08, l: 0.05, r: 0.05 };
        target.zoom = fitZoom(g, target, pts, pad, 0.4, breakdown ? 1.05 : 0.82);
      }
      follow(cam.current, target, dt, breakdown ? 0.3 : 0.6);
      const proj = withView(projector(g, cam.current), g, view.current);
      projRef.current = proj;
      const { P } = proj;

      drawStadium(ctx, proj, g, [match.teams[0].color, match.teams[1].color], now, breakdown ? 0.45 : 0);
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

      // ---- breakdown layers under the players: space, back line, offside line, spotlights
      if (breakdown) {
        const d = breakdown;
        if (show.space && better(d) && d.best.receiver !== null) {
          drawSpace(ctx, proj, snap.pos, match, d, phase(ph, T.space));
        }
        if (show.back_line) drawBackLine(ctx, proj, snap.pos, match, d.team, snap.period, phase(ph, T.line));
        const spotA = phase(ph, T.spots);
        spotlight(ctx, proj, snap.pos[d.player], PLAYED, spotA);
        if (d.chosen.receiver !== null) spotlight(ctx, proj, snap.pos[d.chosen.receiver], PLAYED, spotA);
        if (better(d) && d.best.receiver !== null) spotlight(ctx, proj, snap.pos[d.best.receiver], BETTER, spotA);
      }
      if (sticky && sticky.offside_line != null && (!breakdown || show.offside || !tl.script)) {
        const x = sticky.offside_line;
        line(ctx, P, [[x, 0], [x, W]], { color: OFFSIDE, width: 2, alpha: 0.85, dash: [7, 6] });
        const [lx, ly] = P(x, W);
        pill(ctx, lx, ly + 14, "Offside line", OFFSIDE, "#2a0030", 0.95);
      }

      // ---- pass overlays
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
        const beatenA = breakdown ? (show.beaten ? phase(ph, T.beaten) : 0) : 1;
        if (beatenA > 0) {
          for (const i of sticky.chosen.beaten ?? []) beaten.set(i, PLAYED);
          if (better(sticky)) for (const i of sticky.best.beaten ?? []) beaten.set(i, BETTER);
        }
        beaten.forEach((_, i) => focus!.add(i));
      }
      // ---- pulsing cyan ring on the grass under the player on the ball
      {
        const [bx, by, bz] = snap.ball;
        let best = -1;
        let bestD = 1.8;
        snap.pos.forEach(([x, y], i) => {
          const dd = Math.hypot(x - bx, y - by);
          if (dd < bestD) [best, bestD] = [i, dd];
        });
        if (best >= 0 && bz < 1.2) {
          const [x, y] = snap.pos[best];
          const k = (now / 900) % 1;
          ctx.save();
          ctx.strokeStyle = LINE;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.9 * (1 - k);
          path(ctx, P, circlePts(x, y, 1.1 + k * 1.6, 0, Math.PI * 2, 32), true);
          ctx.stroke();
          ctx.globalAlpha = 0.85;
          path(ctx, P, circlePts(x, y, 1.1, 0, Math.PI * 2, 32), true);
          ctx.stroke();
          ctx.restore();
        }
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
        // Glossy kit-colour token with a white rim (goalkeepers get a cyan rim).
        const kit = match.teams[p.team].color;
        const gloss = ctx.createLinearGradient(cx, py - r, cx, py + r);
        gloss.addColorStop(0, shade(kit, 255, 0.3));
        gloss.addColorStop(0.5, kit);
        gloss.addColorStop(1, shade(kit, 0, 0.25));
        ctx.beginPath();
        ctx.arc(cx, py, r, 0, Math.PI * 2);
        ctx.fillStyle = gloss;
        ctx.shadowColor = "rgba(10,0,14,0.55)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowOffsetY = 0;
        ctx.lineWidth = p.role === "GK" ? 2.5 : 1.6;
        ctx.strokeStyle = p.role === "GK" ? LINE : "rgba(255,255,255,0.9)";
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

  /** Open a breakdown: show the set-up at once, then run the pundit's script (or the default timing). */
  function startBreakdown(d: Decision, now: number) {
    tele.current.audio?.pause();
    tele.current = { ...IDLE, id: d.id, start: now, state: "waiting" };
    setPaused(false);
    setLowerThird(null);
    setHeadline(null);
    propsRef.current.onBreakdown?.(false);
    const cfg = propsRef.current.pundit;
    const begin = (script: PunditScript | null) => {
      if (tele.current.id !== d.id) return;
      // A script that arrives after the plain breakdown started takes over and replays it with the pundit.
      if (tele.current.state !== "waiting") {
        if (!script || tele.current.script) return;
        tele.current.state = "waiting";
        tele.current.done = false;
        setLowerThird(null);
        propsRef.current.onBreakdown?.(false);
      }
      const run = (total: number, audio: HTMLAudioElement | null) => {
        if (tele.current.id !== d.id || tele.current.state !== "waiting") return;
        const starts = script ? lineTimes(script.lines, total) : [];
        Object.assign(tele.current, {
          state: "running", start: performance.now(), script, starts, audio, line: -1, pausedAt: null,
          T: script ? timelineFor(starts, total) : DEFAULT_T,
        });
        setPaused(false);
        setHeadline(script?.headline ?? null);
        audio?.play().catch(() => {}); // autoplay blocked: captions still run
      };
      if (!script) return run(DEFAULT_T.done, null);
      const words = script.lines.join(" ").length / 15 + 1.2; // reading time without audio
      if (script.audio && cfg?.sound) {
        const audio = new Audio(script.audio);
        let started = false;
        const go = (secs: number) => {
          if (started) return;
          started = true;
          run(Math.max(4, secs), audio);
        };
        audio.addEventListener("loadedmetadata", () => go(Number.isFinite(audio.duration) ? audio.duration : words));
        window.setTimeout(() => go(words), 1500);
      } else run(Math.max(4.3, words), null);
    };
    if (!cfg) {
      begin(null);
      return;
    }
    setCaption({ waiting: true, text: "AI Pundit is studying the play…" });
    const timer = window.setTimeout(() => begin(null), PUNDIT_TIMEOUT);
    getPundit(d.id, cfg.voice, cfg.language)
      .then((script) => {
        window.clearTimeout(timer);
        begin(script);
      })
      .catch(() => {
        window.clearTimeout(timer);
        begin(null);
      });
  }

  function stopBreakdown() {
    tele.current.audio?.pause();
    tele.current = { ...IDLE };
    setPaused(false);
    setLowerThird(null);
    setCaption(null);
    setHeadline(null);
  }

  // Muting mid-breakdown stops the voice; leaving the component stops it too.
  useEffect(() => {
    if (!pundit?.sound) tele.current.audio?.pause();
  }, [pundit?.sound]);
  useEffect(() => () => tele.current.audio?.pause(), []);

  // Pause / resume the pundit: the voice and the telestration clock stop together.
  const [paused, setPaused] = useState(false);
  const togglePause = () => {
    const tl = tele.current;
    if (tl.id === null) return;
    if (tl.pausedAt !== null) {
      tl.start += performance.now() - tl.pausedAt;
      tl.pausedAt = null;
      tl.audio?.play().catch(() => {});
      setPaused(false);
    } else {
      tl.pausedAt = performance.now();
      tl.audio?.pause();
      setPaused(true);
    }
  };

  const replay = () => {
    const tl = tele.current;
    if (!tl.script && tl.id === null) return;
    tl.audio?.pause();
    if (tl.audio) tl.audio.currentTime = 0;
    Object.assign(tl, { start: performance.now(), done: false, line: -1, state: "running", pausedAt: null });
    setPaused(false);
    setLowerThird(null);
    propsRef.current.onBreakdown?.(false);
    tl.audio?.play().catch(() => {});
  };

  const setView = (k: number, px: number, py: number) => {
    const { w, h } = geom.current;
    k = Math.max(0.6, Math.min(4, k));
    // Keep some of the pitch on screen whatever the pan.
    const lx = (w * Math.max(k, 1)) / 2;
    const ly = (h * Math.max(k, 1)) / 2;
    view.current = { k, px: Math.max(-lx, Math.min(lx, px)), py: Math.max(-ly, Math.min(ly, py)) };
    setZoomed(Math.abs(k - 1) > 0.01 || Math.abs(px) > 1 || Math.abs(py) > 1);
  };

  /** Zoom by `f` keeping the screen point (mx, my) fixed. */
  const zoomAt = (f: number, mx?: number, my?: number) => {
    const { w, h } = geom.current;
    const { k, px, py } = view.current;
    const cx = w / 2;
    const cy = h / 2;
    mx ??= cx;
    my ??= cy;
    const k2 = Math.max(0.6, Math.min(4, k * f));
    const sx = cx + (mx - cx - px) / k;
    const sy = cy + (my - cy - py) / k;
    setView(k2, mx - cx - (sx - cx) * k2, my - cy - (sy - cy) * k2);
  };
  const resetView = () => setView(1, 0, 0);

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAt(Math.pow(1.0018, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onUp = () => {
    drag.current = null;
  };

  const onMove = (e: React.PointerEvent) => {
    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
      const v = view.current;
      setView(v.k, v.px + dx, v.py + dy);
      setHover(null);
      return;
    }
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
    <div
      className={`pitch-wrap ${overlayH ? "has-overlay" : ""}`}
      ref={wrapRef}
      style={{ "--overlay-h": `${overlayH}px` } as React.CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className={drag.current ? "dragging" : ""}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={resetView}
      />
      <div className="pitch-zoom" role="group" aria-label="Pitch zoom">
        <button onClick={() => zoomAt(1.25)} title="Zoom in" aria-label="Zoom in"><Plus size={15} /></button>
        <button onClick={() => zoomAt(1 / 1.25)} title="Zoom out" aria-label="Zoom out"><Minus size={15} /></button>
        <button onClick={resetView} className={zoomed ? "on" : ""} title="Fit (double-click the pitch)" aria-label="Fit to view"><Maximize2 size={14} /></button>
        <span className="pz-hint">Scroll to zoom · drag to move</span>
      </div>
      {hp && hover && (
        <div className="tip" style={{ left: hover.x, top: hover.y - 14 }}>
          <span className="dot" style={{ background: match.teams[hp.team].color }} />
          <b>#{hp.number}</b> {hp.name}
          <span className="muted"> · {hp.position}</span>
        </div>
      )}
      {broadcast && caption && !lowerThird && (
        <div ref={overlayRef} className={`pundit-caption ${caption.waiting ? "waiting" : ""}`} aria-live="polite">
          <span className="pc-badge"><Mic size={12} /> AI PUNDIT</span>
          <span className="pc-text">{caption.text}</span>
          {!caption.waiting && (
            <button className="pc-pause" onClick={togglePause} aria-label={paused ? "Resume the pundit" : "Pause the pundit"}
              title={paused ? "Resume" : "Pause"}>
              {paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
            </button>
          )}
        </div>
      )}
      {broadcast && lowerThird && (
        <LowerThird boxRef={overlayRef} match={match} d={lowerThird} headline={headline} onReplay={replay} onDetails={onDetails} onNext={onNext ?? null} />
      )}
    </div>
  );
}

/** Broadcast lower-third graphic summarising the breakdown. */
function LowerThird({ boxRef, match, d, headline, onReplay, onDetails, onNext }: {
  boxRef: (el: HTMLDivElement | null) => void;
  match: Match;
  d: Decision;
  headline: string | null;
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
    <div ref={boxRef} className="lower-third" role="status">
      <div className="lt-brand"><Tv size={13} /> BETTER BALL ANALYSIS{headline ? " · AI PUNDIT" : ""}</div>
      <div className="lt-main">
        <span className="lt-bar" style={{ background: team.color }} />
        <span className="lt-num" style={{ background: team.color }}>{p.number}</span>
        <div className="lt-text">
          <div className="lt-title">
            <span className={`lt-verdict ${v.tone}`}>{v.label}</span>
            <b>{headline ? headline.toUpperCase() : p.name.toUpperCase()}</b>
            <span className="lt-min">{minute(d.t)}</span>
          </div>
          <div className="lt-sub">
            {headline && <span className="lt-who">{p.name}</span>}
            <span>Played → {who(d.chosen.receiver)} · {pct(d.chosen.p)} to arrive</span>
            {missed && (
              <span className="lt-better">
                Better → {who(d.best.receiver)} · {pct(d.best.p)}{d.best.bypassed ? ` · beats ${d.best.bypassed}` : ""}
              </span>
            )}
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
type Pt3 = [number, number, number];

/** Points a pass occupies on screen: both ends and, for lofted balls, the top of the arc. */
function passPoints(from: Pt, to: Pt, lofted?: boolean): Pt3[] {
  const pts: Pt3[] = [[from[0], from[1], 0], [to[0], to[1], 0]];
  if (lofted) {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    pts.push([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, Math.min(12, len / 4)]);
  }
  return pts;
}

/** Largest broadcast zoom (up to zMax) at which every point stays inside the padded frame. */
function fitZoom(g: Geom, cam: Cam, pts: Pt3[], pad: { t: number; b: number; l: number; r: number }, zMin: number, zMax: number) {
  const inside = (zoom: number) => {
    const pr = projector(g, { ...cam, zoom, mode: 1 });
    return pts.every(([x, y, z]) => {
      const [sx, sy] = pr.P(x, y, z);
      return sx >= g.w * pad.l && sx <= g.w * (1 - pad.r) && sy >= g.h * pad.t && sy <= g.h * (1 - pad.b);
    });
  };
  if (inside(zMax)) return zMax;
  if (!inside(zMin)) return zMin;
  let lo = zMin;
  let hi = zMax;
  for (let k = 0; k < 10; k++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Apply the viewer's zoom and pan (screen space) on top of the camera projection. */
function withView(proj: Proj, g: Geom, v: { k: number; px: number; py: number }): Proj {
  if (v.k === 1 && v.px === 0 && v.py === 0) return proj;
  const cx = g.w / 2;
  const cy = g.h / 2;
  return {
    mode: proj.mode,
    P: (x, y, z) => {
      const [sx, sy] = proj.P(x, y, z);
      return [cx + (sx - cx) * v.k + v.px, cy + (sy - cy) * v.k + v.py];
    },
    scale: (x, y) => proj.scale(x, y) * v.k,
  };
}

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

/** Blend a #rrggbb colour towards white (to = 255) or black (to = 0) by t. */
function shade(hex: string, to: number, t: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * t));
  return `rgb(${c.join(",")})`;
}

const rectPts =(ax: number, ay: number, bx: number, by: number): Pt[] => [[ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay]];
const circlePts = (cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2, n = 48): Pt[] =>
  Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

function drawPitch(ctx: CanvasRenderingContext2D, proj: Proj, g: Geom) {
  const { P } = proj;
  const m = MARGIN * 0.6;
  // Matchday purple surface with mowing stripes.
  ctx.save();
  path(ctx, P, rectPts(-m, -m, L + m, W + m), true);
  const [, top] = P(L / 2, W + m);
  const [, bottom] = P(L / 2, -m);
  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, proj.mode > 0.5 ? "#2c0032" : "#3a0742");
  grad.addColorStop(1, proj.mode > 0.5 ? "#44094d" : "#2c0032");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.clip();
  const stripes = 14;
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  for (let i = 0; i < stripes; i += 2) {
    path(ctx, P, rectPts((i * L) / stripes, -m, ((i + 1) * L) / stripes, W + m), true);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(4,245,255,0.45)";
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
    ctx.fillStyle = "rgba(4,245,255,0.1)";
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
  ctx.fillStyle = "rgba(4,245,255,0.6)";
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
