export type Voice = "fan" | "analyst";

export interface AiAnswer {
  text: string;
  mode: "foundry" | "offline";
  model: string | null;
  ms: number;
  cached?: boolean;
  fallback?: boolean; // answered by the backup deployment
  as_of?: number | null; // live mode cutoff (match seconds) the answer is based on
  cards?: Card[];
  follow_ups?: string[];
}

export interface PlayerCard {
  kind: "player";
  player: number;
  number: number;
  name: string;
  position: string;
  team: number;
  decisions: number;
  good_decisions: number | null;
  pass_accuracy: number | null;
  line_breaking: number;
  mix: { good: number; missed: number; risky: number };
}

export interface TeamsCard {
  kind: "teams";
  score: [number, number];
  rows: { label: string; values: [number, number]; pct: boolean; lower_better: boolean }[];
}

export interface MomentCard {
  kind: "moment";
  moment_id: number;
  t: number;
  player: number;
  team: number;
  verdict: string;
  cost: number;
  start: [number, number] | null;
  played: { receiver: number | null; target: [number, number]; p: number; ev: number; kind: string; style: string };
  better: { receiver: number | null; target: [number, number]; p: number; ev: number; kind: string; style: string };
}

export type Card = PlayerCard | TeamsCard | MomentCard;

export interface AiHealth {
  ok: boolean;
  mode: "foundry" | "offline";
  model: string | null;
}

export const LANGUAGES = ["English", "Spanish", "French", "Portuguese", "German", "Hindi", "Arabic", "Japanese"];

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8000";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const ai = {
  health: (): Promise<AiHealth> => fetch(`${BASE}/api/health`).then((r) => (r.ok ? r.json() : Promise.reject())),
  explain: (moment_id: number, voice: Voice, language: string) => post<AiAnswer>("/api/explain", { moment_id, voice, language }),
  ask: (question: string, voice: Voice, language: string, as_of: number | null) =>
    post<AiAnswer>("/api/ask", { question, voice, language, as_of }),
  coach: (team: string, voice: Voice, language: string, as_of: number | null) =>
    post<AiAnswer>("/api/coach", { team, voice, language, as_of }),
};
