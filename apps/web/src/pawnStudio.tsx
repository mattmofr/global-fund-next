/**
 * Dev-only figurine studio (apps/web/pawn-studio.html, never in the production
 * build input). Renders the 3D pieces in a refined 3/4 studio light.
 *
 *   ?piece=lion&size=1024   transparent portrait canvas; window.__pawnStudio.capture(512) → PNG data URL
 *   ?mode=sheet             all pieces side by side (idle / active / jailed)
 *   ?mode=review            the generated PNG portraits at UI sizes (+ contact sheet)
 *   ?mode=turn&piece=lion   one piece from four angles
 *   ?mode=globe             the armillary globe alone (&flight=europe-oceania&loop=1, &preview=1, &impact=1, &highlight=asia, &reduced=1)
 *   ?mode=plane             the travel airliner from four angles (&throttle=0..1)
 *   ?mode=hero&variant=menu the menu backdrop (menu | setup | lobby)
 *
 * scripts/redesign/render-pawns.ts drives the portrait mode headlessly.
 */
import { StrictMode, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { PLAYER_COLORS, type PawnId, type ZoneId } from "@global-fund/shared";
import { PawnModel, PAWN_IDS, getPieceParts } from "./board/three/pawns";
import { ArmillaryGlobe, type GlobeFlight } from "./board/three/globe";
import { Airplane } from "./board/three/airplane";
import { transmissionBackdropMaterial, transmissionOnlyBeforeRender } from "./board/three/materials";
import { blendCameraPoses, createCameraPose, createTravelChannel, type TravelChannel } from "./board/three/travelCinematic";
import { PAWN_META } from "./ui/theme";

const MenuHero = lazy(() => import("./board/three/MenuHero"));

declare global {
  interface Window {
    __pawnStudio?: { ready: boolean; frames: number; capture: (size: number) => string };
  }
}

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") ?? (params.get("piece") ? "portrait" : "sheet");
const quality = (params.get("quality") as "high" | "medium" | "low" | null) ?? "high";
const STAGE_BACKGROUND = "radial-gradient(70% 80% at 50% 40%, #24201b 0%, #0b0a09 75%)";

/** Warm key, neutral silver rim, soft fill; reflections from procedural softboxes only. */
function StudioLights({ intensity = 1 }: { intensity?: number }) {
  return (
    <>
      <hemisphereLight args={["#4b443c", "#140f0a", 0.35 * intensity]} />
      <directionalLight position={[-2.6, 4.2, 3.2]} intensity={2.3 * intensity} color="#ffe2b8" />
      <directionalLight position={[2.8, 2.4, -3.2]} intensity={2.4 * intensity} color="#eef0f2" />
      <directionalLight position={[0.5, -1.5, 2.5]} intensity={0.25 * intensity} color="#c99a5b" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.6} color="#ffe6c4" position={[-3, 3.6, 3]} scale={[4, 3, 1]} target={[0, 0.5, 0]} />
        <Lightformer form="rect" intensity={3.0} color="#f2f1ee" position={[3.4, 2.2, -3]} scale={[0.9, 5, 1]} target={[0, 0.5, 0]} />
        <Lightformer form="ring" intensity={1.8} color="#fff4e0" position={[0, 6, 0.5]} scale={3} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.3} color="#ffffff" position={[-4.2, 1.4, -1]} scale={[0.6, 4, 1]} target={[0, 0.5, 0]} />
        <Lightformer form="rect" intensity={0.55} color="#b98a4a" position={[0, -2, 2.5]} scale={[8, 2, 1]} target={[0, 0.5, 0]} />
      </Environment>
    </>
  );
}

/** Hidden backdrop that gems refract (transparent output stays clean). */
function TransmissionBackdrop() {
  const material = useMemo(() => transmissionBackdropMaterial(), []);
  return <mesh material={material} onBeforeRender={transmissionOnlyBeforeRender} frustumCulled={false} renderOrder={-10}><sphereGeometry args={[30, 32, 16]} /></mesh>;
}

// ------------------------------------------------------------- portrait --
/** The piece fills `fill` of the frame height (and at most `fillX` of its width), centred on its own silhouette. */
const PORTRAIT = { fov: 19, elevation: 0.24, yaw: 0.36, fill: 0.91, fillX: 0.92 };

