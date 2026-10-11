/**
 * Armillary globe (presentation only): obsidian sphere with gold-engraved
 * coastlines and NASA night lights, a soft warm atmosphere, brass armillary
 * rings, five zone pins with floating labels, fund markers (gems in the seat
 * colour), the travel cinematic and travel previews.
 *
 * The globe is centred on its group origin; `radius` is in world units.
 * Everything is presentation: it reacts to props and never issues commands.
 *
 * Travel: when `flight` is set, a 1930s airliner (airplane.tsx) flies the route
 * following travelCinematic.ts — one pure function of time for the plane, the
 * globe's orientation and the camera. With `cinematic`, that frame is published
 * every frame (this hook runs before the camera rig's), so the camera flies on
 * the same clock. Close-range detail (crisp coastlines, graticule, city sparks,
 * clouds) fades in only while the camera is close; a dark veil hides the table.
 * Reduced motion: the plane waits at the destination, the route is drawn at
 * once and nothing moves.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Grade, PawnId, ZoneId } from "@global-fund/shared";
import { GRADE_META, ZONE_META } from "../../ui/theme";
import { OBJECT_PALETTE, loadLandRings, pieceMaterial, radialGlowTexture, traceLand } from "./materials";
import { AIRPLANE, airplaneEnvironment, createAirplane, type AirplaneRig } from "./airplane";
import {
  PLANE_SCALE, TRAVEL_BEATS, captureFlightStart, createFlightFrame, createFlightStart, flightPose, planFlight, routePoint,
  type FlightFrame, type FlightPlan, type TravelChannel,
} from "./travelCinematic";

export interface GlobeMarker {
  playerId: string;
  zoneId: ZoneId;
  seatColor: string;
  pawn: PawnId;
  active: boolean;
  jailed: boolean;
}

export interface GlobeFlight {
  /** Stable key (notice id) so the flight replays once per travel. */
  key: string | number;
  fromZone: ZoneId;
  toZone: ZoneId;
  seatColor: string;
  /** performance.now() epoch and duration of the visible flight. */
  startedAt: number;
  durationMs: number;
  /** Optional: the travelling fund; its gem waits hidden and pops in when the plane lands. */
  playerId?: string;
}

export interface GlobeProps {
  radius?: number;
  zoneGrades: Record<string, Grade>;
  /** Zone the globe should turn towards (focus, travel preview, travel). */
  focusZone?: ZoneId | null;
  /** Zone of the fund whose turn it is (its pin glows softly). */
  activeZone?: ZoneId | null;
  markers: GlobeMarker[];
  flight?: GlobeFlight | null;
  /** Dashed route previewing a possible move; no command is involved. */
  preview?: { fromZone: ZoneId | null; toZone: ZoneId } | null;
  /** Zone rating being revealed (MARKET_IMPACT): pin pulses green/red. */
  impact?: { zoneId: ZoneId; direction: "up" | "down"; key: string } | null;
  /** Show floating HTML-free labels (city + grade) next to each pin. */
  labels?: boolean;
  /** HUD hover: this zone's pin and label are emphasised (pulse), without turning the globe. */
  highlightZone?: ZoneId | null;
  reducedMotion: boolean;
  quality: "high" | "medium" | "low";
  /**
   * Where a focused city should face: "camera" (default) turns it towards the
   * viewer; a vector is a fixed direction in the globe group's local space.
   */
  facing?: "camera" | [number, number, number];
  /** Brass armillary rings (default true). */
  rings?: boolean;
  /** Label height in world units (default 0.085 × radius). */
  labelSize?: number;
  /** Called once, after the engraved textures are on screen. */
  onReady?: () => void;
  /** Travel cinematic channel: the live frame (plane + camera poses) is published here for a camera rig. */
  cinematic?: TravelChannel | null;
}

const DEG = Math.PI / 180;
const ZONES = Object.keys(ZONE_META) as ZoneId[];

/** Position of a lat/lon on a sphere, matching THREE.SphereGeometry's UV layout. */
export function latLonToVector(lat: number, lon: number, radius = 1, out = new THREE.Vector3()) {
  const phi = (lon + 180) * DEG;
  const la = lat * DEG;
  return out.set(-Math.cos(phi) * Math.cos(la) * radius, Math.sin(la) * radius, Math.sin(phi) * Math.cos(la) * radius);
}

const zoneUnit = new Map<ZoneId, THREE.Vector3>(ZONES.map((zone) => [zone, latLonToVector(ZONE_META[zone].lat, ZONE_META[zone].lon)]));
const unitOf = (zone: ZoneId | null | undefined) => (zone ? zoneUnit.get(zone) ?? null : null);

/** Deterministic pseudo random generator (mulberry32). */
function seeded(seed: number) {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth01 = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const smooth = (edge0: number, edge1: number, x: number) => smooth01((x - edge0) / (edge1 - edge0));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const easeOutBack = (t: number) => { const x = clamp01(t) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; };

// =========================================================================
// Engraved textures (built once per resolution, shared by every globe)
// =========================================================================
interface GlobeTextures { map: THREE.Texture; orm: THREE.Texture; emissive: THREE.Texture; sparks: Float32Array | null }
const texturePromises = new Map<number, Promise<GlobeTextures | null>>();

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function drawGraticule(ctx: CanvasRenderingContext2D, w: number, h: number) {
  for (let lon = -180; lon <= 180; lon += 15) {
    const x = ((lon + 180) / 360) * w;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = ((90 - lat) / 180) * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

async function buildGlobeTextures(width: number): Promise<GlobeTextures | null> {
  const [rings, lights] = await Promise.all([loadLandRings(), loadImage("/assets/world/nasa-black-marble-2016.jpg")]);
  if (!rings.length) return null;
  const w = width, h = width / 2;
  const line = Math.max(1.2, width / 1100);
  const canvas = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d", { willReadFrequently: true })!] as const; };

  // Colour: warm black ocean, slightly lifted land, crisp gold coastlines, faint graticule.
  const [colour, c] = canvas();
  const ocean = c.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, "#0b0a09");
  ocean.addColorStop(0.5, "#0d0c0a");
  ocean.addColorStop(1, "#0b0a09");
  c.fillStyle = ocean;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "rgba(214, 178, 106, 0.16)";
  c.lineWidth = line * 0.6;
  drawGraticule(c, w, h);
  c.fillStyle = "#16130f";
  traceLand(c, rings, w, h, "fill");
  c.lineJoin = "round";
  c.lineCap = "round";
  c.strokeStyle = "#e6c27a";
  c.lineWidth = line * 1.25;
  traceLand(c, rings, w, h, "stroke");

  // Roughness (G) / metalness (B): polished obsidian seas, satin land, gold inlay.
  const [orm, o] = canvas();
  o.fillStyle = "rgb(0, 38, 0)";
  o.fillRect(0, 0, w, h);
  o.strokeStyle = "rgb(0, 60, 150)";
  o.lineWidth = line * 0.6;
  drawGraticule(o, w, h);
  o.fillStyle = "rgb(0, 112, 20)";
  traceLand(o, rings, w, h, "fill");
  o.lineJoin = "round";
  o.strokeStyle = "rgb(0, 52, 255)";
  o.lineWidth = line * 1.25;
  traceLand(o, rings, w, h, "stroke");

  // Emission: warm city lights (thresholded) + a faint glow along the gold coastlines.
  // The brightest lights also become crisp "sparks" (points) for the close-up.
  const [emissive, e] = canvas();
  e.fillStyle = "#000";
  e.fillRect(0, 0, w, h);
  let sparks: Float32Array | null = null;
  if (lights) {
    e.drawImage(lights, 0, 0, w, h);
    const pixels = e.getImageData(0, 0, w, h);
    const data = pixels.data;
    const step = Math.max(1, Math.round(w / 2048));
    const gw = Math.ceil(w / step), gh = Math.ceil(h / step);
    const weights = new Float32Array(gw * gh);
    let total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = Math.max(data[i]!, data[i + 1]!, data[i + 2]!) / 255;
        const v = Math.pow(Math.max(0, (lum - 0.2) / 0.8), 1.25);
        data[i] = 255 * Math.min(1, v * 1.05);
        data[i + 1] = 205 * Math.min(1, v);
        data[i + 2] = 130 * Math.min(1, v * 0.9);
        if (x % step === 0 && y % step === 0 && v > 0.22) {
          const weight = Math.pow(v, 1.6);
          weights[(y / step) * gw + x / step] = weight;
          total += weight;
        }
      }
    }
    e.putImageData(pixels, 0, 0);
    const target = width >= 4096 ? 5600 : width >= 2048 ? 3800 : 1600;
    const random = seeded(7);
    const out: number[] = [];
    const point = new THREE.Vector3();
    for (let gy = 0; gy < gh && total > 0; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const weight = weights[gy * gw + gx]!;
        if (!weight || random() > (weight * target) / total) continue;
        const lon = ((gx * step + random() * step) / w) * 360 - 180;
        const lat = 90 - ((gy * step + random() * step) / h) * 180;
        latLonToVector(lat, lon, 1.0016, point);
        out.push(point.x, point.y, point.z, Math.min(1, 0.35 + weight));
      }
    }
    sparks = new Float32Array(out);
  }
  e.globalCompositeOperation = "lighter";
  e.strokeStyle = "rgba(230, 190, 110, 0.22)";
  e.lineJoin = "round";
  e.lineWidth = line * 1.25;
  traceLand(e, rings, w, h, "stroke");
  e.globalCompositeOperation = "source-over";

  const make = (source: HTMLCanvasElement, srgb: boolean) => {
    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 8;
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  };
  return { map: make(colour, true), orm: make(orm, false), emissive: make(emissive, true), sparks };
}

