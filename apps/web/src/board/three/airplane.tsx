/**
 * Procedural 1930s twin-engine airliner (Lockheed Electra / DC-3 feel) for the
 * travel cinematic. Presentation only.
 *
 * Polished aluminium monocoque with a drooped nose and upswept tail, cabin
 * windows, cockpit glazing and a gold cheatline (one canvas livery); a low
 * tapered wing with dihedral; two radial-engine nacelles with gold cowl lips
 * and spinners; three-blade propellers that blur into gold-tipped discs at
 * speed; Electra-style twin oval fins whose caps carry the fund's seat colour;
 * a taildragger undercarriage whose main wheels fold forward into the nacelles.
 *
 * Units: length 1 along +Z (nose at +Z), +Y up, wings along X (+X = port). The
 * origin is on the fuselage axis at the wing. Geometry is cached per detail
 * level ("low" = software / low tier: fewer segments). Each rig owns its
 * materials (the chrome environment map belongs to one renderer). Every
 * material renders in the transparent pass, so the aircraft draws over the
 * globe's floating labels.
 */
import { useEffect, useMemo } from "react";
import { useFrame, useThree, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pieceMaterial, type ObjectQuality } from "./materials";

type Detail = "high" | "low";
type V3 = [number, number, number];

/** Nominal dimensions at scale 1 (length 1). */
export const AIRPLANE = {
  length: 1,
  span: 1.43,
  /** From the origin (fuselage axis at the wing) down to the belly. */
  belly: 0.067,
  /** Highest point (fin caps) above the origin. */
  top: 0.107,
  /** Rear of the two nacelles: contrail emitters (local space). */
  exhausts: [[0.205, -0.016, -0.112], [-0.205, -0.016, -0.112]] as V3[],
  /** Ground contacts with the gear down (taildragger): main wheels and tail wheel. */
  mainWheel: { y: -0.118, z: 0.06 },
  tailWheel: { y: -0.042, z: -0.425 },
} as const;

