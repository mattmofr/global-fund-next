/**
 * The physical board: leather table, black-lacquer slab, bevelled brass frame,
 * inlaid gold fillets, 52 raised enamel plaques and the engraved centre panel
 * (compass rose, card slots, dice tray, brand, pedestal).
 * The plaques' per-cell effect texture drives the landing light-up, the
 * arrival flash and the HUD sector highlight (see surfaces.withCellFx).
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cellAccent, cellArt, type BoardAtlas } from "./atlas";
import { CARD, CELL_COUNT, CENTRE, FRAME_TOP, INNER_HALF, SLAB_H, TRACK_HALF, BOARD_SIZE } from "./layout";
import { FX_EDGE, FX_INLAY, FX_ROWS, FX_WASH, TABLE_RADIUS, cellFxTexture, decalGeometry, feltTexture, marbleTexture, plaqueGeometry, tableTexture, withCellFx } from "./surfaces";
import { useRuntime, clamp01, dampFactor, envelope } from "./runtime";

/** Dispose GPU objects created in a memo when they are replaced or unmounted. */
export function useDisposable<T extends { dispose: () => void }>(factory: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(factory, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

export interface BoardMaterials {
  gold: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  lacquer: THREE.MeshStandardMaterial;
  marble: THREE.MeshStandardMaterial;
}

export function useBoardMaterials(physical: boolean): BoardMaterials {
  const marbleMap = useDisposable(() => marbleTexture(), []);
  const set = useMemo(() => {
    const make = (params: THREE.MeshPhysicalMaterialParameters) => {
      if (physical) return new THREE.MeshPhysicalMaterial(params);
      const { clearcoat, clearcoatRoughness, ...rest } = params;
      void clearcoat; void clearcoatRoughness;
      return new THREE.MeshStandardMaterial(rest);
    };
    return {
      gold: make({ color: "#e9c27a", metalness: 1, roughness: 0.26, envMapIntensity: 1.25 }),
      brass: make({ color: "#c79f5c", metalness: 1, roughness: 0.34, envMapIntensity: 1.15 }),
      lacquer: make({ color: "#070606", metalness: 0, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.045, envMapIntensity: 1.1 }),
      marble: make({ color: "#ffffff", map: marbleMap, metalness: 0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9 }),
    };
  }, [physical, marbleMap]);
  useEffect(() => () => Object.values(set).forEach((m) => m.dispose()), [set]);
  return set;
}

// ------------------------------------------------------------------ table --
export function Table({ size }: { size: number }) {
  const map = useDisposable(() => tableTexture(size), [size]);
  const material = useDisposable(() => new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.78, metalness: 0, envMapIntensity: 0.35 }), [map]);
  const geometry = useDisposable(() => new THREE.CircleGeometry(TABLE_RADIUS, 128).rotateX(-Math.PI / 2), []);
  return <mesh geometry={geometry} material={material} position={[0, -0.004, 0]} receiveShadow renderOrder={-1} />;
}

// ---------------------------------------------------------- lacquer mirror --
/**
 * High tier: a blurred planar reflection of the globe, pedestal and decks, added
 * on top of the clearcoat lacquer (whose studio sheen stays intact).
 */
export function LacquerMirror() {
  const size = (INNER_HALF - 0.3) * 2;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, SLAB_H + 0.0008, 0]} renderOrder={1}>
      <planeGeometry args={[size, size]} />
      <MeshReflectorMaterial
        resolution={1024}
        blur={[320, 110]}
        mixBlur={0.7}
        mixStrength={16}
        mixContrast={1}
        mirror={1}
        depthScale={1.1}
        minDepthThreshold={0.35}
        maxDepthThreshold={1.3}
        color="#201e1c"
        metalness={0}
        roughness={1}
        envMapIntensity={0}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ------------------------------------------------------------ slab/frame --
export function Slab({ materials }: { materials: BoardMaterials }) {
  const geometry = useDisposable(() => new THREE.BoxGeometry(TRACK_HALF * 2 + 0.02, SLAB_H, TRACK_HALF * 2 + 0.02), []);
  return <mesh geometry={geometry} material={materials.lacquer} position={[0, SLAB_H / 2, 0]} receiveShadow castShadow />;
}

