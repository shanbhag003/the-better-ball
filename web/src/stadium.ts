/**
 * Night-stadium backdrop for the broadcast view: tiered stands with a fine crowd texture
 * (home end in one kit colour, away end in the other), floodlights along the roof, a soft
 * haze and the odd phone flash. Built once in pitch metres and projected every frame, so it
 * follows the camera, zoom and pan.
 */
import { L, W, type Geom, type Proj } from "./camera";

type Pt3 = [number, number, number];
interface Stand {
  a: Pt3; // front-left (pitch level)
  b: Pt3; // front-right
  c: Pt3; // back-right (top tier)
  d: Pt3; // back-left
  team: number;
}

const ROWS = 44;
const GAP = [0.46, 0.54]; // concourse between lower and upper tier
const SEAT = 0.5; // metres between crowd specks along a row
const ALPHAS = [0.12, 0.2, 0.3, 0.42];

// Far side is y > W (the camera sits behind the near touchline, y < 0).
const STANDS: Stand[] = [
  { a: [-5, W + 5, 0], b: [L / 2, W + 5, 0], c: [L / 2, W + 30, 15], d: [-5, W + 30, 15], team: 0 },
  { a: [L / 2, W + 5, 0], b: [L + 5, W + 5, 0], c: [L + 5, W + 30, 15], d: [L / 2, W + 30, 15], team: 1 },
  { a: [-5, 12, 0], b: [-5, W + 5, 0], c: [-24, W + 5, 12], d: [-24, 12, 12], team: 0 },
  { a: [L + 5, 12, 0], b: [L + 5, W + 5, 0], c: [L + 24, W + 5, 12], d: [L + 24, 12, 12], team: 1 },
  // Corners joining the ends to the far stand.
  { a: [-5, W + 5, 0], b: [-5, W + 5, 0], c: [-5, W + 30, 15], d: [-24, W + 5, 12], team: 0 },
  { a: [L + 5, W + 5, 0], b: [L + 5, W + 5, 0], c: [L + 24, W + 5, 12], d: [L + 5, W + 30, 15], team: 1 },
];

const lerp = (p: Pt3, q: Pt3, v: number): Pt3 => [p[0] + (q[0] - p[0]) * v, p[1] + (q[1] - p[1]) * v, p[2] + (q[2] - p[2]) * v];

interface Crowd {
  buckets: { color: string; pts: Float32Array }[];
  all: Float32Array; // every speck, for phone flashes
  lights: Pt3[];
}

let cache: { key: string; crowd: Crowd } | null = null;

function rgb(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `${n >> 16},${(n >> 8) & 255},${n & 255}`;
}