export interface AirplaneRig {
  object: THREE.Group;
  /** Propellers: 0 = stopped (blades visible) … 1 = cruise (gold-tipped blur discs). */
  setThrottle(throttle: number, dt: number): void;
  /** Undercarriage: 1 = down, 0 = folded into the nacelles. */
  setGear(gear: number): void;
  /** Fund seat colour on the fin caps. */
  setSeatColor(color: string): void;
  /** Disposes the rig's materials (shared geometry stays cached). */
  dispose(): void;
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth01 = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const detailOf = (quality: ObjectQuality): Detail => (quality === "low" ? "low" : "high");

/** Fuselage centreline offset: slightly drooped nose, upswept tail cone. */
function camber(z: number) {
  return 0.028 * Math.pow(smooth01(-z / 0.5), 1.3) - 0.009 * smooth01((z - 0.3) / 0.2);
}

// =========================================================================
// Livery (fuselage colour map): u = around (0 belly, 0.25 +X, 0.5 top, 0.75 −X), v = z + 0.5
// =========================================================================
const liveryCache = new Map<Detail, THREE.CanvasTexture>();
const CABIN_CIRCUMFERENCE = 2 * Math.PI * 0.067;
const WINDOW_U = 0.046;

function liveryTexture(detail: Detail) {
  let texture = liveryCache.get(detail);
  if (texture) return texture;
  const W = detail === "low" ? 256 : 512;
  const H = detail === "low" ? 512 : 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d")!;
  const X = (u: number) => u * W;
  const Y = (z: number) => (0.5 - z) * H;
  const du = (length: number) => length / CABIN_CIRCUMFERENCE;

  // Polished skin: faint panel-to-panel tone changes, then riveted seams.
  c.fillStyle = "#f2f0eb";
  c.fillRect(0, 0, W, H);
  const seamsZ = [0.37, 0.24, 0.11, -0.02, -0.15, -0.28, -0.39];
  for (let i = 0; i < seamsZ.length - 1; i++) {
    c.fillStyle = i % 2 ? "rgba(255, 252, 246, 0.35)" : "rgba(196, 190, 180, 0.12)";
    c.fillRect(0, Y(seamsZ[i]!), W, Y(seamsZ[i + 1]!) - Y(seamsZ[i]!));
  }
  c.strokeStyle = "rgba(70, 63, 54, 0.22)";
  c.lineWidth = Math.max(1, H / 850);
  for (const z of seamsZ) { c.beginPath(); c.moveTo(0, Y(z)); c.lineTo(W, Y(z)); c.stroke(); }
  for (const u of [0.13, 0.37, 0.63, 0.87]) { c.beginPath(); c.moveTo(X(u), Y(0.43)); c.lineTo(X(u), Y(-0.46)); c.stroke(); }
  c.fillStyle = "rgba(70, 63, 54, 0.28)";
  for (const z of seamsZ) for (let u = 0.02; u < 1; u += 0.025) { c.beginPath(); c.arc(X(u), Y(z) + H / 500, Math.max(0.6, W / 700), 0, Math.PI * 2); c.fill(); }

  const glass = (x: number, y: number, w: number, h: number, r: number) => {
    const g = c.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#5a5752");
    g.addColorStop(0.35, "#1b1a18");
    g.addColorStop(1, "#0b0a09");
    c.fillStyle = g;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.fill();
    c.strokeStyle = "rgba(40, 36, 30, 0.6)";
    c.lineWidth = Math.max(1, W / 400);
    c.stroke();
  };
  // Cabin windows, seven a side, just above the side midline.
  const winAlong = 0.026 * H;
  const winAround = X(du(0.02));
  for (const side of [0.25 + WINDOW_U, 0.75 - WINDOW_U]) {
    for (const z of [0.24, 0.185, 0.13, 0.075, 0.02, -0.035, -0.09]) {
      glass(X(side) - winAround / 2, Y(z) - winAlong / 2, winAround, winAlong, Math.min(winAround, winAlong) * 0.28);
    }
  }
  // Cockpit glazing: split windscreen on the nose crown, side panes.
  const ws = du(0.048);
  glass(X(0.5 - ws), Y(0.452), X(ws) - W * 0.006, Y(0.402) - Y(0.452), W * 0.008);
  glass(X(0.5) + W * 0.006, Y(0.452), X(ws) - W * 0.006, Y(0.402) - Y(0.452), W * 0.008);
  for (const u of [0.5 - du(0.07), 0.5 + du(0.07) - du(0.024)]) glass(X(u), Y(0.41), X(du(0.024)), Y(0.37) - Y(0.41), W * 0.006);
  // Gold cheatlines: one bold band under the windows, a pinstripe above, tapering at both ends.
  const band = (u: number, thickness: number) => {
    const h = X(du(thickness));
    const z0 = 0.468, z1 = -0.452;
    c.fillStyle = "#d9b063";
    c.beginPath();
    c.moveTo(X(u), Y(z0));
    c.lineTo(X(u) + h / 2, Y(z0 - 0.05));
    c.lineTo(X(u) + h / 2, Y(z1 + 0.06));
    c.lineTo(X(u), Y(z1));
    c.lineTo(X(u) - h / 2, Y(z1 + 0.06));
    c.lineTo(X(u) - h / 2, Y(z0 - 0.05));
    c.closePath();
    c.fill();
  };
  band(0.25 + WINDOW_U - du(0.02), 0.0068);
  band(0.75 - WINDOW_U + du(0.02), 0.0068);
  band(0.25 + WINDOW_U + du(0.017), 0.0024);
  band(0.75 - WINDOW_U - du(0.017), 0.0024);
  // Cabin door outline (left side, aft).
  c.strokeStyle = "rgba(60, 54, 46, 0.5)";
  c.lineWidth = Math.max(1, W / 300);
  c.beginPath();
  c.roundRect(X(0.75 - WINDOW_U) - X(du(0.017)), Y(-0.15), X(du(0.036)), Y(-0.208) - Y(-0.15), W * 0.006);
  c.stroke();

  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  liveryCache.set(detail, texture);
  return texture;
}

/** Propeller blur: transparent hub, soft blade streaks, gold tip ring. */
let discTexture: THREE.CanvasTexture | null = null;
function propellerDiscTexture() {
  if (discTexture) return discTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1, dy = ((y + 0.5) / size) * 2 - 1;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const streak = 0.72 + 0.28 * Math.pow(0.5 + 0.5 * Math.cos(a * 3), 6);
      const body = smooth01((r - 0.16) / 0.16) * (1 - smooth01((r - 0.84) / 0.06)) * 0.42 * streak;
      const tip = smooth01((r - 0.84) / 0.03) * (1 - smooth01((r - 0.95) / 0.04));
      const alpha = Math.min(1, body + tip * 0.95);
      const i = (y * size + x) * 4;
      data[i] = 222 + 26 * tip;
      data[i + 1] = 218 - 12 * tip;
      data[i + 2] = 210 - 84 * tip;
      data[i + 3] = Math.round(255 * alpha);
    }
  }
  ctx.putImageData(image, 0, 0);
  discTexture = new THREE.CanvasTexture(canvas);
  discTexture.colorSpace = THREE.SRGBColorSpace;
  return discTexture;
}