export function Frame({ materials }: { materials: BoardMaterials }) {
  const geometry = useDisposable(() => {
    const bevel = 0.04;
    const half = BOARD_SIZE / 2 - bevel;
    const radius = 0.2;
    const shape = new THREE.Shape();
    shape.moveTo(-half + radius, -half);
    shape.lineTo(half - radius, -half);
    shape.quadraticCurveTo(half, -half, half, -half + radius);
    shape.lineTo(half, half - radius);
    shape.quadraticCurveTo(half, half, half - radius, half);
    shape.lineTo(-half + radius, half);
    shape.quadraticCurveTo(-half, half, -half, half - radius);
    shape.lineTo(-half, -half + radius);
    shape.quadraticCurveTo(-half, -half, -half + radius, -half);
    const hole = new THREE.Path();
    const inner = TRACK_HALF + bevel * 0.6;
    hole.moveTo(-inner, -inner);
    hole.lineTo(-inner, inner);
    hole.lineTo(inner, inner);
    hole.lineTo(inner, -inner);
    hole.lineTo(-inner, -inner);
    shape.holes.push(hole);
    const extruded = new THREE.ExtrudeGeometry(shape, { depth: FRAME_TOP - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 6 });
    extruded.rotateX(-Math.PI / 2);
    extruded.translate(0, bevel, 0);
    return extruded;
  }, []);
  return <mesh geometry={geometry} material={materials.brass} castShadow receiveShadow />;
}

/** Double gold fillet around the centre panel, inlaid flush with the lacquer. */
export function Fillets({ materials }: { materials: BoardMaterials }) {
  const geometry = useDisposable(() => {
    const parts: THREE.BufferGeometry[] = [];
    const strip = (half: number, width: number) => {
      for (const [x, z, w, d] of [[0, -half, half * 2 + width, width], [0, half, half * 2 + width, width], [-half, 0, width, half * 2 + width], [half, 0, width, half * 2 + width]] as const) {
        parts.push(new THREE.BoxGeometry(w, 0.012, d).translate(x, SLAB_H + 0.004, z));
      }
    };
    strip(INNER_HALF - 0.1, 0.035);
    strip(INNER_HALF - 0.24, 0.016);
    const merged = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return merged;
  }, []);
  return <mesh geometry={geometry} material={materials.gold} receiveShadow />;
}

// ---------------------------------------------------------------- plaques --
const GOLD_GLOW = new THREE.Color("#ffd58a");
const IMPACT_UP = new THREE.Color("#3cf0a8");
const IMPACT_DOWN = new THREE.Color("#ff4d63");
const CRASH_FLASH = new THREE.Color("#ff2a40");
/** Stages during which the landed cell keeps its gold inlay lit. */
const LIT_STAGES = new Set(["PAWN_ARRIVAL", "SPACE_REVEAL", "CARD_READING"]);
/** HUD sector hover: pulse period (s). */
const HIGHLIGHT_PERIOD = 1.2;

/** Adds glow to one cell of an effect-texture row (values × CELL_FX_SCALE). */
function addFx(v: Float32Array, row: number, i: number, c: THREE.Color, k: number) {
  const o = (row * CELL_COUNT + i) * 4;
  v[o] += c.r * k; v[o + 1] += c.g * k; v[o + 2] += c.b * k;
}
/** Darkens a cell (the strongest request wins). */
function darkenFx(v: Float32Array, i: number, a: number) {
  const o = (FX_WASH * CELL_COUNT + i) * 4 + 3;
  if (a > v[o]!) v[o] = a;
}