function PortraitCamera({ piece }: { piece: PawnId }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  useEffect(() => {
    camera.fov = PORTRAIT.fov;
    camera.near = 0.1;
    camera.far = 60;
    camera.aspect = 1;
    // Silhouette points: every part of the piece, turned like the model.
    const turn = new THREE.Matrix4().makeRotationY(PORTRAIT.yaw);
    const points: THREE.Vector3[] = [];
    for (const part of getPieceParts(piece, quality)) {
      const position = part.geometry.getAttribute("position");
      const step = Math.max(1, Math.ceil(position.count / 9000));
      for (let i = 0; i < position.count; i += step) points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(turn));
    }
    const direction = new THREE.Vector3(0, Math.sin(PORTRAIT.elevation), Math.cos(PORTRAIT.elevation));
    const target = new THREE.Vector3(0, 0.52, 0);
    let distance = 4;
    const ndc = new THREE.Vector3();
    const half = Math.tan(THREE.MathUtils.degToRad(PORTRAIT.fov / 2));
    for (let iteration = 0; iteration < 48; iteration++) {
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const point of points) {
        ndc.copy(point).project(camera);
        minX = Math.min(minX, ndc.x); maxX = Math.max(maxX, ndc.x);
        minY = Math.min(minY, ndc.y); maxY = Math.max(maxY, ndc.y);
      }
      target.y += ((minY + maxY) / 2) * distance * half * 0.9;
      target.x += ((minX + maxX) / 2) * distance * half * 0.9;
      distance *= Math.max((maxY - minY) / (2 * PORTRAIT.fill), (maxX - minX) / (2 * PORTRAIT.fillX));
    }
  }, [camera, piece]);
  return null;
}

function PortraitCapture({ waitFor }: { waitFor: number }) {
  const { gl, scene, camera } = useThree();
  const frames = useRef(0);
  useEffect(() => {
    window.__pawnStudio = {
      ready: false,
      frames: 0,
      capture: (size: number) => {
        gl.render(scene, camera);
        const source = gl.domElement;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // Two-step downscale keeps fine gold edges crisp but alias-free.
        let current: HTMLCanvasElement = source;
        while (current.width / 2 >= size * 1.01) {
          const half = document.createElement("canvas");
          half.width = Math.round(current.width / 2);
          half.height = Math.round(current.height / 2);
          const hctx = half.getContext("2d")!;
          hctx.imageSmoothingEnabled = true;
          hctx.imageSmoothingQuality = "high";
          hctx.drawImage(current, 0, 0, half.width, half.height);
          current = half;
        }
        ctx.drawImage(current, 0, 0, size, size);
        return canvas.toDataURL("image/png");
      },
    };
  }, [gl, scene, camera]);
  useFrame(() => {
    frames.current += 1;
    if (window.__pawnStudio) {
      window.__pawnStudio.frames = frames.current;
      if (frames.current >= waitFor) window.__pawnStudio.ready = true;
    }
  });
  return null;
}

function Portrait({ piece, size }: { piece: PawnId; size: number }) {
  const [loaded, setLoaded] = useState(piece !== "globe");
  useEffect(() => {
    if (piece === "globe") { const timer = window.setTimeout(() => setLoaded(true), 900); return () => window.clearTimeout(timer); }
  }, [piece]);
  getPieceParts(piece, quality);
  return (
    <div style={{ width: size, height: size }}>
      <Canvas
        dpr={1}
        flat={false}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }}
        camera={{ fov: PORTRAIT.fov, position: [0, 1, 4] }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.02; }}
        style={{ width: size, height: size }}
      >
        <PortraitCamera piece={piece} />
        <StudioLights />
        <TransmissionBackdrop />
        <PawnModel piece={piece} quality={quality} rotation={[0, PORTRAIT.yaw, 0]} reducedMotion />
        <PortraitCapture waitFor={loaded ? 12 : 1e9} />
      </Canvas>
    </div>
  );
}

// ----------------------------------------------------------------- sheet --
function SheetScene() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  useEffect(() => { camera.position.set(0, 1.9, 9.4); camera.lookAt(0, 0.95, 0); camera.updateProjectionMatrix(); }, [camera]);
  return (
    <>
      <StudioLights />
      {PAWN_IDS.map((piece, index) => (
        <group key={piece} position={[(index - 2.5) * 1.05, 0, 0]}>
          <PawnModel piece={piece} quality={quality} position={[0, 1.25, 0]} rotation={[0, 0.36, 0]} reducedMotion />
          <PawnModel piece={piece} quality={quality} seatColor={PLAYER_COLORS[index]} active={index % 2 === 0} jailed={index === 5} position={[0, -0.05, 1.2]} rotation={[0, 0.2, 0]} reducedMotion />
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.051, 1.2]} receiveShadow>
        <planeGeometry args={[9, 2.6]} />
        <meshStandardMaterial color="#0f0e0c" roughness={0.6} metalness={0.2} />
      </mesh>
    </>
  );
}