// =========================================================================
// Chrome environment: soft studio panels, prefiltered once per renderer, so the
// polished metal always has bright shapes to reflect (never black or flat).
// =========================================================================
const environments = new WeakMap<THREE.WebGLRenderer, THREE.Texture | null>();

export function airplaneEnvironment(gl: THREE.WebGLRenderer | null | undefined): THREE.Texture | null {
  if (!gl) return null;
  if (environments.has(gl)) return environments.get(gl) ?? null;
  let texture: THREE.Texture | null = null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#17130f");
  const disposables: Array<{ dispose: () => void }> = [];
  const panel = (color: string, intensity: number, w: number, h: number, position: V3) => {
    const geometry = new THREE.PlaneGeometry(w, h);
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    disposables.push(geometry, material);
  };
  // Kept close to 1 so bloom only catches the glints, not the whole airframe.
  panel("#fff1dc", 1.9, 9, 2.2, [0, 6, 1.2]);
  panel("#fff4e6", 1.1, 10, 1.6, [0, 6.5, -3.5]);
  panel("#ffe7c2", 1.4, 5, 2.2, [-5.5, 2.4, 3.5]);
  panel("#f1f1ef", 1.15, 1.4, 7, [6, 1.5, -2.5]);
  panel("#efe9df", 0.9, 1.6, 6, [-6, 1.8, -3]);
  panel("#ffe9c8", 0.8, 3, 1.6, [4.5, 2.6, 4.5]);
  panel("#ffe2b0", 1.3, 18, 0.55, [0, 0.2, -7]);
  panel("#ffe2b0", 0.9, 18, 0.45, [0, -0.3, 7]);
  panel("#8a6a3a", 0.55, 14, 14, [0, -6, 0]);
  // One small, very bright "sun" kite for a crisp glint.
  panel("#fff6e8", 3.6, 0.7, 0.7, [-2.5, 5.5, -2]);
  try {
    const pmrem = new THREE.PMREMGenerator(gl);
    texture = pmrem.fromScene(scene, 0.035).texture;
    pmrem.dispose();
  } catch {
    texture = null;
  }
  for (const item of disposables) item.dispose();
  environments.set(gl, texture);
  return texture;
}

// =========================================================================
// Geometry
// =========================================================================
interface FoilPoint { x: number; yt: number; yc: number; side: 1 | -1 }
interface Station { s: number; le: number; chord: number; t: number; off: number; camber?: number }
type Place = (station: Station, x: number, y: number, out: THREE.Vector3) => void;

/** Closed NACA 24xx-style loop at unit chord: upper surface TE → LE, then lower LE → TE. */
function foilLoop(n: number): FoilPoint[] {
  const thickness = (x: number) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const meanLine = (x: number) => (x < 0.4 ? 0.125 * (0.8 * x - x * x) : (0.02 / 0.36) * (0.2 + 0.8 * x - x * x));
  const loop: FoilPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 + Math.cos((i / n) * Math.PI)) / 2;
    loop.push({ x, yt: thickness(x), yc: meanLine(x), side: 1 });
  }
  for (let i = 1; i < n; i++) {
    const x = (1 - Math.cos((i / n) * Math.PI)) / 2;
    loop.push({ x, yt: thickness(x), yc: meanLine(x), side: -1 });
  }
  return loop;
}

/**
 * Lofts an airfoil loop through span stations. Every triangle is oriented
 * outwards from its station's centroid, so `place` may use any axes.
 */
