/**
 * One camera for the pitch: blends between the classic top-down view and a
 * broadcast camera on the near touchline (perspective, looking across the pitch),
 * like the TV gantry. Everything on the pitch is drawn through `P(x, y, z)`.
 */

export const L = 105;
export const W = 68;

export interface Geom {
  s: number; // px per metre in the top-down view
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export interface Cam {
  mode: number; // 0 = top-down, 1 = broadcast
  fx: number; // focus point on the pitch (metres)
  fy: number;
  zoom: number; // 1 = default broadcast framing, >1 = closer
}

export interface Proj {
  P: (x: number, y: number, z?: number) => [number, number];
  /** Pixels per metre around a pitch point (for sizing players and markers). */
  scale: (x: number, y: number) => number;
  mode: number;
}

const ELEVATION = (31 * Math.PI) / 180;
const ease = (t: number) => t * t * (3 - 2 * t);

export function projector(g: Geom, cam: Cam): Proj {
  const m = ease(Math.max(0, Math.min(1, cam.mode)));

  // Top-down.
  const T = (x: number, y: number, z = 0): [number, number] => [g.ox + x * g.s, g.oy + (W - y) * g.s - z * g.s * 0.35];

  // Broadcast: camera behind the near touchline (y < 0), raised, looking at the focus.
  const fx = Math.max(6, Math.min(L - 6, cam.fx));
  const fy = Math.max(10, Math.min(W - 10, cam.fy));
  const D = 50 / Math.max(0.4, cam.zoom);
  const C = [fx, fy - D * Math.cos(ELEVATION), D * Math.sin(ELEVATION)];
  const f = norm([fx - C[0], fy - C[1], -C[2]]);
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  const focal = 1.04 * g.w;
  const cx = g.w / 2;
  const cy = g.h * 0.56;
  const B = (x: number, y: number, z = 0): [number, number] => {
    const d = [x - C[0], y - C[1], z - C[2]];
    const zc = Math.max(1, dot(d, f));
    return [cx + (focal * dot(d, r)) / zc, cy - (focal * dot(d, u)) / zc];
  };

  const P =
    m <= 0.001
      ? T
      : m >= 0.999
        ? B
        : (x: number, y: number, z = 0): [number, number] => {
            const a = T(x, y, z);
            const b = B(x, y, z);
            return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m];
          };

  const scale = (x: number, y: number) => {
    const a = P(x - 0.5, y);
    const b = P(x + 0.5, y);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };

  return { P, scale, mode: m };
}

/** Move the camera a step towards a target, frame-rate independent. */
export function follow(cam: Cam, target: Cam, dtSeconds: number, tau = 0.35) {
  const k = 1 - Math.exp(-dtSeconds / tau);
  cam.mode += (target.mode - cam.mode) * k;
  cam.fx += (target.fx - cam.fx) * k;
  cam.fy += (target.fy - cam.fy) * k;
  cam.zoom += (target.zoom - cam.zoom) * k;
}

type V = number[];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V) => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
