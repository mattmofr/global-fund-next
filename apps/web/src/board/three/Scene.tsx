/**
 * Everything inside the R3F canvas: render loop control, frame probe
 * (data-fps / data-scene-ready), camera, lights, the board, centre piece,
 * die, decks, figurines, sector arrival effects, event effects and
 * post-processing.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { advance, useThree } from "@react-three/fiber";
import type { BoardCell, Player } from "@global-fund/shared";
import type { BoardTimeline } from "../../presentation/sequence";
import type { BoardInsets } from "../types";
import type { GlobeProps } from "./globe";
import { buildBoardAtlas, ensureBoardFonts, type BoardAtlas } from "./atlas";
import { atlasTextures } from "./surfaces";
import { CentreDecor, Fillets, Frame, LacquerMirror, Plaques, Slab, Table, useBoardMaterials, useDisposable, type BoardMaterials } from "./Board";
import { Centerpiece } from "./Centerpiece";
import { Die } from "./Die";
import { Decks } from "./Decks";
import { Figurines } from "./Figurines";
import { CameraRig } from "./Camera";
import { Lighting } from "./Lighting";
import { BullEffects } from "./Effects";
import { SectorFx } from "./SectorFx";
import { PostFX } from "./PostFX";
import { RuntimeContext, type BoardRuntime, type CameraMode, type DeckFocus } from "./runtime";
import type { TierSettings } from "./quality";

/** Manual render loop capped at the tier's frame rate (never runs in reduced motion). */
function FrameDriver({ active, maxFps }: { active: boolean; maxFps: number }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = -Infinity;
    const interval = 1000 / maxFps;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < interval - 2) return;
      last = now;
      advance(performance.now() / 1000, true, get());
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, maxFps, get]);
  return null;
}

/** Counts rendered frames of the main scene; flags readiness after assets. */
function FrameProbe({ host, ready, reduced }: { host: RefObject<HTMLDivElement | null>; ready: boolean; reduced: boolean }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const state = useRef({ ready, reduced, frames: 0, started: performance.now() });
  state.current.ready = ready;
  state.current.reduced = reduced;
  useEffect(() => { if (ready) invalidate(); }, [ready, invalidate]);
  useEffect(() => {
    const probe = state.current;
    const previous = scene.onAfterRender;
    scene.onAfterRender = (_renderer, _scene, renderCamera) => {
      // Only the main view counts (mirror / environment passes render the scene too).
      if (renderCamera !== camera) return;
      const el = host.current;
      if (!el) return;
      if (probe.ready && el.dataset.sceneReady !== "true") el.dataset.sceneReady = "true";
      if (probe.reduced) { probe.frames = 0; probe.started = performance.now(); return; }
      probe.frames++;
      const now = performance.now();
      if (now - probe.started >= 1000) {
        el.dataset.fps = String(Math.round((probe.frames * 1000) / (now - probe.started)));
        probe.frames = 0;
        probe.started = now;
      }
    };
    return () => { scene.onAfterRender = previous; };
  }, [scene, camera, host]);
  return null;
}

function useBoardAtlas(board: BoardCell[], scale: number, withMask: boolean, maxTexture: number) {
  const key = useMemo(() => `${board.map((c) => `${c.kind}|${c.label}|${c.sector ?? ""}`).join(";")}@${scale}:${withMask}`, [board, scale, withMask]);
  const [atlas, setAtlas] = useState<{ key: string; atlas: BoardAtlas } | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  useEffect(() => {
    let alive = true;
    void ensureBoardFonts().then(() => {
      if (!alive) return;
      let s = scale;
      let built = buildBoardAtlas(boardRef.current, s, withMask);
      while (built.height > maxTexture && s > 72) {
        s = Math.round(s * 0.82);
        built = buildBoardAtlas(boardRef.current, s, withMask);
      }
      setAtlas({ key, atlas: built });
    });
    return () => { alive = false; };
  }, [key, scale, withMask, maxTexture]);
  return atlas?.key === key ? atlas.atlas : null;
}

function Engraved({ atlas, materials, physical, tier, latestRoll, contexts, events, deckFocus }: {
  atlas: BoardAtlas; materials: BoardMaterials; physical: boolean; tier: TierSettings; latestRoll: number; contexts: number; events: number; deckFocus: DeckFocus;
}) {
  const gl = useThree((s) => s.gl);
  const anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), tier.tier === "high" ? 16 : tier.tier === "medium" ? 8 : 4);
  const textures = useDisposable(() => {
    const t = atlasTextures(atlas, anisotropy);
    return { ...t, dispose: () => { t.color.dispose(); t.mask?.dispose(); } };
  }, [atlas, anisotropy]);
  return (
    <>
      <Plaques atlas={atlas} color={textures.color} mask={textures.mask} physical={physical} />
      <CentreDecor atlas={atlas} color={textures.color} mask={textures.mask} materials={materials} />
      <Die atlas={atlas} color={textures.color} physical={physical} latestRoll={latestRoll} />
      <Decks atlas={atlas} color={textures.color} mask={textures.mask} physical={physical} contexts={contexts} events={events} focus={deckFocus} spotlight={tier.tier !== "low"} />
    </>
  );
}

export interface SceneProps {
  runtime: { current: BoardRuntime };
  host: RefObject<HTMLDivElement | null>;
  tier: TierSettings;
  reduced: boolean;
  visible: boolean;
  board: BoardCell[];
  players: Player[];
  activeId: string;
  timeline: BoardTimeline | null;
  cameraMode: CameraMode;
  insets: BoardInsets;
  deckFocus: DeckFocus;
  globe: Omit<GlobeProps, "radius">;
  latestRoll: number;
  contexts: number;
  events: number;
  maxTextureSize: number;
}

export function Scene(props: SceneProps) {
  const { runtime, host, tier, reduced, visible } = props;
  const physical = tier.physical;
  const materials = useBoardMaterials(physical);
  const atlas = useBoardAtlas(props.board, tier.atlasScale, tier.mask, props.maxTextureSize);
  const [globeReady, setGlobeReady] = useState(false);
  const onGlobeReady = useMemo(() => () => setGlobeReady(true), []);
  const invalidate = useThree((s) => s.invalidate);
  // Reduced motion renders on demand: any input change asks for one frame.
  useEffect(() => { invalidate(); });
  return (
    <RuntimeContext.Provider value={runtime}>
      <FrameDriver active={visible && !reduced} maxFps={tier.maxFps} />
      <FrameProbe host={host} ready={!!atlas && globeReady} reduced={reduced || !visible} />
      <CameraRig mode={props.cameraMode} insets={props.insets} />
      <Lighting tier={tier} />
      <Table size={tier.tier === "high" ? 1024 : 512} />
      <Slab materials={materials} />
      <Frame materials={materials} />
      <Fillets materials={materials} />
      {tier.tier === "high" && <LacquerMirror />}
      {atlas && (
        <Engraved atlas={atlas} materials={materials} physical={physical} tier={tier} latestRoll={props.latestRoll} contexts={props.contexts} events={props.events} deckFocus={props.deckFocus} />
      )}
      <Centerpiece materials={materials} globe={props.globe} onReady={onGlobeReady} />
      <Figurines players={props.players} activeId={props.activeId} quality={tier.tier} timeline={props.timeline} reduced={reduced} spotlight={tier.tier !== "low"} />
      {atlas && <SectorFx lite={tier.tier === "low"} shadows={tier.shadows} />}
      {tier.tier !== "low" && <BullEffects count={tier.tier === "high" ? 220 : 120} />}
      <PostFX tier={tier} />
    </RuntimeContext.Provider>
  );
}