function loft(stations: Station[], loop: FoilPoint[], place: Place, capStart: boolean, capEnd: boolean) {
  const n = loop.length;
  const positions: number[] = [];
  const p = new THREE.Vector3();
  for (const station of stations) {
    for (const f of loop) {
      place(station, f.x, f.yc * (station.camber ?? 1) + f.side * f.yt * station.t, p);
      positions.push(p.x, p.y, p.z);
    }
  }
  const centroid = (ring: number) => {
    const c = new THREE.Vector3();
    for (let j = 0; j < n; j++) c.add(p.fromArray(positions, (ring * n + j) * 3));
    return c.divideScalar(n);
  };
  const centres = stations.map((_, i) => centroid(i));
  const index: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3(), g = new THREE.Vector3();
  const tri = (i0: number, i1: number, i2: number, ref: THREE.Vector3) => {
    a.fromArray(positions, i0 * 3); b.fromArray(positions, i1 * 3); c.fromArray(positions, i2 * 3);
    normal.subVectors(b, a).cross(g.subVectors(c, a));
    g.copy(a).add(b).add(c).divideScalar(3).sub(ref);
    if (normal.dot(g) < 0) index.push(i0, i2, i1);
    else index.push(i0, i1, i2);
  };
  const ref = new THREE.Vector3();
  for (let i = 0; i < stations.length - 1; i++) {
    ref.copy(centres[i]!).add(centres[i + 1]!).multiplyScalar(0.5);
    for (let j = 0; j < n; j++) {
      const q0 = i * n + j, q1 = i * n + ((j + 1) % n), q2 = (i + 1) * n + ((j + 1) % n), q3 = (i + 1) * n + j;
      tri(q0, q1, q2, ref);
      tri(q0, q2, q3, ref);
    }
  }
  const cap = (ring: number, inner: number) => {
    const centre = positions.length / 3;
    const ct = centres[ring]!;
    positions.push(ct.x, ct.y, ct.z);
    const inside = centres[inner]!;
    for (let j = 0; j < n; j++) tri(centre, ring * n + j, ring * n + ((j + 1) % n), inside);
  };
  if (capStart && stations.length > 1) cap(0, 1);
  if (capEnd && stations.length > 1) cap(stations.length - 1, stations.length - 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Mirror across X (flips the winding so faces stay outward). */
function mirrorX(source: THREE.BufferGeometry) {
  const geometry = source.clone();
  geometry.scale(-1, 1, 1);
  const index = geometry.getIndex();
  if (index) {
    const array = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < array.length; i += 3) { const t = array[i + 1]!; array[i + 1] = array[i + 2]!; array[i + 2] = t; }
    index.needsUpdate = true;
  }
  return geometry;
}

/** Merge parts sharing a material (position + normal only). */
function merge(parts: THREE.BufferGeometry[]) {
  const prepared = parts.map((source) => {
    const geometry = source.clone();
    for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    return geometry;
  });
  const indexed = prepared.every((geometry) => geometry.index);
  const list = indexed ? prepared : prepared.map((geometry) => (geometry.index ? geometry.toNonIndexed() : geometry));
  const merged = mergeGeometries(list, false) ?? new THREE.BufferGeometry();
  merged.computeBoundingSphere();
  return merged;
}

/** Lathe along +Z from a [z, r] profile ordered tail → nose. */
function latheZ(profile: Array<[number, number]>, segments: number, samples = 0) {
  let points = profile.map(([z, r]) => new THREE.Vector2(r, z));
  if (samples > 0) {
    const first = points[0]!.clone(), last = points[points.length - 1]!.clone();
    points = new THREE.SplineCurve(points).getSpacedPoints(samples);
    points[0] = first;
    points[points.length - 1] = last;
  }
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

const FUSELAGE: Array<[number, number]> = ([
  [-0.502, 0], [-0.5, 0.0035], [-0.49, 0.009], [-0.465, 0.0155], [-0.42, 0.0235], [-0.36, 0.0325], [-0.28, 0.0425], [-0.18, 0.0515],
  [-0.08, 0.0582], [0.02, 0.0617], [0.14, 0.063], [0.26, 0.0628], [0.33, 0.0612], [0.385, 0.0575], [0.425, 0.0515], [0.455, 0.0435],
  [0.476, 0.034], [0.49, 0.0235], [0.498, 0.012], [0.5, 0],
] as Array<[number, number]>).map(([z, r]) => [z, r * 1.07] as [number, number]);
/** Radial-engine nacelle: full cowl up front, short rounded tail ending at the wing's trailing edge. */
const NACELLE: Array<[number, number]> = [
  [-0.112, 0], [-0.106, 0.008], [-0.09, 0.0155], [-0.06, 0.0235], [-0.02, 0.0305], [0.03, 0.0365], [0.09, 0.042], [0.15, 0.0458],
  [0.2, 0.0472], [0.232, 0.0468], [0.245, 0.0448], [0.251, 0.041], [0.253, 0.034],
];
const SPINNER: Array<[number, number]> = [[0.247, 0], [0.2475, 0.0168], [0.256, 0.0164], [0.268, 0.0136], [0.278, 0.0088], [0.2835, 0.0034], [0.285, 0]];
const NACELLE_X = 0.205;
const NACELLE_Y = -0.018;
const PROP_Z = 0.262;
const PROP_RADIUS = 0.104;
const MAIN_HINGE: V3 = [0, -0.055, 0.1];
const MAIN_WHEEL_RADIUS = 0.024;
const GEAR_FOLD = -1.9;

interface AirplaneParts {
  fuselage: THREE.BufferGeometry;
  airframe: THREE.BufferGeometry;
  finCaps: THREE.BufferGeometry;
  engineFaces: THREE.BufferGeometry;
  gold: THREE.BufferGeometry;
  blades: THREE.BufferGeometry;
  bladeTips: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  mainStrut: THREE.BufferGeometry;
  mainWheel: THREE.BufferGeometry;
  tailStrut: THREE.BufferGeometry;
  tailWheel: THREE.BufferGeometry;
}
const partsCache = new Map<Detail, AirplaneParts>();

function fuselageGeometry(detail: Detail) {
  const geometry = latheZ(FUSELAGE, detail === "low" ? 14 : 36, detail === "low" ? 26 : 64);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    const slope = (camber(z + 1e-3) - camber(z - 1e-3)) / 2e-3;
    position.setY(i, position.getY(i) + camber(z));
    // Shear y += c(z): normals transform by the inverse transpose.
    n.set(normal.getX(i), normal.getY(i), normal.getZ(i) - slope * normal.getY(i)).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
    uv.setY(i, THREE.MathUtils.clamp(z + 0.5, 0, 1));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function wingGeometry(detail: Detail) {
  const loop = foilLoop(detail === "low" ? 5 : 12);
  const dihedral = Math.tan((5.5 * Math.PI) / 180);
  const root = 0.205, tip = 0.695;
  const stations: Station[] = [
    { s: 0.03, le: 0.118, chord: 0.255, t: 0.17, off: -0.036 },
    { s: root, le: 0.118, chord: 0.255, t: 0.16, off: -0.036 },
  ];
  const outer = detail === "low" ? [0.4, 0.75, 1] : [0.2, 0.4, 0.6, 0.8, 0.92, 1];
  for (const f of outer) {
    const s = root + f * (tip - root);
    stations.push({ s, le: 0.118 - f * 0.105, chord: 0.255 + (0.088 - 0.255) * f, t: 0.16 + (0.1 - 0.16) * f, off: -0.036 + (s - root) * dihedral });
  }
  // Rounded tip: chord shrinks about its forward third.
  const tipLe = 0.118 - 0.105;
  for (const [ds, k] of (detail === "low" ? [[0.012, 0.6], [0.018, 0.2]] : [[0.007, 0.84], [0.013, 0.6], [0.017, 0.3], [0.019, 0.1]]) as Array<[number, number]>) {
    const s = tip + ds;
    stations.push({ s, le: tipLe - 0.088 * (1 - k) * 0.32, chord: 0.088 * k, t: 0.1 * (0.5 + 0.5 * k), off: -0.036 + (s - root) * dihedral });
  }
  const right = loft(stations, loop, (st, x, y, out) => out.set(st.s, st.off + y * st.chord, st.le - x * st.chord), false, true);
  return [right, mirrorX(right)];
}

function tailGeometry(detail: Detail) {
  const loop = foilLoop(detail === "low" ? 4 : 9);
  const off = camber(-0.44);
  const stations: Station[] = [
    { s: 0, le: -0.355, chord: 0.13, t: 0.1, off, camber: 0 },
    { s: 0.09, le: -0.366, chord: 0.11, t: 0.095, off, camber: 0 },
    { s: 0.152, le: -0.378, chord: 0.088, t: 0.09, off, camber: 0 },
  ];
  for (const [ds, k] of (detail === "low" ? [[0.012, 0.5]] : [[0.006, 0.8], [0.011, 0.5], [0.0135, 0.2]]) as Array<[number, number]>) {
    stations.push({ s: 0.152 + ds, le: -0.378 - 0.088 * (1 - k) * 0.35, chord: 0.088 * k, t: 0.09, off, camber: 0 });
  }
  const right = loft(stations, loop, (st, x, y, out) => out.set(st.s, st.off + y * st.chord, st.le - x * st.chord), false, true);
  // Twin oval fins at the stabiliser tips; the caps (upper 45 %) carry the seat colour.
  const finX = 0.16;
  const chordAt = (h: number) => 0.078 * Math.sqrt(Math.max(0.05, 1 - ((h - 0.023) / 0.059) ** 2));
  const finStation = (h: number): Station => ({ s: h, le: -0.432 + chordAt(h) / 2, chord: chordAt(h), t: 0.09, off: 0, camber: 0 });
  const place: Place = (st, x, y, out) => out.set(finX + y * st.chord, off + st.s, st.le - x * st.chord);
  const lowerH = detail === "low" ? [-0.034, -0.016, 0.008, 0.03] : [-0.035, -0.03, -0.019, -0.004, 0.013, 0.03];
  const upperH = detail === "low" ? [0.03, 0.058, 0.08] : [0.03, 0.045, 0.058, 0.068, 0.0765, 0.081];
  const finLower = loft(lowerH.map(finStation), loop, place, true, false);
  const finUpper = loft(upperH.map(finStation), loop, place, false, true);
  return { stabiliser: [right, mirrorX(right)], fins: [finLower, mirrorX(finLower)], caps: [finUpper, mirrorX(finUpper)] };
}

/** One blade along +Y (root → tip), tapered, twisted, rounded tip. */
function bladeGeometry(t0: number, t1: number, segments: number) {
  const r0 = 0.012, r1 = PROP_RADIUS - 0.002;
  const geometry = new THREE.BoxGeometry(1, 1, 1, 1, segments, 1);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const t = t0 + (position.getY(i) + 0.5) * (t1 - t0);
    const roundTip = Math.sqrt(Math.max(0.04, 1 - smooth01((t - 0.82) / 0.18) ** 2));
    const chord = 0.019 * (0.62 + 0.55 * Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.85))) * roundTip;
    const thick = 0.0045 * (1 - 0.55 * t);
    const twist = 0.75 - 0.45 * t;
    const x = position.getX(i) * chord, z = position.getZ(i) * thick;
    position.setXYZ(i, x * Math.cos(twist) - z * Math.sin(twist), r0 + t * (r1 - r0), x * Math.sin(twist) + z * Math.cos(twist));
  }
  geometry.deleteAttribute("uv");
  geometry.computeVertexNormals();
  return geometry;
}

