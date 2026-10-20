import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AiPrefsProvider } from "./aiPrefs";
import App from "./App";
import "./styles.css";

// Dev-only: ?fakeraf drives animation frames with a timer, so the replay can be tested in a
// hidden/background browser where requestAnimationFrame is paused. Stripped from production builds.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("fakeraf")) {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AiPrefsProvider>
      <App />
    </AiPrefsProvider>
  </StrictMode>,
);
