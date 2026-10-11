import { useEffect, useRef, useState, type RefObject } from "react";
import { Emblem } from "./MainMenu";

type Phase = "code" | "scene" | "ready";

/** Each phase eases the bar toward its cap; only a ready scene reaches 100 %. */
const CAPS: Record<Phase, number> = { code: 0.42, scene: 0.9, ready: 1 };
const RATES: Record<Phase, number> = { code: 0.9, scene: 0.75, ready: 7 };
const LABELS: Record<Phase, string> = { code: "Chargement du jeu", scene: "Installation de la table", ready: "Derniers réglages" };
/** Never keep the curtain up forever (lost WebGL context, hidden tab…). */
const FAILSAFE_MS = 20_000;
/** Lets the first heavy frames (shader compilation) pass behind the curtain. */
const SETTLE_MS = 260;

/**
 * Loading curtain over the game world. It hides the 3D table while its code,
 * textures and shaders load — so the scene never appears piece by piece — and
 * fades out once the board reports `data-scene-ready="true"` (WebGL scene or
 * 2D fallback). Progress is monotonic: it eases toward a cap per phase.
 */
export function SceneLoader({ world, reducedMotion }: { world: RefObject<HTMLElement | null>; reducedMotion: boolean }) {
  const [state, setState] = useState<"loading" | "leaving" | "done">("loading");
  const fill = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const percent = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let phase: Phase = "code";
    let progress = 0.04;
    let readyAt = 0;
    let last = performance.now();
    let shown = -1;
    const started = last;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const canvas = world.current?.querySelector<HTMLElement>(".fund-board-canvas");
      if (phase === "code" && canvas) phase = "scene";
      if (phase !== "ready" && (canvas?.dataset.sceneReady === "true" || now - started > FAILSAFE_MS)) { phase = "ready"; readyAt = now; }
      progress += (CAPS[phase] - progress) * (1 - Math.exp(-RATES[phase] * dt));
      const value = Math.min(100, Math.round(progress * 100));
      if (fill.current) fill.current.style.transform = `scaleX(${progress.toFixed(4)})`;
      if (value !== shown) {
        shown = value;
        if (percent.current) percent.current.textContent = `${value} %`;
        if (bar.current && value % 5 === 0) bar.current.setAttribute("aria-valuenow", String(value));
      }
      if (label.current && label.current.textContent !== LABELS[phase]) label.current.textContent = LABELS[phase];
      if (phase === "ready" && progress > 0.995 && now - readyAt > SETTLE_MS) { setState("leaving"); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [world]);

  useEffect(() => {
    if (state !== "leaving") return;
    const timer = window.setTimeout(() => setState("done"), reducedMotion ? 160 : 700);
    return () => window.clearTimeout(timer);
  }, [state, reducedMotion]);

  if (state === "done") return null;
  return <div className={`scene-loader ${state === "leaving" ? "is-leaving" : ""}`} aria-hidden={state === "leaving" || undefined}>
    <Emblem className="scene-loader__emblem" />
    <span className="scene-loader__brand">GLOBAL FUND</span>
    <div ref={bar} className="scene-loader__bar" role="progressbar" aria-label="Chargement de la partie" aria-valuemin={0} aria-valuemax={100} aria-valuenow={4}>
      <span ref={fill} className="scene-loader__fill" />
    </div>
    <p className="scene-loader__status" role="status"><span ref={label}>{LABELS.code}</span><span ref={percent} className="scene-loader__percent">4 %</span></p>
  </div>;
}
