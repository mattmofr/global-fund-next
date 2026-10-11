import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getPresentationSettings, subscribePresentationSettings } from "./presentation/settings";
import "./styles.css";

// Global hooks for CSS: html[data-motion="reduced"] and html[data-quality="low|medium|high"].
function syncDocumentSettings() {
  const { reducedMotion, quality } = getPresentationSettings();
  document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
  document.documentElement.dataset.quality = quality;
}
syncDocumentSettings();
subscribePresentationSettings(syncDocumentSettings);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