export function Plaques({ atlas, color, mask, physical }: { atlas: BoardAtlas; color: THREE.Texture; mask: THREE.Texture | null; physical: boolean }) {
  const runtime = useRuntime();
  const geometry = useDisposable(() => plaqueGeometry(atlas), [atlas]);
  const fx = useDisposable(() => cellFxTexture(), []);
  const material = useDisposable(() => {
    const params: THREE.MeshPhysicalMaterialParameters = {
      map: color,
      metalness: mask ? 1 : 0.18,
      roughness: mask ? 0.62 : 0.42,
      metalnessMap: mask ?? null,
      roughnessMap: mask ?? null,
      bumpMap: mask ?? null,
      bumpScale: 1.1,
      envMapIntensity: 1.05,
    };
    const m = physical
      ? new THREE.MeshPhysicalMaterial({ ...params, clearcoat: 0.55, clearcoatRoughness: 0.16 })
      : new THREE.MeshStandardMaterial(params);
    return withCellFx(m, fx);
  }, [color, mask, physical, fx]);

  // The board layout never changes during a game.
  const cells = useMemo(() => {
    const board = runtime.current.game.board;
    return Array.from({ length: CELL_COUNT }, (_, i) => {
      const art = cellArt(board[i]);
      const accent = new THREE.Color(cellAccent(art));
      // Hover glow: the sector colour, lifted a little towards white so dark hues still read.
      const glow = accent.clone().lerp(new THREE.Color("#ffffff"), 0.18);
      return { kind: art.kind, sector: board[i]?.sector ?? null, accent, glow };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas]);
  const state = useRef({
    values: new Float32Array(CELL_COUNT * FX_ROWS * 4),
    highlight: new Float32Array(CELL_COUNT),
    focus: 0,
    lit: 0,
    litCell: -1,
    last: performance.now(),
  });

  useFrame(() => {
    const rt = runtime.current;
    const st = state.current;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - st.last) / 1000));
    st.last = now;
    const v = st.values;
    v.fill(0);
    const active = rt.game.players.find((p) => p.id === rt.activeId);
    const moving = rt.stage === "PAWN_MOVING" && !rt.reduced;
    const breathe = rt.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 900);
    if (active && !moving) {
      // The active fund's cell breathes a gold outline (its enamel stays dark and legible).
      const cell = ((active.sectorPosition % 52) + 52) % 52;
      addFx(v, FX_EDGE, cell, GOLD_GLOW, 0.07 + breathe * 0.05);
      addFx(v, FX_WASH, cell, GOLD_GLOW, 0.01);
    }
    if (rt.hovered != null) addFx(v, FX_WASH, rt.hovered, GOLD_GLOW, 0.14);

    // Landed cell: its gold inlay brightens and stays lit while the card is read.
    const litTarget = rt.timeline && LIT_STAGES.has(rt.stage ?? "") ? 1 : 0;
    if (litTarget) st.litCell = ((Math.round(rt.timeline!.toPosition) % 52) + 52) % 52;
    st.lit = rt.reduced ? litTarget : st.lit + (litTarget - st.lit) * dampFactor(litTarget ? 3.2 : 5, dt);
    if (st.litCell >= 0 && st.lit > 0.002) {
      addFx(v, FX_INLAY, st.litCell, GOLD_GLOW, 0.08 * st.lit);
      addFx(v, FX_EDGE, st.litCell, GOLD_GLOW, 0.05 * st.lit);
    }

    // Arrival: a flash of the cell's colour on its outline, inlay and enamel.
    if (rt.arrival && !rt.reduced) {
      const t = (now - rt.arrival.at) / 1000;
      if (t >= 0 && t < 2) {
        const c = cells[rt.arrival.cell]!;
        addFx(v, FX_EDGE, rt.arrival.cell, c.glow, 0.2 * envelope(t, 0, 0.05, 0.25, 1.3));
        addFx(v, FX_INLAY, rt.arrival.cell, c.glow, 0.13 * envelope(t, 0, 0.08, 0.45, 1.5));
        addFx(v, FX_WASH, rt.arrival.cell, c.accent, 0.03 * Math.pow(1 - clamp01(t / 0.8), 2));
        if (rt.arrival.theme === "crash") {
          // The whole board takes the shock: a brief red flash over every plaque.
          const flash = 0.15 * envelope(t, 0, 0.04, 0.06, 0.55);
          for (let i = 0; i < CELL_COUNT; i++) addFx(v, FX_WASH, i, CRASH_FLASH, flash);
        }
      }
    }
    if (rt.impact) {
      const t = (now - rt.impact.at) / 1000;
      const pulse = rt.reduced ? 0.55 : 0.4 + 0.6 * Math.abs(Math.sin(t * Math.PI * 1.6));
      const tint = rt.impact.up ? IMPACT_UP : IMPACT_DOWN;
      for (const i of rt.impact.cells) addFx(v, FX_WASH, i, tint, 0.34 * pulse);
    }
    if (rt.mood) {
      const t = (now - rt.moodAt) / 1000;
      const pulse = rt.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(t * 5);
      for (let i = 0; i < CELL_COUNT; i++) {
        const kind = cells[i]!.kind;
        if (rt.mood === "crash") {
          if (kind === "crash") addFx(v, FX_WASH, i, cells[i]!.accent, 0.16 + 0.14 * pulse);
          else darkenFx(v, i, 0.5);
        } else if (rt.mood === "bull" && kind === "bull") addFx(v, FX_WASH, i, cells[i]!.accent, 0.08 + 0.07 * pulse);
        else if (rt.mood === "bear") {
          if (kind === "bear") addFx(v, FX_WASH, i, cells[i]!.accent, 0.05 + 0.04 * pulse);
          else darkenFx(v, i, 0.18);
        }
      }
    }

    // HUD sector hover: every cell of the sector pulses (outline + inlay), the others recede.
    const sector = rt.highlightSector;
    const k = dampFactor(9, dt);
    st.focus = rt.reduced ? (sector ? 1 : 0) : st.focus + ((sector ? 1 : 0) - st.focus) * k;
    const pulse = rt.reduced ? 0.8 : 0.62 + 0.38 * Math.sin((now / 1000) * ((Math.PI * 2) / HIGHLIGHT_PERIOD));
    for (let i = 0; i < CELL_COUNT; i++) {
      const target = sector && cells[i]!.sector === sector ? 1 : 0;
      const h = rt.reduced ? target : st.highlight[i]! + (target - st.highlight[i]!) * k;
      st.highlight[i] = h;
      if (h > 0.002) {
        addFx(v, FX_EDGE, i, cells[i]!.glow, 0.3 * h * pulse);
        addFx(v, FX_INLAY, i, cells[i]!.glow, 0.13 * h * (0.75 + 0.25 * pulse));
        addFx(v, FX_WASH, i, cells[i]!.accent, 0.018 * h * pulse);
      }
      if (st.focus > 0.002) darkenFx(v, i, 0.3 * st.focus * (1 - h));
    }

    const data = fx.image.data as Uint8Array;
    let changed = false;
    for (let i = 0; i < data.length; i++) {
      const next = Math.round(clamp01(v[i]!) * 255);
      if (data[i] !== next) { data[i] = next; changed = true; }
    }
    if (changed) fx.needsUpdate = true;
  });

  return <mesh geometry={geometry} material={material} castShadow receiveShadow />;
}