function globeTextures(width: number) {
  let promise = texturePromises.get(width);
  if (!promise) {
    promise = typeof document === "undefined" ? Promise.resolve(null) : buildGlobeTextures(width).catch(() => null);
    texturePromises.set(width, promise);
  }
  return promise;
}

/** Crisp vector coastlines and graticule (pairs of points, unit sphere) for the close-up. */
let linesPromise: Promise<{ coast: Float32Array; grid: Float32Array } | null> | null = null;
function globeLines() {
  if (!linesPromise) {
    linesPromise = loadLandRings().then((rings) => {
      if (!rings.length) return null;
      const coast: number[] = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      const edge = (p: [number, number]) => Math.abs(p[0]) > 179.9 || p[1] < -89.9;
      for (const ring of rings) {
        for (let i = 1; i < ring.length; i++) {
          const p = ring[i - 1]!, q = ring[i]!;
          if ((edge(p) && edge(q)) || Math.abs(p[0] - q[0]) > 180) continue;
          latLonToVector(p[1], p[0], 1.0024, a);
          latLonToVector(q[1], q[0], 1.0024, b);
          coast.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      const grid: number[] = [];
      for (let lon = -180; lon < 180; lon += 15) {
        for (let lat = -75; lat < 75; lat += 2.5) {
          latLonToVector(lat, lon, 1.002, a); latLonToVector(lat + 2.5, lon, 1.002, b);
          grid.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      for (let lat = -75; lat <= 75; lat += 15) {
        for (let lon = -180; lon < 180; lon += 2.5) {
          latLonToVector(lat, lon, 1.002, a); latLonToVector(lat, lon + 2.5, 1.002, b);
          grid.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      return { coast: new Float32Array(coast), grid: new Float32Array(grid) };
    }).catch(() => null);
  }
  return linesPromise;
}

// =========================================================================
// Cached geometry & materials
// =========================================================================
const geometryCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
  let geometry = geometryCache.get(key) as T | undefined;
  if (!geometry) { geometry = build(); geometryCache.set(key, geometry); }
  return geometry;
}

function bandGeometry(radius: number, width: number, thickness: number, segments: number) {
  const r0 = radius - thickness / 2, r1 = radius + thickness / 2, hw = width / 2, b = Math.min(thickness, width) * 0.3;
  const profile = [
    [r0 + b, -hw], [r1 - b, -hw], [r1, -hw + b], [r1, hw - b], [r1 - b, hw], [r0 + b, hw], [r0, hw - b], [r0, -hw + b], [r0 + b, -hw],
  ].map(([x, y]) => new THREE.Vector2(x!, y!));
  return new THREE.LatheGeometry(profile, segments);
}

const sphereMaterials = new Map<string, THREE.MeshStandardMaterial>();
function sphereMaterial(quality: GlobeProps["quality"]) {
  let material = sphereMaterials.get(quality);
  if (!material) {
    const params: THREE.MeshPhysicalMaterialParameters = {
      color: OBJECT_PALETTE.obsidian, roughness: 0.22, metalness: 0.1, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, envMapIntensity: 1,
    };
    material = quality === "low"
      ? new THREE.MeshStandardMaterial(params as THREE.MeshStandardMaterialParameters)
      : new THREE.MeshPhysicalMaterial({ ...params, clearcoat: 0.7, clearcoatRoughness: 0.07 });
    material.name = `gf-obsidian-${quality}`;
    sphereMaterials.set(quality, material);
  }
  return material;
}

function applyTextures(material: THREE.MeshStandardMaterial, textures: GlobeTextures) {
  if (material.map === textures.map) return;
  material.color.set("#ffffff");
  material.map = textures.map;
  material.roughnessMap = textures.orm;
  material.metalnessMap = textures.orm;
  material.roughness = 1;
  material.metalness = 1;
  material.emissiveMap = textures.emissive;
  material.emissiveIntensity = 2.1;
  material.needsUpdate = true;
}

let atmosphereMaterial: THREE.ShaderMaterial | null = null;
function getAtmosphereMaterial() {
  if (!atmosphereMaterial) {
    atmosphereMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      toneMapped: false,
      uniforms: { uColor: { value: new THREE.Color(OBJECT_PALETTE.atmosphere) }, uWarm: { value: new THREE.Color("#e8c27c") }, uStrength: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uWarm;
        uniform float uStrength;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          float facing = clamp(dot(normalize(vNormalV), normalize(vViewDir)), 0.0, 1.0);
          float rim = pow(1.0 - facing, 3.2);
          vec3 col = mix(uColor, uWarm, smoothstep(0.2, 0.9, vNormalV.y * 0.5 + 0.5) * 0.25);
          gl_FragColor = vec4(col * rim * 0.7 * uStrength, rim * uStrength);
        }`,
    });
  }
  return atmosphereMaterial;
}

/** Route ribbon on the surface: drawn behind the plane (bright near it), faint dashes ahead; or dashed (preview). */
function routeMaterial(color: string, dashed: boolean, dashes: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uHead: { value: 0 },
      uOpacity: { value: 1 },
      uDash: { value: dashed ? 1 : 0 },
      uDashes: { value: dashes },
      uAhead: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uHead;
      uniform float uOpacity;
      uniform float uDash;
      uniform float uDashes;
      uniform float uAhead;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float s = vUv.x;
        float across = abs(vUv.y - 0.5) * 2.0;
        float edge = 1.0 - smoothstep(0.4, 1.0, across);
        float ends = smoothstep(0.0, 0.02, s) * (1.0 - smoothstep(0.98, 1.0, s));
        float a;
        if (uDash > 0.5) {
          float d = fract(s * uDashes - uTime * 0.55);
          a = smoothstep(0.0, 0.1, d) * (1.0 - smoothstep(0.42, 0.52, d)) * 0.9;
        } else {
          float behind = uHead - s;
          if (behind >= 0.0) a = 0.34 + 0.66 * exp(-behind / 0.1);
          else {
            float d = fract(s * uDashes - uTime * 0.4);
            a = uAhead * 0.55 * smoothstep(0.0, 0.1, d) * (1.0 - smoothstep(0.38, 0.48, d));
          }
        }
        a *= edge * ends * uOpacity;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * (0.7 + 1.5 * a), a);
      }`,
  });
}

/** Thin ribbon lying on the sphere along the route centreline (uv.x = route fraction). */
function routeRibbon(plan: FlightPlan, width: number, lift: number) {
  const segments = Math.max(48, Math.round(48 + (plan.omega / Math.PI) * 140));
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const index: number[] = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    routePoint(plan, s, lift, p);
    routePoint(plan, Math.min(1, s + 1e-3), lift, q);
    if (s >= 1) { routePoint(plan, s - 1e-3, lift, q); q.sub(p).negate(); } else q.sub(p);
    side.crossVectors(p, q).normalize().multiplyScalar(width / 2);
    positions.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
    uvs.set([s, 0, s, 1], i * 4);
    if (i < segments) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

const markerMaterials = new Map<string, THREE.MeshStandardMaterial>();
function markerMaterial(color: string, state: "idle" | "active" | "jailed") {
  const key = `${color}|${state}`;
  let material = markerMaterials.get(key);
  if (!material) {
    const tint = state === "jailed" ? new THREE.Color("#3d3b38") : new THREE.Color(color);
    material = new THREE.MeshStandardMaterial({
      color: tint,
      emissive: state === "jailed" ? new THREE.Color(OBJECT_PALETTE.rubyGlow) : new THREE.Color(color),
      emissiveIntensity: state === "active" ? 1.9 : state === "jailed" ? 0.5 : 0.55,
      metalness: 0.35,
      roughness: 0.16,
      flatShading: true,
      toneMapped: state !== "active",
    });
    markerMaterials.set(key, material);
  }
  return material;
}

// =========================================================================
// Particles: contrails (spin space, so they stay in the air mass) and city sparks
// =========================================================================
interface Contrail { points: THREE.Points; geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial; head: number; carry: number; count: number; last: THREE.Vector3[]; primed: boolean; key: string | number | null }

function createContrail(count: number): Contrail {
  const geometry = new THREE.BufferGeometry();
  const random = seeded(31);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const u = random() * 2 - 1, a = random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    seeds.set([Math.cos(a) * s, u, Math.sin(a) * s, 0.7 + random() * 0.6], i * 4);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("aBirth", new THREE.BufferAttribute(new Float32Array(count).fill(-1e4), 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uTime: { value: 0 }, uLife: { value: 0.85 }, uScale: { value: 600 }, uWorld: { value: 1 }, uColor: { value: new THREE.Color("#f6dfb0") }, uOpacity: { value: 0.2 } },
    vertexShader: /* glsl */ `
      attribute float aBirth;
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uLife;
      uniform float uScale;
      uniform float uWorld;
      varying float vAlpha;
      void main() {
        float age = (uTime - aBirth) / uLife;
        if (age < 0.0 || age > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return; }
        vec3 up = normalize(position);
        vec3 p = position + (aSeed.xyz * 0.0045 + up * 0.002) * age;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = mix(0.005, 0.014, sqrt(age)) * aSeed.w;
        gl_PointSize = clamp(size * uWorld * uScale / max(0.001, -mv.z), 0.0, 64.0);
        vAlpha = smoothstep(0.0, 0.05, age) * pow(1.0 - age, 1.7);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        float a = (1.0 - smoothstep(0.0, 1.0, d));
        a = a * a * vAlpha * uOpacity;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 9.4;
  return { points, geometry, material, head: 0, carry: 0, count, last: [new THREE.Vector3(), new THREE.Vector3()], primed: false, key: null };
}

function createSparks(data: Float32Array) {
  const count = data.length / 4;
  const positions = new Float32Array(count * 3), glow = new Float32Array(count);
  for (let i = 0; i < count; i++) { positions.set([data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!], i * 3); glow[i] = data[i * 4 + 3]!; }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aGlow", new THREE.BufferAttribute(glow, 1));
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uScale: { value: 600 }, uWorld: { value: 1 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color("#ffd59a") } },
    vertexShader: /* glsl */ `
      attribute float aGlow;
      uniform float uScale;
      uniform float uWorld;
      varying float vGlow;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vGlow = aGlow;
        gl_PointSize = clamp(0.0034 * (0.6 + aGlow) * uWorld * uScale / max(0.001, -mv.z), 0.0, 9.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vGlow;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = exp(-dot(c, c) * 14.0) * vGlow * uOpacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * 1.6, a);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 5;
  return { points, geometry, material };
}

/** Wispy cloud texture (seeded value-noise fBm, soft round falloff). */
let cloudTexture: THREE.CanvasTexture | null = null;
function getCloudTexture() {
  if (cloudTexture) return cloudTexture;
  const size = 128;
  const random = seeded(11);
  const grid = 16;
  const lattice = new Float32Array((grid + 1) * (grid + 1)).map(() => random());
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x) % grid, yi = Math.floor(y) % grid, xf = x - Math.floor(x), yf = y - Math.floor(y);
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const at = (i: number, j: number) => lattice[(j % grid) * (grid + 1) + (i % grid)]!;
    return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy;
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.55, f = 2.2;
      for (let o = 0; o < 5; o++) { v += amp * noise((x / size) * f + o * 3.1, (y / size) * f * 0.45 + o * 1.7); amp *= 0.52; f *= 2.1; }
      const dx = (x / size) * 2 - 1, dy = (y / size) * 2 - 1;
      const fall = Math.max(0, 1 - Math.hypot(dx, dy * 1.9));
      const a = smooth01((v - 0.5) / 0.22) * fall * fall;
      const i = (y * size + x) * 4;
      image.data[i] = 255; image.data[i + 1] = 250; image.data[i + 2] = 240; image.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(image, 0, 0);
  cloudTexture = new THREE.CanvasTexture(canvas);
  cloudTexture.colorSpace = THREE.SRGBColorSpace;
  return cloudTexture;
}

// =========================================================================
// Labels (canvas sprites: Cinzel city + grade jewel)
// =========================================================================
type LabelVariant = "idle" | "active" | "accent";
const labelTextures = new Map<string, THREE.CanvasTexture>();
let fontsReady: Promise<unknown> | null = null;
function ensureFonts() {
  if (!fontsReady && typeof document !== "undefined" && document.fonts) {
    fontsReady = Promise.all([document.fonts.load("600 44px Cinzel"), document.fonts.load("800 40px Inter")]).catch(() => null);
  }
  return fontsReady ?? Promise.resolve(null);
}

function labelTexture(zone: ZoneId, grade: Grade, variant: LabelVariant, accent = "#e3b860") {
  const key = `${zone}|${grade}|${variant}|${variant === "accent" ? accent : ""}`;
  let texture = labelTextures.get(key);
  if (texture) return texture;
  const scale = 2;
  const glow = variant === "accent" ? 10 * scale : 0;
  const height = 48 * scale + glow * 2;
  const city = ZONE_META[zone].city.toUpperCase();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `600 ${21 * scale}px Cinzel, "Cormorant Garamond", serif`;
  ctx.font = font;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${2.2 * scale}px`;
  const textWidth = ctx.measureText(city).width;
  const jewel = 17 * scale;
  const pad = 12 * scale;
  const width = Math.ceil(pad + jewel * 2 + 10 * scale + textWidth + pad * 1.15) + glow * 2;
  canvas.width = width;
  canvas.height = height;
  const strong = variant !== "idle";
  // Glass pill with a hairline (brass, or the travelling fund's colour).
  const r = (height - glow * 2) / 2 - 2;
  if (glow) {
    ctx.shadowColor = accent;
    ctx.shadowBlur = glow;
  }
  ctx.beginPath();
  ctx.roundRect(2 + glow, 2 + glow, width - 4 - glow * 2, height - 4 - glow * 2, r);
  ctx.fillStyle = strong ? "rgba(26, 21, 12, 0.86)" : "rgba(12, 11, 10, 0.74)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = (variant === "accent" ? 2.4 : 1.5) * scale;
  ctx.strokeStyle = variant === "accent" ? accent : strong ? "rgba(239, 217, 167, 0.85)" : "rgba(226, 196, 134, 0.42)";
  ctx.stroke();
  // Grade jewel.
  const meta = GRADE_META[grade] ?? GRADE_META.C;
  const cx = glow + pad + jewel - 2 * scale, cy = height / 2;
  const g = ctx.createRadialGradient(cx - jewel * 0.35, cy - jewel * 0.45, jewel * 0.1, cx, cy, jewel);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.28, meta.color);
  g.addColorStop(1, new THREE.Color(meta.color).multiplyScalar(0.55).getStyle());
  ctx.beginPath();
  ctx.arc(cx, cy, jewel - 3 * scale, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = "#0c0b0a";
  ctx.font = `800 ${19 * scale}px Inter, system-ui, sans-serif`;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(grade, cx, cy + 1 * scale);
  // City.
  ctx.font = font;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${2.2 * scale}px`;
  ctx.textAlign = "left";
  ctx.fillStyle = strong ? "#f6e7c4" : "#e9dcc0";
  ctx.fillText(city, cx + jewel + 8 * scale, cy + 1.5 * scale);
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  labelTextures.set(key, texture);
  return texture;
}

// =========================================================================
// Component
// =========================================================================
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
const _g = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Spin that brings longitude ~15°E (Europe / Africa) to the front by default. */
const HOME = latLonToVector(18, 15);
const HOME_SPIN = -Math.atan2(HOME.x, HOME.z);
const CLOUD_COUNT = 14;

interface Pose { spin: number; tilt: number; spinV: number; tiltV: number; axis: THREE.Vector3 }

/** Critically damped spring (implicit, stable at any frame time). */
function spring(pose: Pose, key: "spin" | "tilt", target: number, omega: number, dt: number) {
  const vKey = key === "spin" ? "spinV" : "tiltV";
  const x = pose[key], v = pose[vKey];
  const f = 1 + 2 * dt * omega, oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  pose[key] = (f * x + dt * v + hhoo * target) * det;
  pose[vKey] = (v + hoo * (target - x)) * det;
}

export const ArmillaryGlobe = memo(function ArmillaryGlobe({
  radius = 2.4, reducedMotion, quality, zoneGrades, focusZone, activeZone, markers, flight, preview, impact, labels, highlightZone,
  facing = "camera", rings = true, labelSize, onReady, cinematic, ...group
}: GlobeProps & ThreeElements["group"]) {
  const R = radius;
  const { camera, invalidate } = useThree();
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const ecliptic = useRef<THREE.Group>(null);
  const ringGroup = useRef<THREE.Group>(null);
  const meridian = useRef<THREE.Mesh>(null);
  const pose = useRef<Pose>({ spin: HOME_SPIN, tilt: 0, spinV: 0, tiltV: 0, axis: new THREE.Vector3(-1, 0, 0) });
  const ready = useRef<"waiting" | "applied" | "done">("waiting");
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const detail = quality === "low" ? 0 : quality === "medium" ? 1 : 2;
  const material = sphereMaterial(quality);
  const [textures, setTextures] = useState<GlobeTextures | null>(null);

  // Engraved textures (async, shared): 4K on the high tier so the close-up holds.
  useEffect(() => {
    let alive = true;
    globeTextures(quality === "low" ? 1024 : quality === "medium" ? 2048 : 4096).then((built) => {
      if (!alive) return;
      if (built) applyTextures(material, built);
      ready.current = "applied";
      setTextures(built);
      invalidate();
    });
    return () => { alive = false; };
  }, [material, quality, invalidate]);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  useEffect(() => {
    if (!labels) return;
    let alive = true;
    ensureFonts().then(() => { if (alive) { setFontsLoaded(true); invalidate(); } });
    return () => { alive = false; };
  }, [labels, invalidate]);

  const sphereGeometry = cached(`sphere|${detail}`, () => new THREE.SphereGeometry(1, [64, 112, 192][detail]!, [44, 80, 128][detail]!));
  const atmosphereGeometry = cached(`atmo|${detail}`, () => new THREE.SphereGeometry(1, [48, 72, 96][detail]!, [32, 48, 64][detail]!));
  const segments = [96, 160, 220][detail]!;
  const equatorGeometry = cached(`equator|${detail}`, () => bandGeometry(1.105, 0.022, 0.012, segments));
  const eclipticGeometry = cached(`ecliptic|${detail}`, () => bandGeometry(1.17, 0.07, 0.014, segments));
  const meridianGeometry = cached(`meridian|${detail}`, () => bandGeometry(1.25, 0.03, 0.016, segments));
  const tickGeometry = cached("tick", () => new THREE.BoxGeometry(1, 1, 1));
  const pinGeometry = cached(`pin|${detail}`, () => new THREE.CylinderGeometry(0.0055, 0.0035, 0.072, 10, 1).translate(0, 0.036, 0));
  const headGeometry = cached(`head|${detail}`, () => new THREE.SphereGeometry(0.019, 20, 14));
  const socketGeometry = cached("socket", () => new THREE.TorusGeometry(0.016, 0.0035, 8, 32).rotateX(Math.PI / 2));
  const gemGeometry = cached("gem", () => new THREE.OctahedronGeometry(0.024, 0).scale(1, 1.55, 1).translate(0, 0.04, 0));
  const pulseGeometry = cached("pulse", () => new THREE.RingGeometry(0.02, 0.028, 48).rotateX(-Math.PI / 2));
  const touchdownGeometry = cached("touchdown", () => new THREE.RingGeometry(0.024, 0.027, 64).rotateX(-Math.PI / 2));
  const haloGeometry = cached("halo", () => new THREE.RingGeometry(0.034, 0.041, 64).rotateX(-Math.PI / 2));
  const shroudGeometry = cached("shroud", () => new THREE.SphereGeometry(1, 48, 24));
  const cloudGeometry = cached("cloud", () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));

  const brass = pieceMaterial("brass", quality) as THREE.MeshStandardMaterial;
  const gold = pieceMaterial("gold", quality) as THREE.MeshStandardMaterial;
  const onyx = pieceMaterial("onyx", quality) as THREE.MeshStandardMaterial;
  // Own materials (animated per instance).
  const mats = useMemo(() => {
    const ringBrass = brass.clone();
    ringBrass.transparent = true;
    const ringOnyx = onyx.clone();
    ringOnyx.transparent = true;
    return {
      ringBrass,
      ringOnyx,
      activeHead: new THREE.MeshStandardMaterial({ color: "#ffe2a0", emissive: new THREE.Color("#ffc96b"), emissiveIntensity: 2.4, metalness: 0.6, roughness: 0.2, toneMapped: false }),
      seatHead: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: new THREE.Color("#ffffff"), emissiveIntensity: 2.2, metalness: 0.5, roughness: 0.25, toneMapped: false }),
      glow: new THREE.SpriteMaterial({ map: radialGlowTexture(), color: new THREE.Color("#ffcf7a"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.8 }),
      highlightGlow: new THREE.SpriteMaterial({ map: radialGlowTexture(), color: new THREE.Color("#ffd98f"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }),
      seatGlow: new THREE.SpriteMaterial({ map: radialGlowTexture(), color: new THREE.Color("#ffffff"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }),
      flash: new THREE.SpriteMaterial({ map: radialGlowTexture(), color: new THREE.Color("#ffe1a3"), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 }),
      pulse: new THREE.MeshBasicMaterial({ color: "#38d59b", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
      halo: new THREE.MeshBasicMaterial({ color: "#f3cf85", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, opacity: 0 }),
      touchdown: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, opacity: 0 }),
      shroud: new THREE.MeshBasicMaterial({ color: "#050403", side: THREE.BackSide, transparent: true, depthWrite: false, opacity: 0 }),
    };
  }, [brass, onyx]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // Engraved ticks on the ecliptic band (instanced, set once).
  const ticks = useMemo(() => {
    const mesh = new THREE.InstancedMesh(tickGeometry, mats.ringOnyx, 72);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const major = i % 6 === 0;
      m.compose(
        new THREE.Vector3(Math.cos(a) * 1.177, 0, Math.sin(a) * 1.177),
        new THREE.Quaternion().setFromAxisAngle(UP, -a),
        new THREE.Vector3(0.004, major ? 0.06 : 0.032, 0.006),
      );
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [tickGeometry, mats.ringOnyx]);
  useEffect(() => () => ticks.dispose(), [ticks]);

  // Pins: local orientation (needle along the surface normal).
  const pins = useMemo(() => ZONES.map((zone) => {
    const normal = zoneUnit.get(zone)!.clone();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, normal);
    return { zone, normal, quaternion };
  }), []);

  // Markers grouped around their zone pin.
  const markerLayout = useMemo(() => {
    const byZone = new Map<ZoneId, GlobeMarker[]>();
    for (const marker of markers) {
      if (!zoneUnit.has(marker.zoneId)) continue;
      const list = byZone.get(marker.zoneId) ?? [];
      list.push(marker);
      byZone.set(marker.zoneId, list);
    }
    const out: Array<{ marker: GlobeMarker; position: THREE.Vector3; quaternion: THREE.Quaternion }> = [];
    for (const [zone, list] of byZone) {
      const normal = zoneUnit.get(zone)!;
      const tangent = new THREE.Vector3().crossVectors(UP, normal).normalize();
      if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      list.forEach((marker, index) => {
        const angle = (index / Math.max(1, list.length)) * Math.PI * 2 + Math.PI / 4;
        const ring = 0.058 + 0.006 * Math.max(0, list.length - 3);
        const position = normal.clone().multiplyScalar(1.002)
          .addScaledVector(tangent, Math.cos(angle) * ring)
          .addScaledVector(bitangent, Math.sin(angle) * ring)
          .normalize().multiplyScalar(1.002);
        out.push({ marker, position, quaternion: new THREE.Quaternion().setFromUnitVectors(UP, position.clone().normalize()) });
      });
    }
    return out;
  }, [markers]);

  // ------------------------------------------------------------- travel --
  const plan = useMemo(() => {
    if (!flight) return null;
    const from = unitOf(flight.fromZone), to = unitOf(flight.toZone);
    if (!from || !to || flight.fromZone === flight.toZone) return null;
    return planFlight(from, to, flight.key);
  }, [flight]);
  // Live window of the flight (for label / pin variants that need a re-render).
  const [liveKey, setLiveKey] = useState<string | number | null>(null);
  useEffect(() => {
    if (!flight || !plan) { setLiveKey(null); return; }
    const now = performance.now();
    const begin = Math.max(0, flight.startedAt - now), end = Math.max(0, flight.startedAt + flight.durationMs * 1.12 - now);
    const timers = [
      window.setTimeout(() => { setLiveKey(flight.key); invalidate(); }, begin),
      window.setTimeout(() => { setLiveKey(null); invalidate(); }, end + 16),
    ];
    // Reduced motion renders on demand: wake the canvas at the beats.
    for (const at of [0, 1, 1.12, 1.2]) timers.push(window.setTimeout(() => invalidate(), Math.max(0, flight.startedAt + flight.durationMs * at - now) + 16));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [flight, plan, invalidate]);
  const live = !!flight && !!plan && liveKey === flight.key;
  const destinationPin = live && flight ? pins.find((pin) => pin.zone === flight.toZone) : undefined;

  const routes = useMemo(() => {
    if (!plan || !flight) return null;
    return { geometry: routeRibbon(plan, 0.0075, 1.0035), material: routeMaterial(flight.seatColor, false, Math.max(8, plan.omega * 26)) };
  }, [plan, flight]);
  useEffect(() => () => { routes?.geometry.dispose(); routes?.material.dispose(); }, [routes]);
  const previewPlan = useMemo(() => {
    if (!preview?.fromZone) return null;
    const from = unitOf(preview.fromZone), to = unitOf(preview.toZone);
    if (!from || !to || preview.fromZone === preview.toZone) return null;
    const p = planFlight(from, to, "preview");
    return { geometry: routeRibbon(p, 0.0068, 1.0035), material: routeMaterial("#efd9a7", true, Math.max(8, p.omega * 22)) };
  }, [preview?.fromZone, preview?.toZone]);
  useEffect(() => () => { previewPlan?.geometry.dispose(); previewPlan?.material.dispose(); }, [previewPlan]);

  const wantsPlane = !!cinematic || !!flight;
  const plane = useMemo<AirplaneRig | null>(() => (wantsPlane ? createAirplane(quality, { renderOrder: 12, envMap: airplaneEnvironment(gl) }) : null), [wantsPlane, quality, gl]);
  useEffect(() => () => plane?.dispose(), [plane]);
  useEffect(() => { if (plane && flight) plane.setSeatColor(flight.seatColor); }, [plane, flight]);
  const contrail = useMemo(() => (wantsPlane ? createContrail(quality === "low" ? 160 : 640) : null), [wantsPlane, quality]);
  useEffect(() => () => { contrail?.geometry.dispose(); contrail?.material.dispose(); }, [contrail]);
  const clouds = useMemo(() => {
    if (!plan || quality !== "high") return null;
    const random = seeded(typeof plan.key === "number" ? plan.key : String(plan.key).length * 97);
    const items: Array<{ mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; base: number }> = [];
    const p = new THREE.Vector3();
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const s = 0.18 + 0.68 * (i + random() * 0.8) / CLOUD_COUNT;
      routePoint(plan, s, 1, p);
      const lateral = (random() - 0.5) * 0.34;
      p.addScaledVector(plan.normal, lateral).normalize();
      const altitude = 1.05 + random() * 0.06;
      const material = new THREE.MeshBasicMaterial({ map: getCloudTexture(), color: "#ece4d6", transparent: true, depthWrite: false, opacity: 0 });
      const mesh = new THREE.Mesh(cloudGeometry, material);
      mesh.position.copy(p).multiplyScalar(altitude);
      mesh.quaternion.setFromUnitVectors(UP, p);
      mesh.rotateY(random() * Math.PI * 2);
      const scale = 0.06 + random() * 0.08;
      mesh.scale.set(scale * (2.2 + random() * 1.4), 1, scale);
      mesh.renderOrder = 9.3;
      items.push({ mesh, material, base: 0.2 + random() * 0.2 });
    }
    return items;
  }, [plan, quality, cloudGeometry]);
  useEffect(() => () => clouds?.forEach((cloud) => cloud.material.dispose()), [clouds]);
  const start = useMemo(() => createFlightStart(), []);
  const localFrame = useMemo(() => createFlightFrame(), []);
  const frame: FlightFrame = cinematic?.frame ?? localFrame;
  const traveller = useMemo(() => {
    if (!flight) return null;
    if (flight.playerId) return flight.playerId;
    const candidates = markers.filter((marker) => marker.zoneId === flight.toZone && marker.active);
    return candidates.length === 1 ? candidates[0]!.playerId : null;
  }, [flight, markers]);

  // Close-range detail: crisp coastlines + graticule (fat lines) and city sparks.
  const [lines, setLines] = useState<{ coast: LineSegments2; grid: LineSegments2 } | null>(null);
  useEffect(() => {
    if (!wantsPlane) return;
    let alive = true;
    let built: { coast: LineSegments2; grid: LineSegments2 } | null = null;
    globeLines().then((data) => {
      if (!alive || !data) return;
      const make = (positions: Float32Array, color: string, width: number) => {
        const geometry = new LineSegmentsGeometry().setPositions(positions);
        const lineMaterial = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
        const object = new LineSegments2(geometry, lineMaterial);
        object.renderOrder = 4;
        return object;
      };
      built = { coast: make(data.coast, "#f2cf86", quality === "low" ? 1.1 : 1.35), grid: make(data.grid, "#c9a35e", 0.8) };
      setLines(built);
      invalidate();
    });
    return () => {
      alive = false;
      if (built) for (const object of [built.coast, built.grid]) { object.geometry.dispose(); object.material.dispose(); }
    };
  }, [wantsPlane, quality, invalidate]);
  const sparks = useMemo(() => (wantsPlane && textures?.sparks?.length ? createSparks(textures.sparks) : null), [wantsPlane, textures]);
  useEffect(() => () => { sparks?.geometry.dispose(); sparks?.material.dispose(); }, [sparks]);

  // Impact pulse bookkeeping.
  const impactStart = useRef(0);
  useEffect(() => {
    if (!impact) return;
    impactStart.current = performance.now();
    mats.pulse.color.set(impact.direction === "up" ? "#38d59b" : "#f06b74");
    invalidate();
  }, [impact?.key, impact, mats, invalidate]);
  useEffect(() => { if (flight) { mats.seatHead.color.set(flight.seatColor); mats.seatHead.emissive.set(flight.seatColor); mats.seatGlow.color.set(flight.seatColor); mats.touchdown.color.set(flight.seatColor); } }, [flight, mats]);

  const labelRefs = useRef(new Map<ZoneId, THREE.Sprite>());
  const pinRefs = useRef(new Map<ZoneId, THREE.Group>());
  // Flat copies of the ref maps, rebuilt only when the scene graph changes (no per-frame iterators).
  const lists = useRef({ dirty: true, labels: [] as Array<[ZoneId, THREE.Sprite]>, pins: [] as THREE.Group[], markers: [] as Array<[string, THREE.Object3D]> });
  const pulseRef = useRef<THREE.Mesh>(null);
  const activeGlowRef = useRef<THREE.Sprite>(null);
  const highlightRef = useRef<THREE.Group>(null);
  const markerRefs = useRef(new Map<string, THREE.Object3D>());
  const planeRef = useRef<THREE.Group>(null);
  const shroudRef = useRef<THREE.Mesh>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const touchdownRef = useRef<THREE.Mesh>(null);
  const seatGlowRef = useRef<THREE.Sprite>(null);
  const flashRef = useRef<THREE.Sprite>(null);
  const warm = useRef(4);
  // Compile every cinematic program ahead of time: re-arm the warm-up when async layers arrive.
  useEffect(() => { if (lines || sparks) warm.current = Math.max(warm.current, 3); }, [lines, sparks]);
  const warmCloudRef = useRef<THREE.Mesh>(null);
  const warmCloudMaterial = useMemo(() => (quality === "high" ? new THREE.MeshBasicMaterial({ map: getCloudTexture(), color: "#ece4d6", transparent: true, depthWrite: false, opacity: 0 }) : null), [quality]);
  useEffect(() => () => warmCloudMaterial?.dispose(), [warmCloudMaterial]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const t = state.clock.elapsedTime;
    const group = root.current, tiltGroup = tilt.current, spinGroup = spin.current;
    if (!group || !tiltGroup || !spinGroup) return;
    group.updateWorldMatrix(true, false);
    const p = pose.current;
    const warming = warm.current > 0;
    if (warming) warm.current -= 1;

    // --- travel cinematic: one pure function of time (plane, globe, camera).
    let flying = false;
    let raw = -1;
    if (plan && flight) {
      raw = (now - flight.startedAt) / Math.max(1, flight.durationMs);
      if (!reducedMotion && raw >= 0 && raw < 1.12) {
        if (start.key !== plan.key) {
          group.worldToLocal(_v.copy(camera.position));
          captureFlightStart(plan, p.spin, p.tilt, _v, start);
        }
        flightPose(plan, start, raw, group.matrixWorld, R, frame);
        frame.now = now;
        frame.active = raw < 1;
        flying = raw < 1;
      } else frame.active = false;
    } else frame.active = false;
    const close = flying ? frame.close : 0;

    // --- orientation: the cinematic drives it while flying, else spin + tilt so the focused city faces the viewer.
    if (flying) {
      p.spin = frame.spin;
      p.tilt = frame.tilt;
      p.axis.copy(frame.axis);
      p.spinV = 0;
      p.tiltV = 0;
    } else {
      if (facing === "camera") {
        group.worldToLocal(_v.copy(camera.position));
        if (_v.lengthSq() < 1e-8) _v.set(0, 0, 1);
        _v.normalize();
      } else {
        _v.set(facing[0], facing[1], facing[2]).normalize();
      }
      const azF = Math.atan2(_v.x, _v.z);
      const elevF = Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1));
      const target = unitOf(focusZone ?? null);
      p.axis.set(-Math.cos(azF), 0, Math.sin(azF));
      const wantSpin = target ? p.spin + wrapAngle(azF - Math.atan2(target.x, target.z) - p.spin) : p.spin;
      const wantTilt = target ? THREE.MathUtils.clamp(elevF - Math.asin(target.y), -0.62, 0.62) : 0;
      if (reducedMotion) {
        if (target) { p.spin = wantSpin; p.tilt = wantTilt; } else p.tilt = 0;
        p.spinV = 0;
        p.tiltV = 0;
      } else {
        if (target) spring(p, "spin", wantSpin, 4.2, dt);
        else { p.spinV += (0.045 - p.spinV) * (1 - Math.exp(-dt * 1.5)); p.spin += p.spinV * dt; }
        spring(p, "tilt", wantTilt, 4.2, dt);
      }
    }
    tiltGroup.quaternion.copy(_q.setFromAxisAngle(p.axis, p.tilt));
    spinGroup.rotation.y = p.spin;
    if (ecliptic.current && !reducedMotion) ecliptic.current.rotation.y += dt * 0.06;

    // --- armillary rings dissolve while the camera is in close (they would cut the frame).
    const ringOpacity = 1 - smooth01(close * 1.6);
    mats.ringBrass.opacity = ringOpacity;
    mats.ringOnyx.opacity = ringOpacity;
    if (ringGroup.current) { ringGroup.current.visible = ringOpacity > 0.01; ringGroup.current.scale.setScalar(1 + 0.1 * (1 - ringOpacity)); }
    if (meridian.current) { meridian.current.visible = ringOpacity > 0.01; meridian.current.scale.setScalar(R * (1 + 0.1 * (1 - ringOpacity))); }

    // --- labels fade on the far side; route cities stay, the others step back during the cinematic.
    const u = flying ? frame.u : 0;
    const beat = live ? clamp01(raw) : 0;
    // Pins and gems step back while the camera is close, so the airliner keeps the scale.
    const pinScale = 1 - 0.5 * smooth01(close * 1.3);
    const l = lists.current;
    if (l.dirty) {
      l.labels = [...labelRefs.current];
      l.pins = [...pinRefs.current.values()];
      l.markers = [...markerRefs.current];
      l.dirty = false;
    }
    for (let i = 0; i < l.pins.length; i++) l.pins[i]!.scale.setScalar(R * pinScale);
    if (labels) {
      spinGroup.updateWorldMatrix(true, false);
      group.getWorldPosition(_c);
      const pulse = reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(t * 3.1);
      for (let i = 0; i < l.labels.length; i++) {
        const zone = l.labels[i]![0], sprite = l.labels[i]![1];
        const unit = zoneUnit.get(zone)!;
        _w.copy(unit).multiplyScalar(R).applyMatrix4(spinGroup.matrixWorld);
        const toCamera = _v.copy(camera.position).sub(_w).normalize();
        const normal = _w.sub(_c).normalize();
        const highlighted = zone === highlightZone;
        let opacity = smooth(highlighted ? -0.05 : 0.08, highlighted ? 0.3 : 0.4, normal.dot(toCamera));
        if (live && flight) {
          const role = zone === flight.fromZone ? (1 - 0.75 * smooth(0.3, 0.4, beat)) : zone === flight.toZone ? (0.45 + 0.55 * smooth(0.55, 0.7, beat)) : 1 - 0.9 * close;
          opacity *= role;
        }
        const material = sprite.material as THREE.SpriteMaterial;
        material.opacity = opacity;
        sprite.visible = opacity > 0.01;
        const base = sprite.userData.base as [number, number] | undefined;
        if (base) {
          const cap = Math.min(1, (_w.copy(unit).multiplyScalar(R).applyMatrix4(spinGroup.matrixWorld).distanceTo(camera.position) * 0.034) / base[1]);
          const k = (highlighted ? 1.1 + 0.06 * pulse : 1) * cap;
          sprite.scale.set(base[0] * k, base[1] * k, 1);
          sprite.position.copy(unit).multiplyScalar(R * (1 + 0.1 * pinScale));
        }
      }
    }

    // --- active pin glow, HUD highlight halo.
    const pulse = reducedMotion ? 0.65 : 0.5 + 0.5 * Math.sin(t * 2.4);
    mats.activeHead.emissiveIntensity = 1.6 + 1.4 * pulse;
    if (activeGlowRef.current) {
      mats.glow.opacity = 0.45 + 0.4 * pulse;
      activeGlowRef.current.scale.setScalar(R * (0.13 + 0.03 * pulse));
    }
    if (highlightRef.current) {
      const breathe = reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(t * 3.4);
      highlightRef.current.visible = !!highlightZone;
      mats.halo.opacity = 0.55 + 0.35 * breathe;
      mats.highlightGlow.opacity = 0.5 + 0.35 * breathe;
      const halo = highlightRef.current.children[0];
      if (halo) halo.scale.setScalar(1 + 0.22 * breathe);
      const sprite = highlightRef.current.children[1];
      if (sprite) sprite.scale.setScalar(0.15 + 0.03 * breathe);
    }

    // --- impact pulse ring.
    if (pulseRef.current) {
      if (impact) {
        const elapsed = (now - impactStart.current) / 1000;
        const phase = reducedMotion ? 0.45 : (elapsed % 1.3) / 1.3;
        pulseRef.current.visible = reducedMotion || elapsed < 3.9;
        pulseRef.current.scale.setScalar(R * (1 + phase * 3.4));
        mats.pulse.opacity = (1 - phase) * 0.95;
      } else pulseRef.current.visible = false;
    }

    // --- the airliner, its contrails, the route, clouds and the arrival beats.
    const planeObject = planeRef.current;
    const shownPlane = !!(plane && planeObject && plan && flight && live && raw >= 0 && raw < 1.06);
    if (planeObject && plane) {
      if (shownPlane && plan) {
        if (reducedMotion) {
          // Parked at the destination, engines off, nothing moves.
          flightPose(plan, start, TRAVEL_BEATS.stop, group.matrixWorld, R, localFrame);
          planeObject.position.copy(localFrame.planePos);
          planeObject.quaternion.copy(localFrame.planeQuat);
          planeObject.scale.setScalar(PLANE_SCALE);
          plane.setThrottle(0, 1);
          plane.setGear(1);
        } else {
          planeObject.position.copy(frame.planePos);
          planeObject.quaternion.copy(frame.planeQuat);
          planeObject.scale.setScalar(PLANE_SCALE * Math.max(1e-4, frame.planeScale));
          plane.setThrottle(frame.throttle, dt);
          plane.setGear(frame.gear);
        }
        planeObject.visible = true;
      } else if (warming) {
        planeObject.position.set(0, 0, 0);
        planeObject.scale.setScalar(1e-4);
        planeObject.visible = true;
      } else planeObject.visible = false;
    }
    if (contrail) {
      const material = contrail.material;
      const time = flight ? (now - flight.startedAt) / 1000 : 0;
      material.uniforms.uTime!.value = time;
      material.uniforms.uWorld!.value = R;
      material.uniforms.uScale!.value = (state.gl.domElement.height || size.height) / (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov ?? 30) * DEG / 2));
      material.uniforms.uOpacity!.value = quality === "low" ? 0.2 : 0.085;
      const births = contrail.geometry.getAttribute("aBirth") as THREE.BufferAttribute;
      if (flight && contrail.key !== flight.key) {
        (births.array as Float32Array).fill(-1e4);
        births.needsUpdate = true;
        contrail.key = flight.key;
        contrail.primed = false;
      }
      if (shownPlane && !reducedMotion && flying && frame.emit > 0.01) {
        const positions = contrail.geometry.getAttribute("position") as THREE.BufferAttribute;
        const array = positions.array as Float32Array;
        const birthArray = births.array as Float32Array;
        const s = PLANE_SCALE * frame.planeScale;
        for (let k = 0; k < 2; k++) {
          const exhaust = AIRPLANE.exhausts[k]!;
          _e.set(exhaust[0], exhaust[1], exhaust[2]).multiplyScalar(s).applyQuaternion(frame.planeQuat).add(frame.planePos);
          if (!contrail.primed) contrail.last[k]!.copy(_e);
          const rate = (quality === "low" ? 60 : 210) * frame.emit;
          const n = Math.min(16, Math.floor(rate * dt + Math.random()));
          for (let j = 0; j < n; j++) {
            const f = (j + 1) / n;
            _g.lerpVectors(contrail.last[k]!, _e, f);
            const i = contrail.head;
            array[i * 3] = _g.x; array[i * 3 + 1] = _g.y; array[i * 3 + 2] = _g.z;
            birthArray[i] = time - (1 - f) * dt;
            contrail.head = (contrail.head + 1) % contrail.count;
          }
          contrail.last[k]!.copy(_e);
        }
        contrail.primed = true;
        positions.needsUpdate = true;
        births.needsUpdate = true;
      } else contrail.primed = false;
      contrail.points.visible = !!flight && live && !reducedMotion;
    }
    if (routes && flight) {
      const uniforms = routes.material.uniforms;
      uniforms.uTime!.value = reducedMotion ? 0 : t;
      if (reducedMotion) {
        uniforms.uHead!.value = 1;
        uniforms.uAhead!.value = 0;
        uniforms.uOpacity!.value = live && raw <= 1 ? 0.9 : 0;
      } else {
        uniforms.uHead!.value = flying ? frame.head : raw >= 1 ? 1 : 0;
        uniforms.uAhead!.value = flying ? smooth(0.6, 0.7, u) * (1 - smooth(0.83, 0.88, u)) : 0;
        uniforms.uOpacity!.value = raw < 0 || !live ? 0 : smooth(0.06, 0.16, raw) * (1 - smooth(1.0, 1.12, raw));
      }
    }
    if (previewPlan) previewPlan.material.uniforms.uTime!.value = reducedMotion ? 0 : t;
    if (clouds) {
      for (let i = 0; i < clouds.length; i++) {
        const cloud = clouds[i]!;
        cloud.mesh.getWorldPosition(_w);
        const near = smooth(0.22 * R, 0.5 * R, _w.distanceTo(camera.position));
        cloud.material.opacity = cloud.base * close * near;
        cloud.mesh.visible = warming || cloud.material.opacity > 0.004;
      }
    }
    // Arrival: touchdown ring, destination glow in the seat colour, the traveller's gem pops in.
    if (warmCloudRef.current) warmCloudRef.current.visible = warming;
    if (touchdownRef.current && warming && !(plan && flight)) touchdownRef.current.visible = true;
    if (touchdownRef.current && plan && flight) {
      const age = live && !reducedMotion ? ((raw - TRAVEL_BEATS.touchdown) * flight.durationMs) / 1100 : -1;
      const show = age >= 0 && age <= 1;
      touchdownRef.current.visible = show;
      if (show) {
        routePoint(plan, plan.thetaTouch / plan.omega, 1.004, touchdownRef.current.position);
        touchdownRef.current.quaternion.setFromUnitVectors(UP, _v.copy(touchdownRef.current.position).normalize());
        touchdownRef.current.scale.setScalar(1.2 + age * 4.2);
        mats.touchdown.opacity = (1 - age) * (1 - age) * 0.55;
      }
    }
    if (seatGlowRef.current && flight) {
      const glow = live ? (reducedMotion ? 0.7 : smooth(0.6, 0.72, u) * (raw < 1 ? 1 : 1 - smooth(1, 1.12, raw))) : 0;
      seatGlowRef.current.visible = glow > 0.01;
      mats.seatGlow.opacity = glow * (0.55 + 0.35 * pulse);
      seatGlowRef.current.scale.setScalar(R * (0.16 + 0.04 * pulse) * pinScale * (1 - 0.5 * close));
      if (destinationPin) seatGlowRef.current.position.copy(destinationPin.normal).multiplyScalar(R * (1 + 0.074 * pinScale));
      mats.seatHead.emissiveIntensity = 1.4 + 1.6 * pulse;
    }
    if (flashRef.current && flight) {
      const age = live && !reducedMotion ? (raw - TRAVEL_BEATS.vanish) / 0.08 : -1;
      const show = age >= 0 && age <= 1;
      flashRef.current.visible = show;
      if (show) {
        flashRef.current.position.copy(frame.planePos);
        flashRef.current.scale.setScalar(0.06 + 0.22 * age);
        mats.flash.opacity = Math.sin(Math.PI * age) * 0.9;
      }
    }
    for (let i = 0; i < l.markers.length; i++) {
      const playerId = l.markers[i]![0], object = l.markers[i]![1];
      let k = 1;
      if (traveller && playerId === traveller && live && !reducedMotion && flight) {
        k = raw < TRAVEL_BEATS.gemPop ? 0 : easeOutBack(((raw - TRAVEL_BEATS.gemPop) * flight.durationMs) / 420);
      }
      object.visible = k > 0.001;
      object.scale.setScalar(R * Math.max(k, 0.001) * pinScale);
    }

    // --- close-range detail and the veil over the table; the obsidian keeps its night look up close.
    const detailOpacity = smooth01((close - 0.25) / 0.55);
    if (textures) {
      // Up close the board's high key light would sheen the satin land: keep the night obsidian.
      material.envMapIntensity = 1 - 0.8 * detailOpacity;
      material.emissiveIntensity = 2.1 + 0.6 * detailOpacity;
      if (material instanceof THREE.MeshPhysicalMaterial) {
        material.specularIntensity = 1 - 0.8 * detailOpacity;
        material.clearcoat = 0.7 - 0.3 * detailOpacity;
      }
    }
    if (lines) {
      lines.coast.material.resolution.set(size.width, size.height);
      lines.grid.material.resolution.set(size.width, size.height);
      lines.coast.material.opacity = 0.85 * detailOpacity;
      lines.grid.material.opacity = 0.22 * detailOpacity;
      lines.coast.visible = warming || detailOpacity > 0.005;
      lines.grid.visible = warming || detailOpacity > 0.005;
    }
    if (sparks) {
      sparks.material.uniforms.uOpacity!.value = detailOpacity;
      sparks.material.uniforms.uWorld!.value = R;
      sparks.material.uniforms.uScale!.value = (state.gl.domElement.height || size.height) / (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov ?? 30) * DEG / 2));
      sparks.points.visible = warming || detailOpacity > 0.005;
    }
    if (shroudRef.current) {
      group.getWorldPosition(_c);
      const distance = camera.position.distanceTo(_c) / R;
      // Fully opaque once inside: HDR plaques and figurines would otherwise bleed through the bloom.
      const veil = flying ? smooth01((1.78 - distance) / 0.32) * smooth01(close * 2) : 0;
      mats.shroud.opacity = veil;
      shroudRef.current.visible = warming || veil > 0.004;
    }
    if (sunRef.current) {
      const sun = sunRef.current;
      sun.intensity = flying ? 0.18 * close : 0;
      if (flying) {
        // Ahead of the camera and above: glints on the aluminium and on the obsidian sea ahead.
        _v.subVectors(frame.camTarget, frame.camPos).normalize();
        _w.copy(frame.camUp);
        _g.crossVectors(_v, _w).normalize();
        _e.copy(frame.planeWorld).addScaledVector(_v, 3.2).addScaledVector(_w, 5.5).addScaledVector(_g, -2.2);
        group.worldToLocal(sun.position.copy(_e));
        group.worldToLocal(sunTarget.position.copy(frame.planeWorld));
      }
    }

    if (ready.current === "applied") {
      ready.current = "done";
      onReadyRef.current?.();
    }
  }, -2);

  const activePin = activeZone ? pins.find((pin) => pin.zone === activeZone) : undefined;
  const impactPin = impact ? pins.find((pin) => pin.zone === impact.zoneId) : undefined;
  const previewPin = preview ? pins.find((pin) => pin.zone === preview.toZone) : undefined;
  const highlightPin = highlightZone ? pins.find((pin) => pin.zone === highlightZone) : undefined;
  const size3 = labelSize ?? R * 0.085;

  return (
    <group ref={root} {...group}>
      <group ref={tilt}>
        <group ref={spin}>
          <mesh geometry={sphereGeometry} material={material} scale={R} castShadow receiveShadow />
          {pins.map((pin) => (
            <group key={pin.zone} ref={(object) => { if (object) pinRefs.current.set(pin.zone, object); else pinRefs.current.delete(pin.zone); lists.current.dirty = true; }} position={pin.normal.clone().multiplyScalar(R)} quaternion={pin.quaternion} scale={R}>
              <mesh geometry={socketGeometry} material={brass} />
              <mesh geometry={pinGeometry} material={gold} />
              <mesh
                geometry={headGeometry}
                material={pin === destinationPin ? mats.seatHead : pin.zone === activeZone || pin.zone === previewPin?.zone || pin.zone === highlightZone ? mats.activeHead : gold}
                position={[0, 0.074, 0]}
              />
            </group>
          ))}
          {activePin && (
            <sprite ref={activeGlowRef} material={mats.glow} position={activePin.normal.clone().multiplyScalar(R * 1.074)} scale={R * 0.14} renderOrder={9.5} />
          )}
          {highlightPin && (
            <group ref={highlightRef} position={highlightPin.normal.clone().multiplyScalar(R * 1.003)} quaternion={highlightPin.quaternion} scale={R}>
              <mesh geometry={haloGeometry} material={mats.halo} renderOrder={4} />
              <sprite material={mats.highlightGlow} position={[0, 0.074, 0]} scale={0.15} renderOrder={9.5} />
            </group>
          )}
          {destinationPin && (
            <sprite ref={seatGlowRef} material={mats.seatGlow} position={destinationPin.normal.clone().multiplyScalar(R * 1.074)} scale={R * 0.16} renderOrder={9.5} />
          )}
          {impactPin && (
            <mesh ref={pulseRef} geometry={pulseGeometry} material={mats.pulse} position={impactPin.normal.clone().multiplyScalar(R * 1.004)} quaternion={impactPin.quaternion} scale={R} renderOrder={4} />
          )}
          {labels && fontsLoaded && pins.map((pin) => {
            const grade = (zoneGrades[pin.zone] ?? "C") as Grade;
            const variant: LabelVariant = pin === destinationPin ? "accent" : pin.zone === activeZone || pin.zone === highlightZone ? "active" : "idle";
            const texture = labelTexture(pin.zone, grade, variant, flight?.seatColor);
            const aspect = texture.image.width / texture.image.height;
            const height = size3 * (variant === "accent" ? texture.image.height / 96 : 1);
            const base: [number, number] = [height * aspect, height];
            return (
              <sprite
                key={`${pin.zone}-${grade}-${variant}`}
                ref={(sprite) => { if (sprite) { sprite.userData.base = base; labelRefs.current.set(pin.zone, sprite); } else labelRefs.current.delete(pin.zone); lists.current.dirty = true; }}
                position={pin.normal.clone().multiplyScalar(R * 1.1)}
                scale={[base[0], base[1], 1]}
                center={new THREE.Vector2(variant === "accent" ? -0.02 : -0.06, 0.5)}
                renderOrder={10}
              >
                <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
              </sprite>
            );
          })}
          {markerLayout.map(({ marker, position, quaternion }) => (
            <group
              key={marker.playerId}
              ref={(object) => { if (object) markerRefs.current.set(marker.playerId, object); else markerRefs.current.delete(marker.playerId); lists.current.dirty = true; }}
              position={position.clone().multiplyScalar(R)}
              quaternion={quaternion}
              scale={R}
            >
              <mesh geometry={gemGeometry} material={markerMaterial(marker.seatColor, marker.jailed ? "jailed" : marker.active ? "active" : "idle")} castShadow />
            </group>
          ))}
          <group scale={R}>
            {routes && <mesh geometry={routes.geometry} material={routes.material} renderOrder={6} />}
            {previewPlan && <mesh geometry={previewPlan.geometry} material={previewPlan.material} renderOrder={6} />}
            {lines && <primitive object={lines.grid} />}
            {lines && <primitive object={lines.coast} />}
            {sparks && <primitive object={sparks.points} />}
            {contrail && <primitive object={contrail.points} />}
            {clouds?.map((cloud, index) => <primitive key={index} object={cloud.mesh} />)}
            {plane && (
              <group ref={planeRef} visible={false}>
                <primitive object={plane.object} />
              </group>
            )}
            <mesh ref={touchdownRef} geometry={touchdownGeometry} material={mats.touchdown} visible={false} renderOrder={5} />
            {warmCloudMaterial && <mesh ref={warmCloudRef} geometry={cloudGeometry} material={warmCloudMaterial} scale={1e-4} visible={false} renderOrder={9.3} />}
            <sprite ref={flashRef} material={mats.flash} visible={false} renderOrder={13} />
          </group>
        </group>
        {rings && (
          <group ref={ringGroup}>
            <mesh geometry={equatorGeometry} material={mats.ringBrass} scale={R} />
            <group rotation={[0, 0, 23.44 * DEG]}>
              <group ref={ecliptic}>
                <mesh geometry={eclipticGeometry} material={mats.ringBrass} scale={R} />
                <primitive object={ticks} scale={R} />
              </group>
            </group>
          </group>
        )}
      </group>
      <mesh geometry={atmosphereGeometry} material={getAtmosphereMaterial()} scale={R * 1.012} renderOrder={9.2} />
      {rings && <mesh ref={meridian} geometry={meridianGeometry} material={mats.ringBrass} scale={R} rotation={[Math.PI / 2, 0.32, 0, "YXZ"]} />}
      {wantsPlane && <mesh ref={shroudRef} geometry={shroudGeometry} material={mats.shroud} scale={R * 1.62} visible={false} renderOrder={9} />}
      {wantsPlane && (
        <>
          <primitive object={sunTarget} />
          <directionalLight ref={sunRef} color="#ffe2b4" intensity={0} target={sunTarget} />
        </>
      )}
    </group>
  );
});