/** Strut between two points (cylinder). */
function strut(a: V3, b: V3, radius: number, segments: number) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const length = start.distanceTo(end);
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments, 1);
  geometry.translate(0, length / 2, 0);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  geometry.applyQuaternion(quaternion).translate(start.x, start.y, start.z);
  return geometry;
}

function wheel(radius: number, width: number, segments: number) {
  const tyre = new THREE.TorusGeometry(radius - width * 0.42, width * 0.5, 8, segments).rotateY(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 0.9, segments).rotateZ(Math.PI / 2);
  return merge([tyre, hub]);
}

function airplaneParts(detail: Detail): AirplaneParts {
  let parts = partsCache.get(detail);
  if (parts) return parts;
  const segments = detail === "low" ? 12 : 28;
  const fuselage = fuselageGeometry(detail);
  const wings = wingGeometry(detail);
  const tail = tailGeometry(detail);
  const nacelles = [NACELLE_X, -NACELLE_X].map((x) => latheZ(NACELLE, segments, detail === "low" ? 0 : 30).translate(x, NACELLE_Y, 0));
  const faces = [NACELLE_X, -NACELLE_X].map((x) => new THREE.CircleGeometry(0.036, segments).translate(x, NACELLE_Y, 0.247));
  const lips = [NACELLE_X, -NACELLE_X].map((x) => new THREE.TorusGeometry(0.0395, 0.0056, detail === "low" ? 6 : 10, segments + 4).translate(x, NACELLE_Y, 0.2505));
  const spinners = [NACELLE_X, -NACELLE_X].map((x) => latheZ(SPINNER, detail === "low" ? 10 : 20).translate(x, NACELLE_Y, 0.004));
  const bladeSegs = detail === "low" ? 3 : 6;
  const oneBlade = bladeGeometry(0, 0.86, bladeSegs);
  const oneTip = bladeGeometry(0.86, 1, 2);
  const three = (geometry: THREE.BufferGeometry) => merge([0, 1, 2].map((k) => geometry.clone().rotateZ((k * Math.PI * 2) / 3)));
  const wheelSegs = detail === "low" ? 10 : 20;
  // Main gear, relative to its hinge (axle 0.039 below, 0.04 aft).
  const axle: V3 = [0, -0.039, -0.04];
  const mainStrut = merge([strut([0.006, 0, 0], [0.006, axle[1], axle[2]], 0.0055, 8), strut([-0.006, 0, 0], [-0.006, axle[1], axle[2]], 0.0045, 8)]);
  const mainWheel = wheel(MAIN_WHEEL_RADIUS, 0.014, wheelSegs).translate(...axle);
  const tailStrut = strut([0, 0.004, -0.408], [0, -0.03, -0.425], 0.004, 8);
  const tailWheel = wheel(0.012, 0.008, wheelSegs).translate(0, -0.03, -0.425);
  parts = {
    fuselage,
    airframe: merge([...wings, ...tail.stabiliser, ...tail.fins, ...nacelles]),
    finCaps: merge(tail.caps),
    engineFaces: merge(faces),
    gold: merge([...lips, ...spinners]),
    blades: three(oneBlade),
    bladeTips: three(oneTip),
    disc: new THREE.CircleGeometry(PROP_RADIUS + 0.002, detail === "low" ? 24 : 48),
    mainStrut,
    mainWheel,
    tailStrut,
    tailWheel,
  };
  partsCache.set(detail, parts);
  return parts;
}

