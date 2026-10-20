import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ai, type AiHealth, type Voice } from "./api";

interface Prefs {
  voice: Voice;
  setVoice: (v: Voice) => void;
  language: string;
  setLanguage: (l: string) => void;
  health: AiHealth | null; // null while unknown or when the API is unreachable
}

const Ctx = createContext<Prefs | null>(null);

function read(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Audience and language for every AI answer, remembered per browser. */
export function AiPrefsProvider({ children }: { children: ReactNode }) {
  const [voice, setVoiceState] = useState<Voice>(() => (read("tbb-voice", "fan") === "analyst" ? "analyst" : "fan"));
  const [language, setLanguageState] = useState(() => read("tbb-lang", "English"));
  const [health, setHealth] = useState<AiHealth | null>(null);

  useEffect(() => {
    ai.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const setVoice = (v: Voice) => { setVoiceState(v); write("tbb-voice", v); };
  const setLanguage = (l: string) => { setLanguageState(l); write("tbb-lang", l); };

  return <Ctx.Provider value={{ voice, setVoice, language, setLanguage, health }}>{children}</Ctx.Provider>;
}

export function useAiPrefs() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAiPrefs outside AiPrefsProvider");
  return c;
}