/**
 * Brass column and black lacquer foot for the globe (optional). The group sits
 * at the globe centre; `height` is the distance from the centre down to the floor.
 */
export function GlobeStand({ radius = 2.4, height = 3.2, quality = "high", ...group }: { radius?: number; height?: number; quality?: GlobeProps["quality"] } & ThreeElements["group"]) {
  const brass = pieceMaterial("brass", quality);
  const lacquer = pieceMaterial("lacquer", quality);
  const parts = useMemo(() => {
    const R = radius;
    const segments = quality === "low" ? 40 : 96;
    const footHeight = 0.07 * R;
    const floor = -height;
    const f0 = floor + footHeight;
    const top = -1.25 * R + 0.02 * R;
    const span = Math.max(0.2 * R, top - f0);
    const y = (fraction: number) => f0 + span * fraction;
    const profile = [
      [0, f0], [0.42 * R, f0], [0.43 * R, y(0.03)], [0.4 * R, y(0.07)], [0.3 * R, y(0.11)], [0.16 * R, y(0.18)], [0.075 * R, y(0.27)],
      [0.05 * R, y(0.36)], [0.048 * R, y(0.44)], [0.085 * R, y(0.5)], [0.048 * R, y(0.56)], [0.045 * R, y(0.8)], [0.075 * R, y(0.9)],
      [0.1 * R, y(0.97)], [0.06 * R, y(1)], [0, y(1)],
    ].map(([x, yy]) => new THREE.Vector2(x!, yy!));
    const column = new THREE.LatheGeometry(new THREE.SplineCurve(profile).getSpacedPoints(64), segments);
    const foot = new THREE.CylinderGeometry(0.5 * R, 0.52 * R, footHeight, segments).translate(0, floor + footHeight / 2, 0);
    const ring = new THREE.TorusGeometry(0.5 * R, 0.012 * R, 8, segments).rotateX(Math.PI / 2).translate(0, f0, 0);
    return { column, foot, ring };
  }, [radius, height, quality]);
  useEffect(() => () => { parts.column.dispose(); parts.foot.dispose(); parts.ring.dispose(); }, [parts]);
  return (
    <group {...group}>
      <mesh geometry={parts.column} material={brass} castShadow receiveShadow />
      <mesh geometry={parts.ring} material={brass} castShadow />
      <mesh geometry={parts.foot} material={lacquer} castShadow receiveShadow />
    </group>
  );
}
