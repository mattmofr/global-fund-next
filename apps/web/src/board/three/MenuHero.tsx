/**
 * Full-screen 3D backdrop for the title, setup and lobby screens.
 *
 * Usage (lazy, behind the HTML UI):
 *   const MenuHero = lazy(() => import("../board/three/MenuHero"));
 *   <Suspense fallback={null}><MenuHero variant="menu" /></Suspense>
 * It renders a position:fixed, pointer-events:none, aria-hidden layer (z-index 0).
 *
 * Scene: a black-lacquer plinth with a dark mirror top, the armillary globe on
 * a brass column, the figurines and a little golden dust, under a warm key and
 * a neutral silver rim (warm blacks, no blue cast). Three compositions share one instance and blend smoothly:
 *   menu  — the globe is the hero on the right half, the left stays calm
 *   setup — the configured figurines line up; the chosen one steps forward
 *   lobby — the seated funds' figurines circle a small globe, centred
 * Reduced motion: a static frame rendered on demand. Software WebGL → low tier.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, MeshReflectorMaterial, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { PLAYER_COLORS, type Grade, type PawnId, type ZoneId } from "@global-fund/shared";
import { usePresentationSettings } from "../../presentation/settings";
import { ArmillaryGlobe, GlobeStand } from "./globe";
import { PawnModel, PAWN_IDS, usePiecesReady } from "./pawns";
import { isSoftwareRenderer, pieceMaterial, type ObjectQuality } from "./materials";

export interface MenuHeroProps {
  /** Camera pose / composition: title screen, fund setup, or lobby table. */
  variant: "menu" | "setup" | "lobby";
  /** Figurines to showcase (setup: configured seats; lobby: seated funds). */
  pawns?: PawnId[];
  /** Highlighted figurine (e.g. the piece being chosen). */
  focusPawn?: PawnId | null;
  reducedMotion?: boolean;
  quality?: "high" | "medium" | "low";
  /** Optional: market to present on the globe (turns to it and shows its label). */
  focusZone?: ZoneId | null;
  /** Optional: grades shown on the globe labels (default: C everywhere, the opening grade). */
  zoneGrades?: Partial<Record<ZoneId, Grade>>;
}

type Variant = MenuHeroProps["variant"];

const BACKDROP = { inner: "#2a241d", mid: "#120f0c", outer: "#070605" };
const CSS_BACKDROP = `radial-gradient(85% 75% at 68% 42%, ${BACKDROP.inner} 0%, ${BACKDROP.mid} 46%, ${BACKDROP.outer} 100%)`;
const PLINTH_RADIUS = 3.15;
const GLOBE_HEIGHT = 1.92;
const OPENING_GRADES: Record<ZoneId, Grade> = { americas: "C", europe: "C", asia: "C", africa: "C", oceania: "C" };