function build(colors: [string, string]): Crowd {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const palette = [rgb(colors[0]), rgb(colors[1]), "235,235,245", "95,35,105"];
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  for (const s of STANDS) {
    for (let k = 0; k < ROWS; k++) {
      const v = k / ROWS;
      if (v > GAP[0] && v < GAP[1]) continue;
      const p0 = lerp(s.a, s.d, v);
      const p1 = lerp(s.b, s.c, v);
      const q0 = lerp(s.a, s.d, v + 1 / ROWS);
      const q1 = lerp(s.b, s.c, v + 1 / ROWS);
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const n = Math.max(1, Math.floor(len / SEAT));
      const light = 1 - v * 0.6; // the lower tier catches more floodlight
      for (let i = 0; i < n; i++) {
        // Scatter within the row band so the crowd reads as texture, not neat lines.
        const u = (i + rnd()) / n;
        const p = lerp(lerp(p0, p1, u), lerp(q0, q1, u), rnd());
        const r = rnd();
        const ci = r < 0.42 ? s.team : r < 0.55 ? 2 : 3;
        const a = (0.3 + rnd() * 0.7) * light;
        const ai = Math.min(ALPHAS.length - 1, Math.floor(a * ALPHAS.length));
        const key = `${ci}|${ai}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p[0], p[1], p[2]);
        all.push(p[0], p[1], p[2]);
      }
    }
  }
  const buckets = [...groups].map(([key, pts]) => {
    const [ci, ai] = key.split("|").map(Number);
    return { color: `rgba(${palette[ci]},${ALPHAS[ai] * 1.15})`, pts: new Float32Array(pts) };
  });
  const lights: Pt3[] = [];
  for (let x = -20; x <= L + 20; x += 7) lights.push([x, W + 32, 16.5]);
  for (let y = 14; y <= W + 4; y += 8) lights.push([-26, y, 13.5], [L + 26, y, 13.5]);
  return { buckets, all: new Float32Array(all), lights };
}

const flashes: { x: number; y: number; z: number; t: number }[] = [];

export function drawStadium(ctx: CanvasRenderingContext2D, proj: Proj, g: Geom, colors: [string, string], now: number, dim = 0) {
  const m = proj.mode;
  if (m < 0.02) return;
  const key = colors.join();
  if (!cache || cache.key !== key) cache = { key, crowd: build(colors) };
  const { buckets, all, lights } = cache.crowd;
  const { P } = proj;

  ctx.save();
  ctx.globalAlpha = m;

  // Night sky.
  const sky = ctx.createLinearGradient(0, 0, 0, g.h);
  sky.addColorStop(0, "#07000b");
  sky.addColorStop(0.45, "#160019");
  sky.addColorStop(1, "#1a001f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, g.w, g.h);

  const quad = (pts: Pt3[], fill: string) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = P(p[0], p[1], p[2]);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Stand bowls, roof and the dark apron round the pitch.
  for (const s of STANDS) quad([s.a, s.b, s.c, s.d], "#14001a");
  quad([[-26, W + 30, 15], [L + 26, W + 30, 15], [L + 26, W + 36, 18], [-26, W + 36, 18]], "#0b0010");
  quad([[-5, -5, 0], [L + 5, -5, 0], [L + 5, W + 5, 0], [-5, W + 5, 0]], "#1f0026");

  // Crowd specks, one fill per colour bucket. Speck size follows the zoom.
  const size = Math.max(1, Math.min(3, proj.scale(L / 2, W + 15) * 0.3));
  for (const { color, pts } of buckets) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 3) {
      const [x, y] = P(pts[i], pts[i + 1], pts[i + 2]);
      ctx.rect(x, y, size, size);
    }
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Concourse trim between the tiers.
  ctx.strokeStyle = "rgba(4,245,255,0.18)";
  ctx.lineWidth = 1;
  for (const s of STANDS.slice(0, 4)) {
    const [x0, y0] = P(...lerp(s.a, s.d, GAP[0]));
    const [x1, y1] = P(...lerp(s.b, s.c, GAP[0]));
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Floodlights along the roof, then a soft haze falling from them.
  for (const l of lights) {
    const [x, y] = P(...l);
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 26);
    halo.addColorStop(0, "rgba(255,252,235,0.35)");
    halo.addColorStop(1, "rgba(255,252,235,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(x - 26, y - 26, 52, 52);
    ctx.fillStyle = "#fffdf0";
    ctx.fillRect(x - 2, y - 1, 4, 2);
  }
  const [, roofY] = P(L / 2, W + 32, 16.5);
  const haze = ctx.createLinearGradient(0, roofY, 0, g.h * 0.75);
  haze.addColorStop(0, "rgba(220,235,255,0.10)");
  haze.addColorStop(1, "rgba(220,235,255,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, g.w, g.h);

  // Phone flashes.
  if (Math.random() < 0.5) {
    const i = Math.floor(Math.random() * (all.length / 3)) * 3;
    flashes.push({ x: all[i], y: all[i + 1], z: all[i + 2], t: now });
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const a = 1 - (now - f.t) / 350;
    if (a <= 0) {
      flashes.splice(i, 1);
      continue;
    }
    const [x, y] = P(f.x, f.y, f.z);
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Pull the crowd back so a breakdown on the pitch holds the eye.
  if (dim > 0) {
    ctx.fillStyle = `rgba(10,0,14,${dim})`;
    ctx.fillRect(0, 0, g.w, g.h);
  }
  ctx.restore();
}
