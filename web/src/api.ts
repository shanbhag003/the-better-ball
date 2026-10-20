export type Voice = "fan" | "analyst";

export interface AiAnswer {
  text: string;
  mode: "foundry" | "offline";
  model: string | null;
  ms: number;
  cached?: boolean;
  fallback?: boolean; // answered by the backup deployment
}

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
  ask: (question: string, voice: Voice, language: string) => post<AiAnswer>("/api/ask", { question, voice, language }),
  coach: (team: string, voice: Voice, language: string) => post<AiAnswer>("/api/coach", { team, voice, language }),
};
