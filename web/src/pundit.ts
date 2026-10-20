import { ai, type PunditScript, type Voice } from "./api";

/** Pundit scripts by moment, voice and language; requests are shared and kept for the session. */
const cache = new Map<string, Promise<PunditScript>>();

const key = (id: number, voice: Voice, language: string) => `${id}|${voice}|${language}`;

export function getPundit(id: number, voice: Voice, language: string): Promise<PunditScript> {
  const k = key(id, voice, language);
  let p = cache.get(k);
  if (!p) {
    p = ai.pundit(id, voice, language);
    p.catch(() => cache.delete(k)); // let a later attempt retry
    cache.set(k, p);
  }
  return p;
}

/** Start fetching early (e.g. during the build-up) so the breakdown can begin on time. */
export function prefetchPundit(id: number, voice: Voice, language: string) {
  getPundit(id, voice, language).catch(() => {});
}

/** Line boundaries (seconds) for captions, proportional to text length. */
export function lineTimes(lines: string[], total: number): number[] {
  const lens = lines.map((l) => Math.max(8, l.length));
  const sum = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  return lens.map((n) => {
    const start = (acc / sum) * total;
    acc += n;
    return start;
  });
}