/** One throwaway context tells us, before the real canvas exists, whether WebGL is software. */
let softwareProbe: boolean | null = null;
function probeSoftware() {
  if (softwareProbe !== null) return softwareProbe;
  softwareProbe = false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    softwareProbe = isSoftwareRenderer(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { /* keep the default tier */ }
  return softwareProbe;
}

// ------------------------------------------------------------------ poses --
interface Pose { tx: number; ty: number; tz: number; az: number; el: number; dist: number; fov: number; shift: number }
const POSES: Record<Variant, Pose> = {
  menu: { tx: 0.1, ty: 2.0, tz: -0.2, az: -0.36, el: 0.16, dist: 11.4, fov: 30, shift: 0.235 },
  setup: { tx: 0.1, ty: 1.05, tz: 0.35, az: -0.2, el: 0.19, dist: 10.2, fov: 30, shift: 0.235 },
  lobby: { tx: 0, ty: 0.42, tz: 0.15, az: -0.12, el: 0.56, dist: 10.8, fov: 30, shift: 0 },
};

/** Globe assembly (unit globe on its column), per composition. */
const GLOBE_POSES: Record<Variant, { x: number; z: number; scale: number }> = {
  menu: { x: 0.15, z: -0.5, scale: 1.3 },
  setup: { x: 0.7, z: -1.95, scale: 1.02 },
  lobby: { x: 0, z: 0, scale: 0.5 },
};

function responsive(pose: Pose, aspect: number): Pose {
  if (aspect >= 1.15) return pose;
  // Portrait / tablet: centre the subject and step back.
  return { ...pose, shift: 0, dist: pose.dist * (aspect < 0.8 ? 1.6 : 1.25), ty: pose.ty + 0.25 };
}

function CameraRig({ variant, still }: { variant: Variant; still: boolean }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const current = useRef<Pose | null>(null);
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  useEffect(() => {
    if (still) return;
    const move = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      pointer.current.y = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [still]);
  useEffect(() => { invalidate(); }, [variant, size.width, size.height, invalidate]);

  useFrame((state, delta) => {
    const target = responsive(POSES[variant], size.width / Math.max(1, size.height));
    const dt = Math.min(delta, 0.1);
    if (!current.current || still) current.current = { ...target };
    else {
      const k = 1 - Math.exp(-dt * 2.1);
      const p = current.current;
      (Object.keys(target) as Array<keyof Pose>).forEach((key) => { p[key] += (target[key] - p[key]) * k; });
    }
    const p = current.current;
    const t = state.clock.elapsedTime;
    const ptr = pointer.current;
    if (!still) {
      const k = 1 - Math.exp(-dt * 1.5);
      ptr.sx += (ptr.x - ptr.sx) * k;
      ptr.sy += (ptr.y - ptr.sy) * k;
    }
    const drift = still ? 0 : 1;
    const az = p.az + drift * (Math.sin(t * 0.07) * 0.045 + ptr.sx * 0.028);
    const el = p.el + drift * (Math.sin(t * 0.053) * 0.015 - ptr.sy * 0.016);
    const dist = p.dist + drift * Math.sin(t * 0.09) * 0.12;
    camera.position.set(p.tx + Math.sin(az) * Math.cos(el) * dist, p.ty + Math.sin(el) * dist, p.tz + Math.cos(az) * Math.cos(el) * dist);
    camera.lookAt(p.tx, p.ty, p.tz);
    camera.fov = p.fov;
    camera.near = 0.1;
    camera.far = 80;
    camera.aspect = size.width / Math.max(1, size.height);
    // Lens shift: keep verticals straight while composing off-centre.
    camera.filmOffset = -p.shift * camera.aspect * 2 * Math.tan(THREE.MathUtils.degToRad(p.fov / 2)) * camera.getFilmWidth();
    camera.updateProjectionMatrix();
  });
  return null;
}

// ------------------------------------------------------------- backdrop --
/** Opaque in-scene gradient: bloom has something to spread on and gems something to refract. */
function Backdrop() {
  const size = useThree((state) => state.size);
  const material = useMemo(() => new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    uniforms: {
      uAspect: { value: 1 },
      uCenter: { value: new THREE.Vector2(0.68, 0.58) },
      uInner: { value: new THREE.Color(BACKDROP.inner) },
      uMid: { value: new THREE.Color(BACKDROP.mid) },
      uOuter: { value: new THREE.Color(BACKDROP.outer) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uAspect;
      uniform vec2 uCenter;
      uniform vec3 uInner;
      uniform vec3 uMid;
      uniform vec3 uOuter;
      varying vec2 vUv;
      void main() {
        vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
        float r = length(d) / 1.15;
        vec3 col = mix(uInner, uMid, smoothstep(0.0, 0.5, r));
        col = mix(col, uOuter, smoothstep(0.42, 1.1, r));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  material.uniforms.uAspect!.value = size.width / Math.max(1, size.height);
  return (
    <mesh frustumCulled={false} renderOrder={-1000} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

// --------------------------------------------------------------- plinth --
function Plinth({ quality }: { quality: ObjectQuality }) {
  const brass = pieceMaterial("brass", quality);
  const lacquer = pieceMaterial("lacquer", quality);
  const segments = quality === "low" ? 72 : 180;
  const parts = useMemo(() => {
    const r = PLINTH_RADIUS;
    const edge = new THREE.LatheGeometry(
      [[r - 0.02, 0.0], [r, -0.012], [r + 0.012, -0.06], [r + 0.01, -0.22], [r - 0.02, -0.34], [r - 0.3, -0.42], [0, -0.42]].map(([x, y]) => new THREE.Vector2(x!, y!)),
      segments,
    );
    const rim = new THREE.TorusGeometry(r, 0.026, 12, segments).rotateX(Math.PI / 2);
    const inlay = new THREE.TorusGeometry(r * 0.84, 0.007, 8, segments).rotateX(Math.PI / 2).translate(0, 0.003, 0);
    const inlay2 = new THREE.TorusGeometry(r * 0.81, 0.004, 8, segments).rotateX(Math.PI / 2).translate(0, 0.003, 0);
    const top = new THREE.CircleGeometry(r, segments).rotateX(-Math.PI / 2);
    return { edge, rim, inlay, inlay2, top };
  }, [segments]);
  useEffect(() => () => Object.values(parts).forEach((geometry) => geometry.dispose()), [parts]);
  return (
    <group>
      <mesh geometry={parts.edge} material={lacquer} receiveShadow />
      <mesh geometry={parts.rim} material={brass} />
      <mesh geometry={parts.inlay} material={brass} />
      <mesh geometry={parts.inlay2} material={brass} />
      <mesh geometry={parts.top} receiveShadow>
        {quality === "high" ? (
          <MeshReflectorMaterial
            blur={[300, 90]}
            resolution={1024}
            mixBlur={0.9}
            mixStrength={4.2}
            mixContrast={1.1}
            roughness={0.62}
            depthScale={1.15}
            minDepthThreshold={0.3}
            maxDepthThreshold={1.4}
            color="#090807"
            metalness={0.6}
            mirror={0.86}
          />
        ) : (
          <meshPhysicalMaterial color="#070605" roughness={0.14} metalness={0.45} clearcoat={quality === "medium" ? 1 : 0} clearcoatRoughness={0.05} />
        )}
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------ figurines --
interface Slot { x: number; z: number; yaw: number; scale: number }

function layout(variant: Variant, count: number, focusIndex: number): Slot[] {
  const slots: Slot[] = [];
  const toward = (x: number, z: number, az: number, bias: number) => {
    // Face a blend of the camera direction and the table centre.
    const cx = Math.sin(az), cz = Math.cos(az);
    const len = Math.hypot(x, z) || 1;
    const dx = cx * (1 - bias) - (x / len) * bias, dz = cz * (1 - bias) - (z / len) * bias;
    return Math.atan2(dx, dz);
  };
  for (let i = 0; i < count; i++) {
    if (variant === "menu") {
      const span = 1.7;
      const phi = count === 1 ? 0 : -span / 2 + (span * i) / (count - 1);
      const radius = 2.08;
      const x = Math.sin(phi) * radius - 0.05, z = Math.cos(phi) * radius * 0.94 + 0.1;
      slots.push({ x, z, yaw: toward(x, z, POSES.menu.az, 0.15), scale: 0.86 });
    } else if (variant === "setup") {
      // A gentle arc, centred behind the line so the ends curve away.
      const spacing = 0.76;
      const width = (count - 1) * spacing;
      const s = -width / 2 + i * spacing;
      const arc = 3.2;
      const phi = s / arc;
      const focused = i === focusIndex;
      const x = Math.sin(phi) * arc + 0.25;
      const z = Math.cos(phi) * arc - arc + 1.3 + (focused ? 0.62 : 0);
      slots.push({ x, z, yaw: toward(x, z, POSES.setup.az, 0.05), scale: focused ? 1.06 : 0.94 });
    } else {
      const phi = (i / Math.max(1, count)) * Math.PI * 2 + Math.PI * 0.12;
      const radius = 1.38;
      const x = Math.sin(phi) * radius, z = Math.cos(phi) * radius;
      slots.push({ x, z, yaw: toward(x, z, POSES.lobby.az, 0.35), scale: i === focusIndex ? 0.98 : 0.9 });
    }
  }
  return slots;
}

function Figure({ piece, slot, seatColor, active, quality, still, turnKey }: {
  piece: PawnId; slot: Slot; seatColor?: string; active: boolean; quality: ObjectQuality; still: boolean; turnKey: number;
}) {
  const group = useRef<THREE.Group>(null);
  const state = useRef({ x: slot.x, z: slot.z, yaw: slot.yaw, scale: 0, spin: 0, turn: turnKey });
  useFrame((frame, delta) => {
    const g = group.current;
    if (!g) return;
    const s = state.current;
    const dt = Math.min(delta, 0.1);
    if (s.turn !== turnKey) { s.turn = turnKey; if (!still) s.spin -= Math.PI * 2; }
    if (still) { s.x = slot.x; s.z = slot.z; s.yaw = slot.yaw; s.scale = slot.scale; s.spin = 0; }
    else {
      const k = 1 - Math.exp(-dt * 3.2);
      s.x += (slot.x - s.x) * k;
      s.z += (slot.z - s.z) * k;
      s.yaw += (slot.yaw - s.yaw) * k;
      s.scale += (slot.scale - s.scale) * (1 - Math.exp(-dt * 4));
      s.spin += (0 - s.spin) * (1 - Math.exp(-dt * 2.2));
    }
    const sway = still || !active ? 0 : Math.sin(frame.clock.elapsedTime * 0.8) * 0.12;
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.yaw + s.spin + sway;
    g.scale.setScalar(Math.max(0.0001, s.scale));
  });
  return (
    <group ref={group} scale={0.0001}>
      <PawnModel piece={piece} seatColor={seatColor} active={active} quality={quality} reducedMotion={still} />
    </group>
  );
}

function Figurines({ variant, pawns, focusPawn, quality, still }: { variant: Variant; pawns: PawnId[]; focusPawn: PawnId | null; quality: ObjectQuality; still: boolean }) {
  const ready = usePiecesReady(pawns, quality);
  const focusIndex = focusPawn ? pawns.indexOf(focusPawn) : -1;
  const slots = layout(variant, pawns.length, focusIndex);
  const turns = useRef(0);
  const lastFocus = useRef(focusPawn);
  if (lastFocus.current !== focusPawn) { lastFocus.current = focusPawn; turns.current += 1; }
  return (
    <group>
      {pawns.map((piece, index) => ready(piece) && (
        <Figure
          key={`${piece}-${index}`}
          piece={piece}
          slot={slots[index]!}
          seatColor={variant === "menu" ? undefined : PLAYER_COLORS[index % PLAYER_COLORS.length]}
          active={index === focusIndex}
          quality={quality}
          still={still}
          turnKey={index === focusIndex && variant === "setup" ? turns.current : 0}
        />
      ))}
    </group>
  );
}

// ----------------------------------------------------------------- globe --
function GlobeAssembly({ variant, quality, still, focusZone, zoneGrades, onReady }: {
  variant: Variant; quality: ObjectQuality; still: boolean; focusZone: ZoneId | null; zoneGrades: Record<string, Grade>; onReady: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const current = useRef<{ x: number; z: number; scale: number } | null>(null);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const target = GLOBE_POSES[variant];
    if (!current.current || still) current.current = { ...target };
    else {
      const k = 1 - Math.exp(-Math.min(delta, 0.1) * 2.1);
      const c = current.current;
      c.x += (target.x - c.x) * k;
      c.z += (target.z - c.z) * k;
      c.scale += (target.scale - c.scale) * k;
    }
    g.position.set(current.current.x, 0, current.current.z);
    g.scale.setScalar(current.current.scale);
  });
  return (
    <group ref={group}>
      <GlobeStand radius={1} height={GLOBE_HEIGHT} quality={quality} position={[0, GLOBE_HEIGHT, 0]} />
      <ArmillaryGlobe
        radius={1}
        position={[0, GLOBE_HEIGHT, 0]}
        zoneGrades={zoneGrades}
        markers={[]}
        focusZone={focusZone}
        activeZone={focusZone}
        labels={!!focusZone}
        reducedMotion={still}
        quality={quality}
        onReady={onReady}
      />
    </group>
  );
}

// ---------------------------------------------------------------- lights --
function Lights({ quality }: { quality: ObjectQuality }) {
  const key = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => { if (key.current) key.current.target = target; }, [target]);
  const shadows = quality !== "low";
  return (
    <>
      <primitive object={target} position={[0.2, 0.8, 0.2]} />
      <hemisphereLight args={["#3d352c", "#0b0806", 0.5]} />
      <spotLight
        ref={key}
        position={[-5.5, 9.5, 6]}
        angle={0.45}
        penumbra={0.9}
        intensity={280}
        distance={0}
        decay={2}
        color="#ffdcae"
        castShadow={shadows}
        shadow-mapSize={[quality === "high" ? 2048 : 1024, quality === "high" ? 2048 : 1024]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        shadow-radius={6}
      />
      <directionalLight position={[6, 4.5, -6]} intensity={2.4} color="#f1eee8" />
      <directionalLight position={[-6.5, 2, -4]} intensity={0.7} color="#dccbb0" />
      <directionalLight position={[0.5, 1.2, 7]} intensity={0.35} color="#ffe2bd" />
      <Environment resolution={quality === "low" ? 64 : 256} frames={1}>
        <Lightformer form="circle" intensity={1.7} color="#ffe2bd" position={[-4.5, 6, 4]} scale={3.2} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={3.2} color="#f3f0ea" position={[5.5, 2.5, -4]} scale={[0.7, 6, 1]} target={[0, 1, 0]} />
        <Lightformer form="ring" intensity={1.4} color="#fff1da" position={[0, 7.5, 1]} scale={3.5} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.9} color="#ffffff" position={[-6.5, 1.5, -1]} scale={[0.45, 5, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={0.45} color="#c08a45" position={[0, -2, 3]} scale={[10, 2, 1]} target={[0, 1, 0]} />
      </Environment>
    </>
  );
}

function Effects({ quality }: { quality: ObjectQuality }) {
  if (quality === "low") return null;
  return (
    <EffectComposer multisampling={quality === "high" ? 4 : 2} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={quality === "high" ? 0.75 : 0.55} luminanceThreshold={0.82} luminanceSmoothing={0.22} radius={0.72} />
      <Vignette offset={0.28} darkness={0.62} eskil={false} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

/** Marks the first frame after the globe textures land (fade-in + data-ready). */
function FirstFrame({ armed, onFrame }: { armed: boolean; onFrame: () => void }) {
  const done = useRef(false);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => { if (armed) invalidate(); }, [armed, invalidate]);
  useFrame(() => {
    if (armed && !done.current) { done.current = true; requestAnimationFrame(onFrame); }
  });
  return null;
}

function HeroScene({ variant, pawns, focusPawn, quality, still, focusZone, zoneGrades, onShown }: {
  variant: Variant; pawns: PawnId[]; focusPawn: PawnId | null; quality: ObjectQuality; still: boolean;
  focusZone: ZoneId | null; zoneGrades: Record<string, Grade>; onShown: () => void;
}) {
  const [globeReady, setGlobeReady] = useState(false);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => { invalidate(); }, [variant, pawns, focusPawn, quality, still, focusZone, zoneGrades, invalidate]);
  return (
    <>
      <Backdrop />
      <CameraRig variant={variant} still={still} />
      <Lights quality={quality} />
      <Plinth quality={quality} />
      <GlobeAssembly variant={variant} quality={quality} still={still} focusZone={focusZone} zoneGrades={zoneGrades} onReady={() => setGlobeReady(true)} />
      <Figurines variant={variant} pawns={pawns} focusPawn={focusPawn} quality={quality} still={still} />
      <Sparkles count={quality === "high" ? 90 : quality === "medium" ? 60 : 28} scale={[9, 5.5, 7]} position={[0.3, 2.4, -0.4]} size={2.4} speed={0.22} opacity={0.55} color="#f2d398" noise={0.6} />
      <Effects quality={quality} />
      <FirstFrame armed={globeReady} onFrame={onShown} />
    </>
  );
}

export default function MenuHero({ variant, pawns, focusPawn = null, reducedMotion, quality, focusZone = null, zoneGrades }: MenuHeroProps) {
  const settings = usePresentationSettings();
  const still = reducedMotion ?? settings.reducedMotion;
  const [software] = useState(probeSoftware);
  const tier: ObjectQuality = software ? "low" : quality ?? settings.quality;
  const cast = pawns && pawns.length ? pawns : PAWN_IDS;
  const grades = useMemo(() => ({ ...OPENING_GRADES, ...zoneGrades }), [zoneGrades]);
  const [shown, setShown] = useState(false);
  const dpr: number | [number, number] = software ? 0.75 : tier === "high" ? [1, 1.75] : tier === "medium" ? [1, 1.25] : 0.85;
  return (
    <div
      className={`menu-hero menu-hero--${variant}`}
      aria-hidden="true"
      data-ready={shown ? "true" : "false"}
      data-quality={tier}
      style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: CSS_BACKDROP, overflow: "hidden" }}
    >
      <Canvas
        dpr={dpr}
        frameloop={still || software ? "demand" : "always"}
        shadows={tier !== "low" ? "soft" : false}
        gl={{ alpha: true, antialias: tier === "low" && !software, powerPreference: "high-performance", stencil: false }}
        camera={{ fov: 30, near: 0.1, far: 80, position: [0, 2.4, 10.5] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1;
        }}
        style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: shown ? 1 : 0, transition: still ? "none" : "opacity 900ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        <Suspense fallback={null}>
          <HeroScene
            variant={variant}
            pawns={cast}
            focusPawn={focusPawn}
            quality={tier}
            still={still || software}
            focusZone={focusZone}
            zoneGrades={grades}
            onShown={() => setShown(true)}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
