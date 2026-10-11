/**
 * The 3D game board (React Three Fiber). Presentation only: it reads the
 * detached visual game, the presentation stage and the timeline, and never
 * decides a rule. Its only command is `onRoll` (accessible button).
 *
 * DOM contract (docs/REDESIGN.md §7.6): section.fund-board[data-quality,
 * data-reduced-motion, data-presentation-stage, data-dice-state,
 * data-pawn-state] > .fund-board-canvas[role=img, data-camera, data-fps,
 * data-scene-ready] + .fund-board-accessible (52 cells, "Lancer le dé").
 *
 * HUD hover props (highlightSector / highlightZone / highlightPlayerId) only
 * light things up: they never move the camera and never issue a command.
 */
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { isMarketId, type GameNotice, type ZoneId } from "@global-fund/shared";
import { playCue } from "../presentation/audio";
import { PRESENTATION_TIMING } from "../presentation/sequence";
import { gradeDelta } from "../ui/theme";
import type { BoardInsets, BoardSceneProps } from "./types";
import type { GlobeFlight, GlobeMarker, GlobeProps } from "./three/globe";
import { cellAccent, cellArt, cellTheme } from "./three/atlas";
import { playerRegion, wrapCell } from "./three/layout";
import { probeRenderer, tierSettings } from "./three/quality";
import { Scene } from "./three/Scene";
import { FallbackBoard } from "./three/Fallback";
import type { BoardRuntime, CameraMode, DeckFocus, Mood } from "./three/runtime";
import "./board-scene.css";

export type { BoardSceneProps } from "./types";

const DEFAULT_INSETS: BoardInsets = { top: 92, right: 300, bottom: 168, left: 264 };
const FOLLOW_STAGES = ["BOARD_FOCUS", "DICE_ROLLING", "DICE_RESULT", "PAWN_MOVING", "PAWN_ARRIVAL", "SPACE_REVEAL"];
const LANDED_STAGES = ["PAWN_ARRIVAL", "SPACE_REVEAL", "CARD_READING", "CARD_DISMISS", "MARKET_IMPACT"];

/** HUD-covered margins when GameWorld does not pass them, by viewport class. */
function defaultInsets(width: number, height: number): BoardInsets {
  const base = width <= 900 ? { top: 150, right: 12, bottom: 250, left: 12 }
    : width <= 1180 ? { top: 92, right: 232, bottom: 168, left: 104 }
    : width <= 1440 ? { top: 92, right: 268, bottom: 160, left: 236 }
    : DEFAULT_INSETS;
  return clampInsets(base, width, height);
}

/** Never leave the board less than 42 % of the viewport in either direction. */
function clampInsets(insets: BoardInsets, width: number, height: number): BoardInsets {
  const fit = (a: number, b: number, size: number) => {
    const room = size * 0.58;
    const total = a + b;
    return total <= room ? [a, b] : [(a / total) * room, (b / total) * room];
  };
  const [left, right] = fit(insets.left, insets.right, width);
  const [top, bottom] = fit(insets.top, insets.bottom, height);
  return { top: top!, right: right!, bottom: bottom!, left: left! };
}

function latestTravel(notices: GameNotice[]) {
  for (let i = notices.length - 1; i >= 0; i--) {
    const n = notices[i]!;
    if (n.fromZoneId && n.zoneId && n.fromZoneId !== n.zoneId && isMarketId(n.fromZoneId) && isMarketId(n.zoneId)) return n;
  }
  return null;
}