// ------------------------------------------------------------ centre decor --
function compassGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const ring = (r0: number, r1: number) => parts.push(new THREE.RingGeometry(r0, r1, 160, 1).rotateX(-Math.PI / 2));
  ring(2.5, 2.53);
  ring(2.7, 2.715);
  ring(3.22, 3.245);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const long = i % 6 === 0;
    const r0 = 2.53, r1 = long ? 2.7 : 2.62;
    const tick = new THREE.PlaneGeometry(long ? 0.022 : 0.012, r1 - r0).rotateX(-Math.PI / 2);
    tick.translate(0, 0, -(r0 + r1) / 2);
    tick.rotateY(-a);
    parts.push(tick);
  }
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Faceted compass star (light and dark halves via vertex colours). */
function starGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  const light = new THREE.Color("#fff1cc"), dark = new THREE.Color("#7a5d2c");
  const point = (angle: number, length: number, width: number) => {
    const dx = Math.sin(angle), dz = -Math.cos(angle);
    const px = -dz, pz = dx;
    const tip: [number, number] = [dx * length, dz * length];
    const left: [number, number] = [dx * width + px * width * 0.55, dz * width + pz * width * 0.55];
    const right: [number, number] = [dx * width - px * width * 0.55, dz * width - pz * width * 0.55];
    for (const [a, b, c, col] of [[[0, 0], left, tip, light], [[0, 0], tip, right, dark]] as const) {
      for (const p of [a, b, c]) { positions.push(p[0], 0, p[1]); colors.push(col.r, col.g, col.b); }
    }
  };
  for (let i = 0; i < 4; i++) point((i * Math.PI) / 2, 3.15, 0.36);
  for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, 2.2, 0.24);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function CentreDecor({ atlas, color, mask, materials }: { atlas: BoardAtlas; color: THREE.Texture; mask: THREE.Texture | null; materials: BoardMaterials }) {
  const compass = useDisposable(() => compassGeometry(), []);
  const star = useDisposable(() => starGeometry(), []);
  const starMaterial = useDisposable(() => new THREE.MeshStandardMaterial({ vertexColors: true, color: "#e2bd77", metalness: 1, roughness: 0.3, envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -1 }), []);
  const lineMaterial = useDisposable(() => new THREE.MeshStandardMaterial({ color: "#d9b46d", metalness: 1, roughness: 0.32, envMapIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: -1 }), []);
  const decalMaterial = useDisposable(() => new THREE.MeshStandardMaterial({
    map: color, metalness: mask ? 1 : 0.6, roughness: mask ? 0.62 : 0.35, metalnessMap: mask ?? null, roughnessMap: mask ?? null,
    transparent: true, alphaTest: 0.04, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 1.2,
  }), [color, mask]);
  const brand = useDisposable(() => decalGeometry(atlas, atlas.brand, 4.0, 0.6), [atlas]);
  const contextLabel = useDisposable(() => decalGeometry(atlas, atlas.contextLabel, 1.5, 0.25), [atlas]);
  const eventLabel = useDisposable(() => decalGeometry(atlas, atlas.eventLabel, 1.5, 0.25), [atlas]);
  const slot = useDisposable(() => {
    const w = CARD.w + 0.26, d = CARD.d + 0.26;
    const shape = new THREE.Shape();
    const r = 0.12;
    const outline = (sh: THREE.Shape | THREE.Path, ww: number, dd: number) => {
      sh.moveTo(-ww / 2 + r, -dd / 2);
      sh.lineTo(ww / 2 - r, -dd / 2);
      sh.quadraticCurveTo(ww / 2, -dd / 2, ww / 2, -dd / 2 + r);
      sh.lineTo(ww / 2, dd / 2 - r);
      sh.quadraticCurveTo(ww / 2, dd / 2, ww / 2 - r, dd / 2);
      sh.lineTo(-ww / 2 + r, dd / 2);
      sh.quadraticCurveTo(-ww / 2, dd / 2, -ww / 2, dd / 2 - r);
      sh.lineTo(-ww / 2, -dd / 2 + r);
      sh.quadraticCurveTo(-ww / 2, -dd / 2, -ww / 2 + r, -dd / 2);
    };
    outline(shape, w, d);
    const hole = new THREE.Path();
    outline(hole, w - 0.05, d - 0.05);
    shape.holes.push(hole);
    return new THREE.ShapeGeometry(shape, 8).rotateX(-Math.PI / 2);
  }, []);
  const tray = useDisposable(() => new THREE.CircleGeometry(CENTRE.tray.radius, 96).rotateX(-Math.PI / 2), []);
  const trayRim = useDisposable(() => new THREE.TorusGeometry(CENTRE.tray.radius + 0.02, 0.035, 12, 128).rotateX(-Math.PI / 2), []);
  const feltMap = useDisposable(() => feltTexture(), []);
  const felt = useDisposable(() => new THREE.MeshStandardMaterial({ color: "#ffffff", map: feltMap, roughness: 0.95, metalness: 0, envMapIntensity: 0.4 }), [feltMap]);
  const y = SLAB_H + 0.002;
  const g = CENTRE.globe;
  return (
    <group>
      <group position={[g.x, y, g.z]}>
        <mesh geometry={compass} material={lineMaterial} receiveShadow />
        <mesh geometry={star} material={starMaterial} position={[0, 0.001, 0]} receiveShadow />
      </group>
      <mesh geometry={brand} material={decalMaterial} position={[CENTRE.brand.x, y + 0.002, CENTRE.brand.z]} />
      {([[CENTRE.contextDeck, contextLabel], [CENTRE.eventDeck, eventLabel]] as const).map(([deck, label], i) => (
        <group key={i} position={[deck.x, y, deck.z]} rotation={[0, deck.yaw, 0]}>
          <mesh geometry={slot} material={lineMaterial} />
          <mesh geometry={label} material={decalMaterial} position={[0, 0.002, CARD.d / 2 + 0.36]} />
        </group>
      ))}
      <group position={[CENTRE.tray.x, SLAB_H, CENTRE.tray.z]}>
        <mesh geometry={tray} material={felt} position={[0, 0.006, 0]} receiveShadow />
        <mesh geometry={trayRim} material={materials.brass} position={[0, 0.02, 0]} castShadow receiveShadow />
      </group>
    </group>
  );
}