/** One piece from four angles (sculpt review). */
function TurnScene({ piece }: { piece: PawnId }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const zoom = Number(params.get("zoom") ?? 1);
  useEffect(() => { camera.position.set(0, 1.25 + (zoom - 1) * -0.1, 6.4 / zoom); camera.lookAt(0, 0.58 + (zoom - 1) * 0.12, 0); camera.updateProjectionMatrix(); }, [camera, zoom]);
  const angles = (params.get("angles") ?? "0_0.6_1.5708_3.1416").split(/[_,]/).map(Number);
  return (
    <>
      <StudioLights />
      {angles.map((yaw, index) => (
        <PawnModel key={index} piece={piece} quality={quality} position={[(index - (angles.length - 1) / 2) * 1.15 / Math.max(1, zoom * 0.8), 0, 0]} rotation={[0, yaw, 0]} reducedMotion />
      ))}
    </>
  );
}

function Turn() {
  const piece = (params.get("piece") as PawnId | null) ?? "lion";
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ fov: 30 }} style={{ position: "fixed", inset: 0, background: STAGE_BACKGROUND }}>
      <TurnScene piece={piece} />
      <TransmissionBackdrop />
      <PortraitCaptureFlag />
    </Canvas>
  );
}

function Sheet() {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ fov: 30 }} style={{ position: "fixed", inset: 0, background: STAGE_BACKGROUND }}>
      <SheetScene />
      <TransmissionBackdrop />
      <PortraitCaptureFlag />
    </Canvas>
  );
}

/** Generic "rendered a few frames" flag for the screenshot script. */
function PortraitCaptureFlag({ after = 20 }: { after?: number }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    window.__pawnStudio = { ready: frames.current > after, frames: frames.current, capture: () => "" };
  });
  return null;
}

