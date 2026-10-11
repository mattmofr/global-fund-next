import { useSyncExternalStore } from "react";

export type GraphicQuality = "high" | "medium" | "low";
export interface PresentationSettings {
  reducedMotion: boolean;
  quality: GraphicQuality;
}
const key = "global-fund-presentation-settings";
let saved: PresentationSettings = { reducedMotion: false, quality: "high" };
try {
  const value = JSON.parse(localStorage.getItem(key) ?? "null");
  if (value) saved = {
    reducedMotion: value.reducedMotion === true,
    quality: ["high", "medium", "low"].includes(value.quality) ? value.quality : "high",
  };
} catch { /* Le jeu fonctionne sans stockage local. */ }
const subscribers = new Set<() => void>();
const media = typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)");
let snapshot = { ...saved, reducedMotion: saved.reducedMotion || Boolean(media?.matches) };
function refresh() {
  snapshot = { ...saved, reducedMotion: saved.reducedMotion || Boolean(media?.matches) };
  subscribers.forEach((notify) => notify());
}
media?.addEventListener("change", refresh);
export function getPresentationSettings() { return snapshot; }
/** Non-React listener (document attributes). Returns an unsubscribe function. */
export function subscribePresentationSettings(notify: () => void) {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}
export function setPresentationSettings(next: Partial<PresentationSettings>) {
  saved = { ...saved, ...next };
  try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* optional */ }
  refresh();
  return snapshot;
}
export function usePresentationSettings() {
  return useSyncExternalStore((notify) => {
    subscribers.add(notify);
    return () => { subscribers.delete(notify); };
  }, getPresentationSettings, getPresentationSettings);
}