// --------------------------------------------------------------- pedestal --
export const PEDESTAL_TOP = SLAB_H + 0.62;

export function Pedestal({ materials }: { materials: BoardMaterials }) {
  const parts = useDisposable(() => {
    const plinth = new THREE.CylinderGeometry(1.5, 1.58, 0.16, 96);
    const band = new THREE.CylinderGeometry(1.54, 1.54, 0.035, 96);
    const step = new THREE.CylinderGeometry(1.16, 1.24, 0.1, 96);
    const drum = new THREE.CylinderGeometry(0.86, 0.96, 0.3, 96);
    const cap = new THREE.CylinderGeometry(0.98, 0.9, 0.06, 96);
    const list = [plinth, band, step, drum, cap];
    return { plinth, band, step, drum, cap, dispose: () => list.forEach((p) => p.dispose()) };
  }, []);
  const g = CENTRE.globe;
  const base = SLAB_H;
  return (
    <group position={[g.x, base, g.z]}>
      <mesh geometry={parts.plinth} material={materials.marble} position={[0, 0.08, 0]} castShadow receiveShadow />
      <mesh geometry={parts.band} material={materials.brass} position={[0, 0.16, 0]} castShadow receiveShadow />
      <mesh geometry={parts.step} material={materials.brass} position={[0, 0.21, 0]} castShadow receiveShadow />
      <mesh geometry={parts.drum} material={materials.marble} position={[0, 0.41, 0]} castShadow receiveShadow />
      <mesh geometry={parts.cap} material={materials.brass} position={[0, 0.59, 0]} castShadow receiveShadow />
    </group>
  );
}
