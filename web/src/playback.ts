import { useEffect, useState, useSyncExternalStore } from "react";

/** Tiny playback store: the canvas reads `t` every frame, React UI subscribes at a lower rate. */
export class Playback {
  t = 0;
  playing = false;
  speed = 1;
  min = 0;
  max = 1;
  /** Called while playing; return a time to stop at (inclusive) or null. */
  stopAt: ((from: number, to: number) => number | null) | null = null;
  onStop: ((t: number) => void) | null = null;

  private listeners = new Set<() => void>();
  private raf = 0;
  private last = 0;
  version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  seek(t: number) {
    this.t = Math.max(this.min, Math.min(this.max, t));
    this.emit();
  }

  setSpeed(s: number) {
    this.speed = s;
    this.emit();
  }

  play() {
    if (this.playing) return;
    if (this.t >= this.max) this.t = this.min;
    this.playing = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  private tick = (now: number) => {
    if (!this.playing) return;
    const dt = Math.min(0.1, (now - this.last) / 1000) * this.speed;
    this.last = now;
    const from = this.t;
    const to = Math.min(this.max, from + dt);
    const stop = this.stopAt?.(from, to) ?? null;
    if (stop !== null) {
      this.t = stop;
      this.pause();
      this.onStop?.(stop);
      return;
    }
    this.t = to;
    if (to >= this.max) {
      this.pause();
      return;
    }
    // Notify UI ~15 times a second; the canvas polls `t` itself.
    if (Math.floor(from * 15 / this.speed) !== Math.floor(to * 15 / this.speed)) this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };
}

export function usePlayback(pb: Playback) {
  useSyncExternalStore(pb.subscribe, () => pb.version);
  return pb;
}

export function useMediaQuery(q: string) {
  const [match, setMatch] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const fn = () => setMatch(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [q]);
  return match;
}