// ---------------------------------------------------------------- review --
function Review() {
  const stamp = useMemo(() => Date.now(), []);
  useEffect(() => { document.body.classList.add("is-review"); window.__pawnStudio = { ready: true, frames: 0, capture: () => "" }; }, []);
  const sizes = [32, 40, 44, 64, 96, 168, 256];
  const surfaces = [
    { name: "ink", background: "#0b0a09" },
    { name: "glass", background: "linear-gradient(180deg, rgba(30,28,25,.94), rgba(14,13,12,.97))" },
    { name: "parchment", background: "#e9e2d2" },
  ];
  return (
    <div style={{ padding: 24, fontFamily: "Inter, system-ui, sans-serif", color: "#cdc6b8" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, background: "#14120f", padding: 14, borderRadius: 12, border: "1px solid rgba(226,196,134,.18)" }}>
        {PAWN_IDS.map((piece) => (
          <div key={piece} style={{ textAlign: "center" }}>
            <img src={`/assets/pawns/render/${piece}.png?v=${stamp}`} width={128} height={128} alt="" style={{ display: "block", background: "repeating-conic-gradient(#1d1b18 0 25%, #171512 0 50%) 0 0 / 16px 16px", outline: "1px solid rgba(226,196,134,.25)" }} />
            <span style={{ fontSize: 11 }}>{PAWN_META[piece].name}</span>
          </div>
        ))}
      </div>
      {surfaces.map((surface) => (
        <div key={surface.name} style={{ background: surface.background, borderRadius: 14, padding: "18px 22px", marginBottom: 18, border: "1px solid rgba(226,196,134,.18)" }}>
          {PAWN_IDS.map((piece) => (
            <div key={piece} style={{ display: "flex", alignItems: "flex-end", gap: 18, padding: "6px 0" }}>
              <span style={{ width: 70, fontSize: 12, color: surface.name === "parchment" ? "#3a3326" : "#cdc6b8" }}>{PAWN_META[piece].name}</span>
              {sizes.map((size) => (
                <img key={size} src={`/assets/pawns/render/${piece}.png?v=${stamp}`} width={size} height={size} alt="" style={{ filter: "drop-shadow(0 6px 8px rgba(0,0,0,.55))" }} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- globe --
const ROUTE_ZONES = ["americas", "europe", "asia", "africa", "oceania"];
function parseRoute(value: string | null): [ZoneId, ZoneId] | null {
  if (!value) return null;
  if (value === "1") return ["europe", "asia"];
  const [from, to] = value.split("-");
  return from && to && ROUTE_ZONES.includes(from) && ROUTE_ZONES.includes(to) && from !== to ? [from as ZoneId, to as ZoneId] : null;
}

/** Studio stand-in for the board camera rig: flies the cinematic published by the globe. */
function StudioFlightCamera({ channel }: { channel: TravelChannel }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const poses = useMemo(() => ({ board: createCameraPose(), flight: createCameraPose(), out: createCameraPose(), centre: new THREE.Vector3() }), []);
  useFrame(() => {
    const frame = channel.frame;
    const { board, flight, out } = poses;
    board.position.set(0, 2.6, 8.6);
    board.target.set(0, 0, 0);
    board.up.set(0, 1, 0);
    board.fov = 32;
    board.near = 0.1;
    let view = board;
    if (frame.active) {
      flight.position.copy(frame.camPos);
      flight.target.copy(frame.camTarget);
      flight.up.copy(frame.camUp);
      flight.fov = frame.fov;
      flight.near = frame.near;
      view = blendCameraPoses(board, flight, frame.close, poses.centre, out);
    }
    camera.position.copy(view.position);
    camera.up.copy(view.up);
    camera.lookAt(view.target);
    camera.fov = view.fov;
    camera.near = view.near;
    camera.updateProjectionMatrix();
  }, -1);
  return null;
}

function GlobeReview() {
  const [zone, setZone] = useState<ZoneId | null>(null);
  const channel = useMemo(() => (params.get("follow") === "0" ? null : createTravelChannel()), []);
  const route = useMemo(() => parseRoute(params.get("flight")), []);
  const duration = Number(params.get("duration") ?? 6500);
  const [flight, setFlight] = useState<GlobeFlight | null>(null);
  useEffect(() => {
    const cycle: Array<ZoneId | null> = [null, "europe", "asia", "americas", "oceania", "africa"];
    if (params.get("cycle") !== "1") { setZone((params.get("zone") as ZoneId | null) ?? null); return; }
    let i = 0;
    const timer = window.setInterval(() => { i = (i + 1) % cycle.length; setZone(cycle[i]!); }, 3000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!route) return;
    let n = 0;
    const launch = () => {
      n++;
      setFlight({ key: `f${n}`, fromZone: route[0], toZone: route[1], seatColor: PLAYER_COLORS[0]!, startedAt: performance.now() + Number(params.get("delay") ?? 600), durationMs: duration, playerId: "p1" });
    };
    launch();
    if (params.get("loop") !== "1") return;
    const timer = window.setInterval(launch, duration + 2200);
    return () => window.clearInterval(timer);
  }, [route, duration]);
  const reduced = params.get("reduced") === "1";
  const destination = flight?.toZone ?? null;
  const debug = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (params.get("debug") !== "1" || !channel) return;
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); if (debug.current) debug.current.textContent = `u ${channel.frame.raw.toFixed(3)} · close ${channel.frame.close.toFixed(2)}`; };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [channel]);
  return (
    <>
    {params.get("debug") === "1" && <div ref={debug} style={{ position: "fixed", left: 12, top: 10, zIndex: 2, font: "600 15px Inter, system-ui, sans-serif", color: "#e9dcc0", textShadow: "0 1px 2px #000" }} />}
    <Canvas dpr={[1, 2]} shadows gl={{ antialias: true }} camera={{ fov: 32, position: [0, 2.6, 8.6] }} style={{ position: "fixed", inset: 0, background: STAGE_BACKGROUND }}
      onCreated={({ camera, gl }) => { camera.lookAt(0, 0, 0); gl.toneMapping = THREE.ACESFilmicToneMapping; }}>
      <StudioLights intensity={0.8} />
      <directionalLight position={[-3, 6, 4]} intensity={0.6} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <ArmillaryGlobe
        reducedMotion={reduced}
        quality={quality}
        zoneGrades={{ americas: "B", europe: "A", asia: "C", africa: "D", oceania: "E" }}
        focusZone={route ? destination : zone}
        activeZone={route ? route[0] : "europe"}
        highlightZone={(params.get("highlight") as ZoneId | null) ?? null}
        labels
        markers={[
          { playerId: "p1", zoneId: route ? route[1] : "europe", seatColor: PLAYER_COLORS[0]!, pawn: "lion", active: true, jailed: false },
          { playerId: "p2", zoneId: "europe", seatColor: PLAYER_COLORS[1]!, pawn: "bull", active: false, jailed: false },
          { playerId: "p3", zoneId: "asia", seatColor: PLAYER_COLORS[2]!, pawn: "globe", active: false, jailed: false },
          { playerId: "p4", zoneId: "americas", seatColor: PLAYER_COLORS[3]!, pawn: "crystal", active: false, jailed: true },
        ]}
        flight={flight}
        preview={params.get("preview") === "1" ? { fromZone: route?.[0] ?? "europe", toZone: route?.[1] ?? "americas" } : null}
        impact={params.get("impact") === "1" ? { zoneId: "africa", direction: "down", key: "i1" } : null}
        cinematic={channel}
      />
      {channel && <StudioFlightCamera channel={channel} />}
      <PortraitCaptureFlag />
    </Canvas>
    </>
  );
}

// ----------------------------------------------------------------- plane --
function PlaneScene() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  useEffect(() => { camera.position.set(0, 0.25, 5.2); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); }, [camera]);
  const throttle = Number(params.get("throttle") ?? 1);
  return (
    <>
      <StudioLights />
      <Airplane quality={quality} throttle={throttle} seatColor={PLAYER_COLORS[0]} position={[-1.05, 0.62, 0]} rotation={[0.42, 0.72, 0.08]} />
      <Airplane quality={quality} throttle={throttle} seatColor={PLAYER_COLORS[1]} position={[1.05, 0.62, 0]} rotation={[1.25, 0, 0]} />
      <Airplane quality={quality} throttle={0} seatColor={PLAYER_COLORS[2]} position={[-1.05, -0.62, 0]} rotation={[0.05, Math.PI / 2, 0]} />
      <Airplane quality={quality} throttle={throttle} seatColor={PLAYER_COLORS[3]} position={[1.05, -0.62, 0]} rotation={[0.5, -2.5, -0.35]} />
    </>
  );
}

function Plane() {
  return (
    <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ fov: 30 }} style={{ position: "fixed", inset: 0, background: STAGE_BACKGROUND }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; }}>
      <PlaneScene />
      <PortraitCaptureFlag after={30} />
    </Canvas>
  );
}

// ------------------------------------------------------------------ hero --
function HeroReview() {
  const variant = (params.get("variant") as "menu" | "setup" | "lobby" | null) ?? "menu";
  const [current, setCurrent] = useState(variant);
  const [focus, setFocus] = useState<PawnId | null>((params.get("focus") as PawnId | null) ?? "bull");
  useEffect(() => {
    window.__pawnStudio = { ready: false, frames: 0, capture: () => "" };
    const timer = window.setTimeout(() => { if (window.__pawnStudio) window.__pawnStudio.ready = true; }, Number(params.get("wait") ?? 3500));
    if (params.get("cycle") !== "1") return () => window.clearTimeout(timer);
    const order: Array<"menu" | "setup" | "lobby"> = ["menu", "setup", "lobby"];
    let i = 0;
    const cycle = window.setInterval(() => { i = (i + 1) % 3; setCurrent(order[i]!); setFocus(PAWN_IDS[(i * 2) % 6]!); }, 4000);
    return () => { window.clearTimeout(timer); window.clearInterval(cycle); };
  }, []);
  const pawns = (params.get("pawns")?.split(",") as PawnId[] | undefined) ?? PAWN_IDS;
  return (
    <Suspense fallback={null}>
      <MenuHero variant={current} pawns={pawns} focusPawn={focus} quality={quality} reducedMotion={params.get("reduced") === "1" ? true : params.get("reduced") === "0" ? false : undefined} />
    </Suspense>
  );
}

function Studio() {
  if (mode === "portrait") {
    const piece = (params.get("piece") as PawnId) ?? "lion";
    return <Portrait piece={PAWN_IDS.includes(piece) ? piece : "lion"} size={Number(params.get("size") ?? 1024)} />;
  }
  if (mode === "review") return <Review />;
  if (mode === "globe") return <GlobeReview />;
  if (mode === "plane") return <Plane />;
  if (mode === "hero") return <HeroReview />;
  if (mode === "turn") return <Turn />;
  return <Sheet />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Studio /></StrictMode>);