class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function BoardScene({
  game, onRoll, disabled = false, reducedMotion = false, focusZone = null, quality = "high", presentation = null,
  overview = false, timeline = null, stage, travelPreview = null, marketImpact = null, insets, viewerId,
  highlightSector = null, highlightZone = null, highlightPlayerId = null,
}: BoardSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const [systemReduced, setSystemReduced] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const probe = useMemo(() => probeRenderer(), []);
  const tier = useMemo(() => tierSettings(quality, probe), [quality, probe]);
  const animateLess = reducedMotion || systemReduced;

  useEffect(() => {
    let intersecting = true;
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver((entries) => { intersecting = entries[0]?.isIntersecting ?? true; update(); });
    if (host.current) observer.observe(host.current);
    document.addEventListener("visibilitychange", update);
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); window.removeEventListener("resize", resize); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // ------------------------------------------------------------ derived --
  const active = game.players.find((p) => p.id === game.activePlayerId) ?? game.players[0];
  const activeId = active?.id ?? "";
  const frame = useMemo(() => clampInsets(insets ?? defaultInsets(viewport.width, viewport.height), viewport.width, viewport.height), [insets, viewport.width, viewport.height]);
  const latestRoll = useMemo(() => {
    for (let i = game.notices.length - 1; i >= 0; i--) { const roll = game.notices[i]!.roll; if (roll && roll >= 1 && roll <= 6) return roll; }
    return 1;
  }, [game.notices]);
  const landed = timeline && LANDED_STAGES.includes(stage ?? "") ? cellArt(game.board[wrapCell(timeline.toPosition)]) : null;
  const mood: Mood = presentation === "crash" || presentation === "bull" || presentation === "bear"
    ? presentation
    : landed?.kind === "crash" || landed?.kind === "bull" || landed?.kind === "bear" ? landed.kind : null;
  const lastNotice = game.notices[game.notices.length - 1];
  const reading = stage === "SPACE_REVEAL" || stage === "CARD_READING";
  const deckFocus: DeckFocus = !reading ? null
    : presentation === "context" || presentation === "event" ? presentation
    : landed?.kind === "event" ? "event"
    : !timeline && lastNotice?.cardType === "context" ? "context" : null;

  // Travel: the latest move notice becomes one globe flight, replayed once.
  const travel = latestTravel(game.notices);
  const seenTravel = useRef<number | null>(travel?.id ?? null);
  const [flight, setFlight] = useState<GlobeFlight | null>(null);
  const [flightActive, setFlightActive] = useState(false);
  useEffect(() => {
    if (!travel || seenTravel.current === travel.id) return;
    seenTravel.current = travel.id;
    const traveller = game.players.find((p) => p.id === travel.playerId);
    setFlight({ key: travel.id, fromZone: travel.fromZoneId as ZoneId, toZone: travel.zoneId as ZoneId, seatColor: traveller?.color ?? "#d2ad66", startedAt: performance.now(), durationMs: PRESENTATION_TIMING.travel, playerId: travel.playerId ?? undefined });
    setFlightActive(true);
    playCue("travel");
  }, [travel, game.players]);
  useEffect(() => {
    if (!flightActive || !flight) return;
    const timer = setTimeout(() => setFlightActive(false), Math.max(0, flight.startedAt + flight.durationMs - performance.now()));
    return () => clearTimeout(timer);
  }, [flightActive, flight]);

  const following = !animateLess && FOLLOW_STAGES.includes(stage ?? "");
  const zoneFocus = (focusZone && isMarketId(focusZone) ? focusZone : null)
    ?? (travelPreview && isMarketId(travelPreview.to) ? travelPreview.to : null)
    ?? (flightActive && flight ? flight.toZone : null);
  const cameraMode: CameraMode = mood === "crash" ? "crash"
    : overview ? "global"
    : hovered !== null ? "cell"
    : following ? "player"
    : focusZone || (flightActive && !animateLess) ? "zone"
    : !animateLess && game.phase === "sector" ? "player"
    : "global";

  const globe = useMemo<Omit<GlobeProps, "radius">>(() => {
    const markers: GlobeMarker[] = game.players.map((p) => ({
      playerId: p.id, zoneId: playerRegion(p), seatColor: p.color, pawn: p.pawn, active: p.id === activeId, jailed: p.jailed || p.zone === "prison",
    }));
    const impact = marketImpact?.scope === "zone" && isMarketId(marketImpact.id)
      ? { zoneId: marketImpact.id, direction: gradeDelta(marketImpact.before, marketImpact.after) >= 0 ? "up" as const : "down" as const, key: `${marketImpact.id}-${marketImpact.before}-${marketImpact.after}` }
      : null;
    return {
      zoneGrades: game.zoneGrades,
      focusZone: zoneFocus,
      activeZone: active ? playerRegion(active) : null,
      markers,
      flight,
      preview: travelPreview && isMarketId(travelPreview.to) ? { fromZone: travelPreview.from && isMarketId(travelPreview.from) ? travelPreview.from : null, toZone: travelPreview.to } : null,
      impact,
      labels: true,
      highlightZone: highlightZone && isMarketId(highlightZone) ? highlightZone : null,
      reducedMotion: animateLess,
      quality: tier.tier,
    };
  }, [game.players, game.zoneGrades, activeId, active, zoneFocus, flight, travelPreview, marketImpact, highlightZone, animateLess, tier.tier]);

  // ------------------------------------------------------------ runtime --
  const runtime = useRef<BoardRuntime>(null as unknown as BoardRuntime);
  if (runtime.current === null) {
    runtime.current = {
      game, timeline, stage, reduced: animateLess, tier, insets: frame, hovered, focusZone: zoneFocus, cameraMode, mood: null, moodAt: -1e9,
      deck: null, deckAt: -1e9, impact: null, arrival: null, activeId, viewerId, highlightSector, highlightPlayerId,
      activePos: { x: 0, z: 0 }, shakeAt: -1e9,
    };
  }
  useLayoutEffect(() => {
    const rt = runtime.current;
    const now = performance.now();
    if (rt.mood !== mood) { rt.moodAt = now; if (mood === "crash") rt.shakeAt = now; }
    if (rt.deck !== deckFocus && deckFocus) rt.deckAt = now;
    if (stage === "PAWN_ARRIVAL" && timeline && rt.stage !== "PAWN_ARRIVAL") {
      const cell = wrapCell(timeline.toPosition);
      const art = cellArt(game.board[cell]);
      // Start on the pawn's landing beat (the stage may commit a frame late).
      const landing = timeline.motionStartedAt + Math.max(1, timeline.roll) * (timeline.motionStepMs || PRESENTATION_TIMING.step);
      const at = now - landing >= 0 && now - landing < 400 ? landing : now;
      rt.arrival = { cell, at, color: cellAccent(art), theme: cellTheme(art), key: timeline.noticeId };
    }
    const impactKey = marketImpact?.scope === "sector" ? `${marketImpact.id}-${marketImpact.before}-${marketImpact.after}` : null;
    if (!impactKey) rt.impact = null;
    else if (rt.impact?.key !== impactKey && marketImpact) {
      const cells = game.board.flatMap((cell, index) => (cell.sector === marketImpact.id ? [index] : []));
      rt.impact = { cells, up: gradeDelta(marketImpact.before, marketImpact.after) >= 0, at: now, key: impactKey };
    }
    Object.assign(rt, { game, timeline, stage, reduced: animateLess, tier, insets: frame, hovered, focusZone: zoneFocus, cameraMode, mood, deck: deckFocus, activeId, viewerId, highlightSector, highlightPlayerId });
  });

  // Dice cue once per roll (the die itself follows the timeline).
  const heardRoll = useRef<number | null>(null);
  useEffect(() => {
    if (timeline && heardRoll.current !== timeline.noticeId) { heardRoll.current = timeline.noticeId; playCue("dice"); }
  }, [timeline?.noticeId]);

  // Frame budget attributes: fps "0" when not animating, readiness fallback after 4 s.
  useEffect(() => { if ((animateLess || !visible) && host.current) host.current.dataset.fps = "0"; }, [animateLess, visible]);
  useEffect(() => {
    const timer = setTimeout(() => { if (host.current) host.current.dataset.sceneReady = "true"; }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const zoneName = (id: string) => game.zones.find((z) => z.id === id)?.name ?? id;
  const summary = useMemo(() => game.players.map((p) => `${p.name} : case ${wrapCell(p.sectorPosition) + 1}, ${game.board[wrapCell(p.sectorPosition)]?.label || "Départ"}, marché ${zoneName(playerRegion(p))}${p.jailed ? ", en enquête" : ""}`).join(". "),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.players, game.board, game.zones]);

  const fallback = <FallbackBoard board={game.board} players={game.players} insets={frame} host={host} />;
  const canvasKey = `${tier.tier}-${tier.software ? "sw" : "hw"}`;
  const frameloop = !visible ? "never" : animateLess ? "demand" : "never";

  return (
    <section
      className="fund-board"
      aria-label="Plateau des marchés mondiaux"
      data-quality={tier.tier}
      data-reduced-motion={animateLess}
      data-presentation-stage={stage}
      data-dice-state={stage === "DICE_ROLLING" && !animateLess ? "rolling" : "stopped"}
      data-pawn-state={stage === "PAWN_MOVING" && !animateLess ? "moving" : "idle"}
      data-mood={mood ?? undefined}
    >
      <div ref={host} className="fund-board-canvas" role="img" aria-label={`Plateau Global Fund. ${summary}`} data-camera={flightActive && !animateLess ? "flight" : cameraMode} data-fps="0" data-scene-ready="false">
        {probe.available ? (
          <CanvasBoundary fallback={fallback}>
            <Canvas
              key={canvasKey}
              className="fund-board-gl"
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
              frameloop={frameloop}
              dpr={tier.dpr}
              shadows={tier.shadows ? "percentage" : false}
              gl={{ alpha: true, antialias: tier.antialias, powerPreference: "high-performance", stencil: false, premultipliedAlpha: true }}
              camera={{ fov: 30, near: 0.5, far: 400, position: [0, 26, 26] }}
              onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1; }}
            >
              <Scene
                runtime={runtime}
                host={host}
                tier={tier}
                reduced={animateLess}
                visible={visible}
                board={game.board}
                players={game.players}
                activeId={activeId}
                timeline={timeline}
                cameraMode={cameraMode}
                insets={frame}
                deckFocus={deckFocus}
                globe={globe}
                latestRoll={latestRoll}
                contexts={game.contextsRemaining}
                events={game.boardEventsRemaining}
                maxTextureSize={probe.maxTextureSize}
              />
            </Canvas>
          </CanvasBoundary>
        ) : fallback}
      </div>
      {mood && <div className={`fund-board-mood fund-board-mood--${mood}${animateLess ? "" : " is-live"}`} aria-hidden="true" />}
      <div className="fund-board-accessible" style={{ top: frame.top + 12, left: frame.left + 12, maxHeight: Math.max(160, viewport.height - frame.top - frame.bottom - 24) }}>
        <details>
          <summary>Explorer les 52 cases</summary>
          <p aria-live="polite">{summary}</p>
          <ol>
            {game.board.map((cell, index) => (
              <li key={index}>
                <button type="button" onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} aria-current={active && wrapCell(active.sectorPosition) === index ? "step" : undefined}>
                  Case {index + 1} : {cell.label}{game.players.filter((p) => wrapCell(p.sectorPosition) === index).map((p) => ` — ${p.name}`).join("")}
                </button>
              </li>
            ))}
          </ol>
        </details>
        {onRoll && <button className="fund-board-accessible-roll" type="button" disabled={disabled} onClick={() => onRoll()}>Lancer le dé</button>}
      </div>
    </section>
  );
}