// =========================================================================
// Rig
// =========================================================================
export interface AirplaneOptions {
  renderOrder?: number;
  shadows?: boolean;
  /** Prefiltered environment for the chrome (see airplaneEnvironment); scene environment otherwise. */
  envMap?: THREE.Texture | null;
}

export function createAirplane(quality: ObjectQuality, options: AirplaneOptions = {}): AirplaneRig {
  const detail = detailOf(quality);
  const parts = airplaneParts(detail);
  const order = options.renderOrder ?? 0;
  const shadows = options.shadows ?? quality !== "low";
  const envMap = options.envMap ?? null;
  const root = new THREE.Group();
  root.name = "gf-airplane";
  const owned: THREE.Material[] = [];
  const own = <T extends THREE.Material>(material: T) => { material.transparent = true; owned.push(material); return material; };
  const metal = (params: THREE.MeshStandardMaterialParameters, clearcoat: number) => own(
    quality === "low"
      ? new THREE.MeshStandardMaterial({ ...params, envMap })
      : new THREE.MeshPhysicalMaterial({ ...params, clearcoat, clearcoatRoughness: 0.08, envMap }),
  );
  const envBoost = envMap ? 1 : 1.3;
  // Polished fuselage, satin wings and tail (flat polished panels would mirror the key light into bloom).
  const skin = metal({ color: "#ffffff", map: liveryTexture(detail), metalness: 1, roughness: 0.2, envMapIntensity: envBoost }, 0.45);
  const airframe = metal({ color: "#d6d1c9", metalness: 1, roughness: 0.42, envMapIntensity: envBoost * 0.72 }, 0.15);
  const gold = own((pieceMaterial("gold", quality) as THREE.MeshStandardMaterial).clone());
  gold.envMap = envMap;
  const engine = own(new THREE.MeshStandardMaterial({ color: "#151311", metalness: 0.7, roughness: 0.42, envMap }));
  const steel = metal({ color: "#d9d5ce", metalness: 1, roughness: 0.3, envMapIntensity: envBoost }, 0);
  const tyre = own(new THREE.MeshStandardMaterial({ color: "#16130f", metalness: 0, roughness: 0.78 }));
  const blade = own(new THREE.MeshStandardMaterial({ color: "#24211e", metalness: 0.65, roughness: 0.38, envMap }));
  const tip = own((pieceMaterial("gold", quality) as THREE.MeshStandardMaterial).clone());
  tip.envMap = envMap;
  const disc = own(new THREE.MeshBasicMaterial({ map: propellerDiscTexture(), opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  const seat = own(new THREE.MeshStandardMaterial({ color: "#d2ad66", metalness: 0.35, roughness: 0.3, envMap }));

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, castShadow: boolean, parent: THREE.Object3D = root, renderOrder = order) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadows && castShadow;
    mesh.receiveShadow = false;
    mesh.renderOrder = renderOrder;
    parent.add(mesh);
    return mesh;
  };
  add(parts.fuselage, skin, true);
  add(parts.airframe, airframe, true);
  add(parts.finCaps, seat, true);
  add(parts.engineFaces, engine, false);
  add(parts.gold, gold, true);
  add(parts.tailStrut, steel, false);
  add(parts.tailWheel, tyre, false);
  const gears = [NACELLE_X, -NACELLE_X].map((x) => {
    const hinge = new THREE.Group();
    hinge.position.set(x + MAIN_HINGE[0], MAIN_HINGE[1], MAIN_HINGE[2]);
    root.add(hinge);
    add(parts.mainStrut, steel, true, hinge);
    add(parts.mainWheel, tyre, true, hinge);
    return hinge;
  });
  const propellers = [NACELLE_X, -NACELLE_X].map((x) => {
    const hub = new THREE.Group();
    hub.position.set(x, NACELLE_Y, PROP_Z);
    root.add(hub);
    const spinning = new THREE.Group();
    hub.add(spinning);
    add(parts.blades, blade, false, spinning);
    add(parts.bladeTips, tip, false, spinning);
    const discMesh = add(parts.disc, disc, false, hub, order + 1);
    discMesh.position.z = 0.003;
    return { spinning, disc: discMesh };
  });

  let angle = Math.random() * Math.PI * 2;
  let discAngle = 0;
  let throttleNow = 0;
  return {
    object: root,
    setThrottle(throttle, dt) {
      // A little inertia: engines spool up and wind down.
      throttleNow += (clamp01(throttle) - throttleNow) * (1 - Math.exp(-dt * 6));
      const t = throttleNow;
      angle += (0.15 + 11 * t * t) * Math.PI * 2 * dt;
      discAngle += Math.PI * 2 * 0.85 * dt;
      const bladeOpacity = 1 - 0.94 * smooth01((t - 0.3) / 0.38);
      blade.opacity = bladeOpacity;
      tip.opacity = bladeOpacity;
      disc.opacity = 0.78 * smooth01((t - 0.26) / 0.42);
      for (let index = 0; index < propellers.length; index++) {
        const propeller = propellers[index]!;
        propeller.spinning.rotation.z = index === 0 ? angle : -angle;
        propeller.disc.rotation.z = index === 0 ? discAngle : -discAngle;
        propeller.disc.visible = disc.opacity > 0.01;
      }
    },
    setGear(gear) {
      const fold = (1 - smooth01(gear)) * GEAR_FOLD;
      for (let index = 0; index < gears.length; index++) gears[index]!.rotation.x = fold;
    },
    setSeatColor(color) {
      seat.color.set(color);
      seat.emissive.set(color).multiplyScalar(0.2);
    },
    dispose() {
      for (const material of owned) material.dispose();
    },
  };
}

/** React wrapper (studio / previews). */
export function Airplane({ quality = "high", throttle = 0, gear = 1, seatColor = "#d2ad66", ...group }: { quality?: ObjectQuality; throttle?: number; gear?: number; seatColor?: string } & ThreeElements["group"]) {
  const gl = useThree((state) => state.gl);
  const rig = useMemo(() => createAirplane(quality, { envMap: airplaneEnvironment(gl) }), [quality, gl]);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => rig.setSeatColor(seatColor), [rig, seatColor]);
  useEffect(() => rig.setGear(gear), [rig, gear]);
  useFrame((_, delta) => rig.setThrottle(throttle, Math.min(delta, 0.1)));
  return (
    <group {...group}>
      <primitive object={rig.object} />
    </group>
  );
}
