/**
 * Figurines — six sculpted chess-like pieces (presentation only).
 *
 * Units: one world unit ≈ one board edge-cell width. A figurine is ~1.05 units
 * tall at scale 1, base radius ~0.3, origin at the centre of its base (y = 0 is
 * the contact point with the board), facing +Z. Materials follow the piece
 * (PAWN_META); `seatColor` drives only the ring/halo so funds stay
 * distinguishable.
 *
 * Construction: a shared turned base (black lacquer, satin brass, seat ring)
 * and a hero top. Organic heads (lion, bull) are sculpted from signed distance
 * fields and meshed once with surface nets, with cavity occlusion baked into
 * vertex colours; the other pieces are hard-surface (lathe, extrusion, tubes).
 * Geometry and materials are cached at module level and shared by every
 * instance; nothing is allocated per frame.
 */
import { memo, useEffect, useMemo, useReducer, useRef } from "react";
import { useFrame, useThree, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PawnId } from "@global-fund/shared";
import { usePresentationSettings } from "../../presentation/settings";
import {
  desaturate, glowMaterial, loadLandRings, pieceMaterial, seatRingMaterial, traceLand,
  type ObjectQuality, type PieceMaterialKey, type SeatRingMode,
} from "./materials";

export interface PawnModelProps {
  /** Piece id (named `piece`: Object3D already owns a numeric `id`). */
  piece: PawnId;
  /** Seat colour (PLAYER_COLORS) for the base ring / halo. */
  seatColor?: string;
  /** Detained funds read as dimmed / desaturated pieces. */
  jailed?: boolean;
  /** The fund whose turn it is: halo ring glows. */
  active?: boolean;
  /** Quality hint: "low" must avoid transmission / heavy materials. */
  quality?: "high" | "medium" | "low";
  /** Freeze the halo pulse (defaults to the in-app / OS reduced-motion setting). */
  reducedMotion?: boolean;
  /** Draw the soft ground halo of the active piece (default true). */
  halo?: boolean;
}

/** Nominal figurine dimensions (world units, scale 1). */
export const PAWN_DIMENSIONS = { height: 1.05, baseRadius: 0.3, ringY: 0.0705 } as const;
export const PAWN_IDS: PawnId[] = ["lion", "bull", "globe", "crystal", "tower", "leaf"];

type V3 = [number, number, number];
type Detail = "high" | "low";
interface PiecePart { geometry: THREE.BufferGeometry; material: PieceMaterialKey | "globeBall"; shadow: boolean }

// =========================================================================
// Signed distance sculpting
// =========================================================================
type Sdf = (x: number, y: number, z: number) => number;
interface Prim { f: Sdf; b: [number, number, number, number] }
interface SculptNode { f: Sdf; cx: number; cy: number; cz: number; r: number; k: number; cut: boolean }

const smin = (a: number, b: number, k: number) => {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - h * h * k * 0.25;
};

function sphere(c: V3, r: number): Prim {
  const [cx, cy, cz] = c;
  return { f: (x, y, z) => { const dx = x - cx, dy = y - cy, dz = z - cz; return Math.sqrt(dx * dx + dy * dy + dz * dz) - r; }, b: [cx, cy, cz, r] };
}

function ellipsoid(c: V3, r: V3, rot: V3 = [0, 0, 0]): Prim {
  const e = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])).invert().elements;
  const [cx, cy, cz] = c;
  const [ra, rb, rc] = r;
  const ia2 = 1 / (ra * ra), ib2 = 1 / (rb * rb), ic2 = 1 / (rc * rc);
  const inner = -Math.min(ra, rb, rc);
  return {
    f: (x, y, z) => {
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const lx = e[0]! * dx + e[4]! * dy + e[8]! * dz;
      const ly = e[1]! * dx + e[5]! * dy + e[9]! * dz;
      const lz = e[2]! * dx + e[6]! * dy + e[10]! * dz;
      const k0 = Math.sqrt(lx * lx * ia2 + ly * ly * ib2 + lz * lz * ic2);
      const k1 = Math.sqrt(lx * lx * ia2 * ia2 + ly * ly * ib2 * ib2 + lz * lz * ic2 * ic2);
      return k1 < 1e-9 ? inner : (k0 * (k0 - 1)) / k1;
    },
    b: [cx, cy, cz, Math.max(ra, rb, rc)],
  };
}

function capsule(a: V3, b: V3, r: number): Prim {
  const [ax, ay, az] = a;
  const bx = b[0] - ax, by = b[1] - ay, bz = b[2] - az;
  const bb = bx * bx + by * by + bz * bz;
  return {
    f: (x, y, z) => {
      const px = x - ax, py = y - ay, pz = z - az;
      let h = (px * bx + py * by + pz * bz) / bb;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const dx = px - bx * h, dy = py - by * h, dz = pz - bz * h;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
    },
    b: [(ax + b[0]) / 2, (ay + b[1]) / 2, (az + b[2]) / 2, Math.sqrt(bb) / 2 + r],
  };
}

/** Exact round cone between two spheres (Inigo Quilez). */
function roundCone(a: V3, b: V3, r1: number, r2: number): Prim {
  const [ax, ay, az] = a;
  const bx = b[0] - ax, by = b[1] - ay, bz = b[2] - az;
  const l2 = bx * bx + by * by + bz * bz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const srr = Math.sign(rr);
  return {
    f: (x, y, z) => {
      const px = x - ax, py = y - ay, pz = z - az;
      const yy = px * bx + py * by + pz * bz;
      const zz = yy - l2;
      const qx = px * l2 - bx * yy, qy = py * l2 - by * yy, qz = pz * l2 - bz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = srr * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    },
    b: [(ax + b[0]) / 2, (ay + b[1]) / 2, (az + b[2]) / 2, Math.sqrt(l2) / 2 + Math.max(r1, r2)],
  };
}

/** Ordered smooth CSG. Bounding spheres skip primitives that cannot change the result. */
class Sculpt {
  readonly nodes: SculptNode[] = [];
  floorY = -Infinity;
  add(prim: Prim, k = 0.012) { this.push(prim, k, false); return this; }
  cut(prim: Prim, k = 0.006) { this.push(prim, k, true); return this; }
  private push(prim: Prim, k: number, cut: boolean) {
    const [cx, cy, cz, r] = prim.b;
    this.nodes.push({ f: prim.f, cx, cy, cz, r: r * 1.02 + 1e-4, k, cut });
  }
  /** Evaluates a (spatially pre-filtered, order-preserving) subset of the nodes. */
  evaluateWith(nodes: SculptNode[], x: number, y: number, z: number) {
    let d = 1e9;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const dx = x - n.cx, dy = y - n.cy, dz = z - n.cz;
      const bound = Math.sqrt(dx * dx + dy * dy + dz * dz) - n.r;
      if (n.cut) {
        if (bound >= n.k - d) continue;
        d = -smin(-d, n.f(x, y, z), n.k);
      } else {
        if (bound - n.k >= d) continue;
        d = smin(d, n.f(x, y, z), n.k);
      }
    }
    const floor = this.floorY - y;
    return floor > d ? floor : d;
  }
  readonly evaluate: Sdf = (x, y, z) => this.evaluateWith(this.nodes, x, y, z);
  /** Nodes whose bounds come within `radius` (plus their blend radius) of a point. */
  near(x: number, y: number, z: number, radius: number) {
    return this.nodes.filter((n) => Math.sqrt((x - n.cx) ** 2 + (y - n.cy) ** 2 + (z - n.cz) ** 2) - n.r < radius + n.k);
  }
}

const CORNERS: V3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES: Array<[number, number]> = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

interface MeshOptions { aoStep: number; aoStrength: number; cavity: number }

/**
 * Naive surface nets over a narrow band, then one Newton projection onto the
 * surface, analytic-gradient normals and baked cavity occlusion (vertex colour).
 */
function meshSdf(sculpt: Sculpt, min: V3, max: V3, h: number, options: MeshOptions): THREE.BufferGeometry {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const values = new Float32Array(nx * ny * nz).fill(NaN);
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const positions: number[] = [];
  const cells: number[] = [];
  const corner = new Float64Array(8);
  const [ox, oy, oz] = min;

  // Blocks of B³ cells, each with the short list of nodes that can matter near it.
  const B = 4;
  const bx = Math.ceil(cx / B), by = Math.ceil(cy / B), bz = Math.ceil(cz / B);
  const blockRadius = (B * h * Math.sqrt(3)) / 2;
  const reach = blockRadius + 2.5 * h;
  const margin = options.aoStep * 10 + 2 * h;
  const blockDistance = new Float32Array(bx * by * bz).fill(NaN);
  const blockNodes: Array<SculptNode[] | undefined> = new Array(bx * by * bz);
  const blockCentre = (bi: number, bj: number, bk: number): V3 => [ox + (bi * B + B / 2) * h, oy + (bj * B + B / 2) * h, oz + (bk * B + B / 2) * h];
  const blockIndex = (i: number, j: number, k: number) => Math.min(bx - 1, Math.floor(i / B)) + bx * (Math.min(by - 1, Math.floor(j / B)) + by * Math.min(bz - 1, Math.floor(k / B)));
  const distanceOfBlock = (b: number) => {
    let d = blockDistance[b]!;
    if (d !== d) {
      const bi = b % bx, bj = Math.floor(b / bx) % by, bk = Math.floor(b / (bx * by));
      d = sculpt.evaluate(...blockCentre(bi, bj, bk));
      blockDistance[b] = d;
    }
    return d;
  };
  const blockNodesWide: Array<SculptNode[] | undefined> = new Array(bx * by * bz);
  const nodesOfBlock = (b: number, wide = false) => {
    const store = wide ? blockNodesWide : blockNodes;
    let list = store[b];
    if (!list) {
      const bi = b % bx, bj = Math.floor(b / bx) % by, bk = Math.floor(b / (bx * by));
      const [x, y, z] = blockCentre(bi, bj, bk);
      list = sculpt.near(x, y, z, Math.abs(distanceOfBlock(b)) + 2 * blockRadius + (wide ? margin : 3 * h));
      store[b] = list;
    }
    return list;
  };
  const sdfNear = (i: number, j: number, k: number, x: number, y: number, z: number) => sculpt.evaluateWith(nodesOfBlock(blockIndex(i, j, k)), x, y, z);

  const sample = (i: number, j: number, k: number) => {
    const index = i + nx * (j + ny * k);
    let v = values[index]!;
    if (v !== v) {
      v = sdfNear(i, j, k, ox + i * h, oy + j * h, oz + k * h);
      values[index] = v;
    }
    return v;
  };

  const vertexAt = (i: number, j: number, k: number): number => {
    if (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz) return -1;
    const cell = i + cx * (j + cy * k);
    const known = cellVertex[cell]!;
    if (known !== -1) return known;
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const o = CORNERS[c]!;
      const v = sample(i + o[0], j + o[1], k + o[2]);
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) { cellVertex[cell] = -2; return -2; }
    let sx = 0, sy = 0, sz = 0, count = 0;
    for (const [a, b] of EDGES) {
      if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
      const va = corner[a]!, vb = corner[b]!;
      const t = va / (va - vb);
      const pa = CORNERS[a]!, pb = CORNERS[b]!;
      sx += pa[0] + (pb[0] - pa[0]) * t;
      sy += pa[1] + (pb[1] - pa[1]) * t;
      sz += pa[2] + (pb[2] - pa[2]) * t;
      count++;
    }
    const index = positions.length / 3;
    positions.push(ox + (i + sx / count) * h, oy + (j + sy / count) * h, oz + (k + sz / count) * h);
    cells.push(i, j, k);
    cellVertex[cell] = index;
    return index;
  };

  // Coarse pass: only blocks that can contain the surface are refined.
  for (let bk = 0; bk < bz; bk++) {
    for (let bj = 0; bj < by; bj++) {
      for (let bi = 0; bi < bx; bi++) {
        const d = distanceOfBlock(bi + bx * (bj + by * bk));
        if (Math.abs(d) > reach) continue;
        for (let k = bk * B; k < Math.min(cz, bk * B + B); k++)
          for (let j = bj * B; j < Math.min(cy, bj * B + B); j++)
            for (let i = bi * B; i < Math.min(cx, bi * B + B); i++) vertexAt(i, j, k);
      }
    }
  }

  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, outward: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (!outward) { const t = b; b = d; d = t; }
    const ac = (positions[a * 3]! - positions[c * 3]!) ** 2 + (positions[a * 3 + 1]! - positions[c * 3 + 1]!) ** 2 + (positions[a * 3 + 2]! - positions[c * 3 + 2]!) ** 2;
    const bd = (positions[b * 3]! - positions[d * 3]!) ** 2 + (positions[b * 3 + 1]! - positions[d * 3 + 1]!) ** 2 + (positions[b * 3 + 2]! - positions[d * 3 + 2]!) ** 2;
    if (ac <= bd) indices.push(a, b, c, a, c, d);
    else indices.push(b, c, d, b, d, a);
  };
  for (let n = 0; n < cells.length / 3; n++) {
    const i = cells[n * 3]!, j = cells[n * 3 + 1]!, k = cells[n * 3 + 2]!;
    const inside = sample(i, j, k) < 0;
    if (j > 0 && k > 0 && (sample(i + 1, j, k) < 0) !== inside) quad(vertexAt(i, j - 1, k - 1), vertexAt(i, j, k - 1), vertexAt(i, j, k), vertexAt(i, j - 1, k), inside);
    if (i > 0 && k > 0 && (sample(i, j + 1, k) < 0) !== inside) quad(vertexAt(i - 1, j, k - 1), vertexAt(i - 1, j, k), vertexAt(i, j, k), vertexAt(i, j, k - 1), inside);
    if (i > 0 && j > 0 && (sample(i, j, k + 1) < 0) !== inside) quad(vertexAt(i - 1, j - 1, k), vertexAt(i, j - 1, k), vertexAt(i, j, k), vertexAt(i - 1, j, k), inside);
  }

  // Projection, normals and cavity occlusion.
  const count = positions.length / 3;
  const pos = new Float32Array(positions);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const e = h * 0.3;
  let list: SculptNode[] = sculpt.nodes;
  const sdf = (x: number, y: number, z: number) => sculpt.evaluateWith(list, x, y, z);
  // Tetrahedral central difference: 4 evaluations, also returns the distance.
  const grad = (x: number, y: number, z: number, out: Float64Array) => {
    const a = sdf(x + e, y - e, z - e);
    const b = sdf(x - e, y - e, z + e);
    const c = sdf(x - e, y + e, z - e);
    const d = sdf(x + e, y + e, z + e);
    out[0] = a - b - c + d;
    out[1] = -a - b + c + d;
    out[2] = -a + b - c + d;
    const len = Math.hypot(out[0]!, out[1]!, out[2]!) || 1;
    out[0]! /= len; out[1]! /= len; out[2]! /= len;
    return (a + b + c + d) * 0.25;
  };
  const g = new Float64Array(3);
  const { aoStep, aoStrength, cavity } = options;
  for (let v = 0; v < count; v++) {
    const block = blockIndex(cells[v * 3]!, cells[v * 3 + 1]!, cells[v * 3 + 2]!);
    list = nodesOfBlock(block);
    let x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
    const d = grad(x, y, z, g);
    const step = Math.max(-h, Math.min(h, d));
    x -= g[0]! * step; y -= g[1]! * step; z -= g[2]! * step;
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    grad(x, y, z, g);
    nor[v * 3] = g[0]!; nor[v * 3 + 1] = g[1]!; nor[v * 3 + 2] = g[2]!;
    list = nodesOfBlock(block, true);
    let occlusion = 0;
    let weight = 1;
    for (let s = 1; s <= 4; s++) {
      const dist = aoStep * s;
      occlusion += weight * Math.max(0, dist - sdf(x + g[0]! * dist, y + g[1]! * dist, z + g[2]! * dist));
      weight *= 0.72;
    }
    const ao = Math.max(0, Math.min(1, 1 - (aoStrength * occlusion) / aoStep));
    const shade = cavity + (1 - cavity) * Math.pow(ao, 1.35);
    col[v * 3] = shade; col[v * 3 + 1] = shade; col[v * 3 + 2] = shade;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geometry.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

// =========================================================================
// Hard-surface helpers
// =========================================================================
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Smooth lathe profile through control points [radius, y] (bottom → top). */
function lathe(points: Array<[number, number]>, segments: number, smooth = 0) {
  let profile = points.map(([r, y]) => new THREE.Vector2(r, y));
  if (smooth > 0) profile = new THREE.SplineCurve(profile).getSpacedPoints(smooth);
  return new THREE.LatheGeometry(profile, segments);
}

function transform(geometry: THREE.BufferGeometry, position: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) {
  const matrix = new THREE.Matrix4().compose(v3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), v3(...scale));
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** Merge parts that share a material (position + normal, and colour when every part has one). */
function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const indexed = geometries.every((geometry) => geometry.index);
  const coloured = geometries.every((geometry) => geometry.getAttribute("color"));
  const prepared = geometries.map((source) => {
    const geometry = indexed ? source.clone() : source.index ? source.toNonIndexed() : source.clone();
    for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal" && !(coloured && name === "color")) geometry.deleteAttribute(name);
    return geometry;
  });
  const merged = mergeGeometries(prepared, false) ?? new THREE.BufferGeometry();
  merged.computeBoundingSphere();
  return merged;
}

/** Tube with a varying radius along a Catmull-Rom curve, closed with a tip cap. */
function taperedTube(points: THREE.Vector3[], radius: (t: number) => number, tubular: number, radial: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const frames = curve.computeFrenetFrames(tubular, false);
  const length = curve.getLength();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, p);
    const r = radius(t);
    const slope = (radius(Math.min(1, t + 0.002)) - radius(Math.max(0, t - 0.002))) / (0.004 * length);
    const N = frames.normals[i]!, B = frames.binormals[i]!, T = frames.tangents[i]!;
    for (let j = 0; j <= radial; j++) {
      const angle = (j / radial) * Math.PI * 2;
      const c = -Math.cos(angle), s = Math.sin(angle);
      n.set(c * N.x + s * B.x, c * N.y + s * B.y, c * N.z + s * B.z);
      positions.push(p.x + r * n.x, p.y + r * n.y, p.z + r * n.z);
      n.addScaledVector(T, -slope).normalize();
      normals.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j, c = b + 1, d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  // Tip cap.
  const tip = positions.length / 3;
  const end = curve.getPointAt(1);
  const tangent = frames.tangents[tubular]!;
  positions.push(end.x + tangent.x * radius(1), end.y + tangent.y * radius(1), end.z + tangent.z * radius(1));
  normals.push(tangent.x, tangent.y, tangent.z);
  const last = tubular * (radial + 1);
  for (let j = 0; j < radial; j++) indices.push(tip, last + j + 1, last + j);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function torus(radius: number, tube: number, y: number, detail: Detail, radialSegments = 12) {
  return transform(new THREE.TorusGeometry(radius, tube, detail === "low" ? 8 : radialSegments, detail === "low" ? 48 : 112), [0, y, 0], [Math.PI / 2, 0, 0]);
}

// =========================================================================
// Shared turned base
// =========================================================================
const BASE_TOP = 0.277;
const baseCache = new Map<Detail, PiecePart[]>();

function basePartsFor(detail: Detail): PiecePart[] {
  let parts = baseCache.get(detail);
  if (parts) return parts;
  const seg = detail === "low" ? 40 : 96;
  const foot = lathe([[0, 0], [0.27, 0], [0.293, 0.002], [0.302, 0.008], [0.304, 0.014], [0.301, 0.02], [0.292, 0.025], [0.282, 0.026]], seg);
  const plinth = lathe([[0.284, 0.025], [0.29, 0.031], [0.291, 0.045], [0.287, 0.056], [0.277, 0.064], [0.266, 0.068]], seg, 18);
  const body = lathe([[0.257, 0.068], [0.263, 0.077], [0.252, 0.088], [0.226, 0.097], [0.193, 0.106], [0.163, 0.12], [0.139, 0.142], [0.121, 0.171], [0.111, 0.2], [0.106, 0.226]], seg, 44);
  const collar = torus(0.111, 0.0125, 0.234, detail);
  const cup = lathe([[0.098, 0.242], [0.11, 0.247], [0.13, 0.255], [0.144, 0.263], [0.148, 0.27], [0.142, 0.275], [0.115, 0.277], [0, BASE_TOP]], seg, 22);
  parts = [
    { geometry: merge([foot, collar, cup]), material: "brass", shadow: true },
    { geometry: merge([plinth, body]), material: "lacquer", shadow: true },
  ];
  baseCache.set(detail, parts);
  return parts;
}

const ringGeometryCache = new Map<Detail, THREE.BufferGeometry>();
function ringGeometry(detail: Detail) {
  let geometry = ringGeometryCache.get(detail);
  if (!geometry) {
    geometry = torus(0.262, 0.0105, PAWN_DIMENSIONS.ringY, detail, 14);
    ringGeometryCache.set(detail, geometry);
  }
  return geometry;
}
let haloGeometry: THREE.BufferGeometry | null = null;
function getHaloGeometry() {
  if (!haloGeometry) haloGeometry = transform(new THREE.PlaneGeometry(1.36, 1.36), [0, 0.004, 0], [-Math.PI / 2, 0, 0]);
  return haloGeometry;
}

// =========================================================================
// Hero tops
// =========================================================================
const sculptStep = (detail: Detail) => (detail === "low" ? 0.0105 : 0.0062);

function eyePair(left: V3, radius: number, detail: Detail) {
  const seg = detail === "low" ? 10 : 20;
  const a = transform(new THREE.SphereGeometry(radius, seg, Math.round(seg * 0.7)), left);
  const b = transform(new THREE.SphereGeometry(radius, seg, Math.round(seg * 0.7)), [-left[0], left[1], left[2]]);
  return merge([a, b]);
}

/**
 * Faceted mane blade along +Y: rhombic section tapering to a point, the tip
 * curling towards -Z. Non-indexed so every facet stays crisp.
 */
function blade(length: number, width: number, thickness: number, curl: number, segments: number) {
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t * length;
    const z = -length * 0.32 * curl * t * t;
    const taper = Math.pow(1 - t, 0.78);
    const w = width * taper * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, t * 1.6)));
    const h = thickness * taper;
    rings.push([v3(w, y, z), v3(0, y, z + h), v3(-w, y, z), v3(0, y, z - h)]);
  }
  const positions: number[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < segments; i++) {
    const a = rings[i]!, b = rings[i + 1]!;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      if (i === segments - 1) push(a[k]!, a[k2]!, b[k]!);
      else { push(a[k]!, a[k2]!, b[k2]!); push(a[k]!, b[k2]!, b[k]!); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildLion(detail: Detail): PiecePart[] {
  const S = 1.1;
  const H: V3 = [0, 0.668, 0.03];
  const at = (x: number, y: number, z: number): V3 => [H[0] + x * S, H[1] + y * S, H[2] + z * S];
  const r = (value: number) => value * S;
  const polar = (radius: number, angle: number, z: number): V3 => at(Math.sin(angle) * radius, Math.cos(angle) * radius * 1.04, z);
  const s = new Sculpt();
  s.floorY = BASE_TOP - 0.012;
  const cupY = (BASE_TOP - H[1]) / S - 0.02;

  // Ruff: one cohesive volume with a scalloped rim, cascading down the back to the cup.
  s.add(ellipsoid(at(0, -0.008, -0.058), [r(0.166), r(0.172), r(0.098)]), 0);
  s.add(roundCone(at(0, -0.06, -0.085), at(0, cupY + 0.01, -0.045), r(0.138), r(0.13)), r(0.05));
  s.add(ellipsoid(at(0, -0.215, 0.03), [r(0.105), r(0.11), r(0.085)]), r(0.05));
  for (let n = 0; n < 18; n++) {
    const theta = (n / 18) * Math.PI * 2;
    const beard = Math.max(0, -Math.cos(theta));
    s.add(ellipsoid(polar(0.158 + 0.02 * beard, theta, -0.04 + 0.01 * beard), [r(0.043), r(0.031), r(0.034)], [0, 0, -theta]), r(0.02));
  }
  for (const [row, y, count, radius] of [[0, -0.115, 10, 0.152], [1, -0.215, 9, 0.142]] as const) {
    for (let n = 0; n < count; n++) {
      const phi = Math.PI * (0.32 + (1.36 * (n + row * 0.5)) / (count - 1 + row));
      s.add(sphere(at(Math.sin(phi) * radius, y, Math.cos(phi) * radius * 0.86 - 0.072), r(0.037)), r(0.024));
    }
  }

  // Feline face.
  s.add(ellipsoid(at(0, 0.014, -0.006), [r(0.1), r(0.104), r(0.096)]), r(0.02));
  for (const side of [-1, 1]) s.add(sphere(at(side * 0.055, -0.036, 0.055), r(0.06)), r(0.028));
  s.add(ellipsoid(at(0, -0.054, 0.098), [r(0.066), r(0.053), r(0.058)]), r(0.028));
  for (const side of [-1, 1]) s.add(sphere(at(side * 0.033, -0.066, 0.136), r(0.038)), r(0.012));
  s.add(ellipsoid(at(0, -0.116, 0.088), [r(0.036), r(0.027), r(0.032)]), r(0.018));
  s.add(roundCone(at(0, 0.04, 0.1), at(0, -0.017, 0.153), r(0.027), r(0.032)), r(0.018));
  s.add(ellipsoid(at(0, -0.026, 0.173), [r(0.034), r(0.021), r(0.021)]), r(0.01));
  for (const side of [-1, 1]) s.add(capsule(at(side * 0.013, 0.05, 0.113), at(side * 0.072, 0.042, 0.082), r(0.018)), r(0.015));
  for (const side of [-1, 1]) s.add(roundCone(at(side * 0.094, 0.1, 0.02), at(side * 0.112, 0.136, 0.012), r(0.03), r(0.014)), r(0.012));

  // Carving: swirling grooves between the locks, ears, eyes, mouth.
  for (let n = 0; n < 18; n++) {
    const theta = ((n + 0.5) / 18) * Math.PI * 2;
    const swirl = n % 2 ? 0.22 : -0.22;
    s.cut(roundCone(polar(0.104, theta, 0.045), polar(0.15, theta + swirl * 0.5, 0.0), r(0.0065), r(0.0075)), r(0.006));
    s.cut(roundCone(polar(0.15, theta + swirl * 0.5, 0.0), polar(0.19, theta + swirl, -0.07), r(0.0075), r(0.0085)), r(0.006));
  }
  for (let n = 0; n < 11; n++) {
    const phi = Math.PI * (0.36 + (1.28 * n) / 10);
    s.cut(roundCone(at(Math.sin(phi) * 0.15, -0.04, Math.cos(phi) * 0.11 - 0.08), at(Math.sin(phi) * 0.14, cupY + 0.04, Math.cos(phi) * 0.12 - 0.05), r(0.0065), r(0.006)), r(0.006));
  }
  for (const side of [-1, 1]) s.cut(sphere(at(side * 0.113, 0.136, 0.03), r(0.012)), r(0.006));
  for (const side of [-1, 1]) s.cut(sphere(at(side * 0.048, 0.019, 0.118), r(0.02)), r(0.008));
  s.cut(capsule(at(-0.04, -0.097, 0.127), at(0.04, -0.097, 0.127), r(0.0055)), r(0.004));
  s.cut(capsule(at(0, -0.047, 0.172), at(0, -0.08, 0.167), r(0.0042)), r(0.003));

  const head = meshSdf(s, [-0.26, BASE_TOP - 0.025, -0.25], [0.26, 0.92, 0.27], sculptStep(detail) * 1.08, { aoStep: 0.007, aoStrength: 0.42, cavity: 0.16 });
  const eyes = eyePair(at(0.048, 0.018, 0.112), r(0.0148), detail);

  // Crown: a flared band with five pearl-tipped points, set back on the mane.
  const seg = detail === "low" ? 28 : 64;
  const crownParts: THREE.BufferGeometry[] = [];
  const band = lathe([[0.074, 0.0], [0.08, 0.004], [0.083, 0.016], [0.09, 0.034], [0.094, 0.04], [0.088, 0.044], [0.078, 0.022], [0.07, 0.004]], seg);
  crownParts.push(band);
  crownParts.push(transform(new THREE.TorusGeometry(0.079, 0.0045, 8, seg), [0, 0.006, 0], [Math.PI / 2, 0, 0]));
  for (let n = 0; n < 5; n++) {
    const angle = (n / 5) * Math.PI * 2;
    const x = Math.sin(angle) * 0.088, z = Math.cos(angle) * 0.088;
    crownParts.push(transform(new THREE.ConeGeometry(0.019, 0.05, 4, 1), [x, 0.064, z], [0.12 * Math.cos(angle), angle + Math.PI / 4, -0.12 * Math.sin(angle)]));
    crownParts.push(transform(new THREE.SphereGeometry(0.0105, 14, 10), [x * 1.03, 0.094, z * 1.03]));
  }
  const crown = merge(crownParts);
  const crownCentre = at(0, 0.138, -0.035);
  transform(crown, crownCentre, [-0.32, 0, 0], [S * 1.16, S * 1.16, S * 1.16]);
  const jewels = merge([0, 1, 2].map((n) => transform(new THREE.SphereGeometry(0.0085, 12, 8), [0, 0.022, 0.0865], [0, 0, 0])).map((g, n) => {
    const angle = (n - 1) * 0.62;
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(angle));
    return g;
  }));
  transform(jewels, crownCentre, [-0.32, 0, 0], [S * 1.16, S * 1.16, S * 1.16]);
  return [
    { geometry: head, material: "goldSculpt", shadow: true },
    { geometry: crown, material: "gold", shadow: true },
    { geometry: jewels, material: "ruby", shadow: false },
    { geometry: eyes, material: "onyx", shadow: false },
  ];
}

function buildBull(detail: Detail): PiecePart[] {
  const S = 1.1;
  const H: V3 = [0, 0.672, 0.03];
  const at = (x: number, y: number, z: number): V3 => [H[0] + x * S, H[1] + y * S, H[2] + z * S];
  const r = (value: number) => value * S;
  const s = new Sculpt();
  s.floorY = BASE_TOP - 0.012;
  s.add(ellipsoid(at(0, 0.03, -0.01), [r(0.1), r(0.096), r(0.104)]), 0);
  s.add(ellipsoid(at(0, 0.045, 0.058), [r(0.086), r(0.074), r(0.042)]), r(0.03));
  s.add(capsule(at(-0.07, 0.098, -0.012), at(0.07, 0.098, -0.012), r(0.04)), r(0.03));
  for (const side of [-1, 1]) s.add(sphere(at(side * 0.094, 0.096, -0.006), r(0.037)), r(0.02));
  s.add(roundCone(at(0, -0.005, 0.07), at(0, -0.085, 0.135), r(0.064), r(0.058)), r(0.03));
  s.add(ellipsoid(at(0, -0.105, 0.148), [r(0.071), r(0.051), r(0.05)]), r(0.025));
  s.add(ellipsoid(at(0, -0.085, 0.03), [r(0.074), r(0.052), r(0.074)]), r(0.03));
  for (const side of [-1, 1]) s.add(sphere(at(side * 0.061, -0.035, 0.03), r(0.059)), r(0.03));
  for (const side of [-1, 1]) s.add(capsule(at(side * 0.048, 0.06, 0.077), at(side * 0.097, 0.047, 0.052), r(0.017)), r(0.015));
  for (const side of [-1, 1]) s.add(ellipsoid(at(side * 0.15, 0.036, -0.03), [r(0.056), r(0.021), r(0.032)], [0, 0, -side * 0.35]), r(0.015));
  for (const [x, y, z, rad] of [[-0.024, 0.104, 0.042, 0.021], [0.024, 0.104, 0.042, 0.021], [0, 0.112, 0.03, 0.023], [-0.05, 0.108, 0.02, 0.018], [0.05, 0.108, 0.02, 0.018]] as const) {
    s.add(sphere(at(x, y, z), r(rad)), r(0.012));
  }
  // Short, massive neck with the hump and broad shoulders of a bust.
  const cupY = (BASE_TOP - H[1]) / S - 0.02;
  s.add(roundCone(at(0, -0.05, -0.05), at(0, cupY, -0.02), r(0.112), r(0.124)), r(0.035));
  s.add(ellipsoid(at(0, -0.2, 0.045), [r(0.072), r(0.1), r(0.06)]), r(0.04));
  s.add(ellipsoid(at(0, -0.1, -0.1), [r(0.12), r(0.1), r(0.088)]), r(0.04));
  s.add(ellipsoid(at(0, cupY + 0.075, -0.012), [r(0.162), r(0.085), r(0.128)]), r(0.05));
  for (const side of [-1, 1]) s.cut(ellipsoid(at(side * 0.033, -0.1, 0.195), [r(0.013), r(0.017), r(0.02)], [0.3, 0, 0]), r(0.006));
  s.cut(capsule(at(-0.054, -0.141, 0.138), at(0.054, -0.141, 0.138), r(0.006)), r(0.005));
  for (const side of [-1, 1]) s.cut(sphere(at(side * 0.082, 0.03, 0.064), r(0.017)), r(0.007));

  const head = meshSdf(s, [-0.26, BASE_TOP - 0.025, -0.25], [0.26, 0.86, 0.27], sculptStep(detail), { aoStep: 0.007, aoStrength: 0.38, cavity: 0.22 });
  const tubular = detail === "low" ? 24 : 56;
  const radial = detail === "low" ? 8 : 18;
  const horns = merge([-1, 1].map((side) => taperedTube(
    [at(side * 0.075, 0.098, -0.008), at(side * 0.16, 0.112, 0.0), at(side * 0.232, 0.152, 0.04), at(side * 0.256, 0.228, 0.078), at(side * 0.228, 0.292, 0.098)].map((p) => v3(...p)),
    (t) => r(0.036 * Math.pow(1 - t, 0.85) + 0.0025), tubular, radial,
  )));
  const bands = merge([-1, 1].map((side) => transform(new THREE.TorusGeometry(r(0.035), r(0.0055), 8, 32), at(side * 0.128, 0.104, -0.004), [0, Math.PI / 2 + side * 0.18, 0])));
  const ring = transform(new THREE.TorusGeometry(r(0.026), r(0.0055), detail === "low" ? 8 : 12, 40), at(0, -0.128, 0.2), [0.35, 0, 0]);
  const eyes = eyePair(at(0.08, 0.029, 0.058), r(0.0135), detail);
  return [
    { geometry: head, material: "sapphireSculpt", shadow: true },
    { geometry: merge([horns, bands, ring, eyes]), material: "gold", shadow: true },
  ];
}

function buildGlobePiece(detail: Detail): PiecePart[] {
  const seg = detail === "low" ? 32 : 72;
  const center: V3 = [0, 0.742, 0];
  const ringRadius = 0.262;
  const stem = lathe([[0.0, 0.27], [0.058, 0.272], [0.06, 0.282], [0.046, 0.292], [0.032, 0.315], [0.026, 0.35], [0.03, 0.385], [0.044, 0.405], [0.046, 0.415], [0.03, 0.432], [0.021, 0.455], [0.02, 0.468], [0.028, 0.476], [0.0, 0.482]], seg, 40);
  const meridian = transform(new THREE.TorusGeometry(ringRadius, 0.0105, detail === "low" ? 8 : 12, detail === "low" ? 64 : 160), center, [0, 0, 0], [1, 1, 1.75]);
  const tilt = -0.41;
  const axis = v3(Math.sin(-tilt), Math.cos(-tilt), 0);
  const pole = (sign: number) => v3(center[0] + axis.x * ringRadius * sign, center[1] + axis.y * ringRadius * sign, center[2]);
  const pins = merge([1, -1].map((sign) => transform(new THREE.SphereGeometry(0.016, 16, 12), pole(sign).toArray() as V3)));
  const finial = merge([
    transform(new THREE.SphereGeometry(0.02, 20, 14), [0, center[1] + ringRadius + 0.012, 0]),
    transform(new THREE.ConeGeometry(0.009, 0.05, 16), [0, center[1] + ringRadius + 0.052, 0]),
  ]);
  const ticks: THREE.BufferGeometry[] = [];
  for (let n = 0; n < 24; n++) {
    const angle = (n / 24) * Math.PI * 2;
    ticks.push(transform(new THREE.BoxGeometry(0.004, n % 6 === 0 ? 0.026 : 0.014, 0.004), [Math.sin(angle) * (ringRadius + 0.004), center[1] + Math.cos(angle) * (ringRadius + 0.004), 0.019], [0, 0, -angle]));
  }
  const ball = transform(new THREE.SphereGeometry(0.236, detail === "low" ? 40 : 96, detail === "low" ? 28 : 64), center, [0, 0, tilt]);
  return [
    { geometry: merge([stem, meridian, pins, finial]), material: "platinum", shadow: true },
    { geometry: merge(ticks), material: "onyx", shadow: false },
    { geometry: ball, material: "globeBall", shadow: true },
  ];
}

/** Hexagonal prism with a pyramidal termination; colour zoning from a pale foot to a deep violet tip. */
function crystalPrism(radius: number, height: number, tipRatio: number) {
  const geometry = lathe([[0, 0], [radius * 0.88, 0], [radius, height * 0.05], [radius, height * (1 - tipRatio)], [0, height]], 6);
  const position = geometry.getAttribute("position");
  const colours = new Float32Array(position.count * 3);
  const foot = new THREE.Color(0.95, 0.9, 1.0), mid = new THREE.Color(0.78, 0.56, 1.0), tip = new THREE.Color(0.52, 0.3, 0.98);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = Math.min(1, Math.max(0, position.getY(i) / height));
    if (t < 0.55) c.copy(foot).lerp(mid, t / 0.55);
    else c.copy(mid).lerp(tip, (t - 0.55) / 0.45);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return geometry;
}

function buildCrystal(detail: Detail): PiecePart[] {
  void detail;
  const y0 = 0.262;
  const specs: Array<{ r: number; h: number; tip: number; pos: V3; rot: V3 }> = [
    { r: 0.074, h: 0.775, tip: 0.24, pos: [0.0, y0, 0.0], rot: [0.04, 0.3, -0.03] },
    { r: 0.052, h: 0.5, tip: 0.28, pos: [0.06, y0, 0.03], rot: [0.12, 0.9, -0.42] },
    { r: 0.047, h: 0.42, tip: 0.3, pos: [-0.062, y0, 0.025], rot: [0.16, -0.4, 0.48] },
    { r: 0.042, h: 0.33, tip: 0.3, pos: [0.018, y0, 0.07], rot: [0.58, 0.2, -0.12] },
    { r: 0.037, h: 0.28, tip: 0.32, pos: [-0.03, y0, -0.06], rot: [-0.52, 0.5, 0.24] },
    { r: 0.031, h: 0.23, tip: 0.33, pos: [0.066, y0, -0.045], rot: [-0.32, -0.2, -0.62] },
    { r: 0.026, h: 0.17, tip: 0.34, pos: [-0.075, y0, -0.02], rot: [0.0, 0.7, 0.85] },
    { r: 0.024, h: 0.15, tip: 0.35, pos: [-0.02, y0, 0.085], rot: [0.85, 0.1, 0.35] },
  ];
  const prisms = merge(specs.map((spec) => transform(crystalPrism(spec.r, spec.h, spec.tip), spec.pos, spec.rot)));
  const rock = transform(new THREE.DodecahedronGeometry(0.1, 0), [0, y0 + 0.012, 0], [0.3, 0.5, 0.1], [1.25, 0.42, 1.2]);
  const claws: THREE.BufferGeometry[] = [];
  for (let n = 0; n < 6; n++) {
    const angle = (n / 6) * Math.PI * 2 + 0.26;
    claws.push(taperedTube([v3(Math.sin(angle) * 0.13, 0.266, Math.cos(angle) * 0.13), v3(Math.sin(angle) * 0.122, 0.296, Math.cos(angle) * 0.122), v3(Math.sin(angle) * 0.098, 0.326, Math.cos(angle) * 0.098)], (t) => 0.012 * (1 - t * 0.55), 10, 10));
  }
  return [
    { geometry: prisms, material: "amethyst", shadow: true },
    { geometry: rock, material: "rock", shadow: true },
    { geometry: merge(claws), material: "gold", shadow: true },
  ];
}

/** Chamfered square section with Art-Deco flutes on each face. */
function decoShape(half: number, chamfer: number, flutes: number, depth: number, width: number) {
  const points: THREE.Vector2[] = [];
  for (let side = 0; side < 4; side++) {
    const angle = (side * Math.PI) / 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    const put = (x: number, y: number) => points.push(new THREE.Vector2(x * c - y * s, x * s + y * c));
    put(half, -half + chamfer);
    const span = 2 * (half - chamfer);
    for (let f = 0; f < flutes; f++) {
      const centre = -half + chamfer + (span * (f + 1)) / (flutes + 1);
      put(half, centre - width / 2);
      put(half - depth, centre - width / 2);
      put(half - depth, centre + width / 2);
      put(half, centre + width / 2);
    }
    put(half, half - chamfer);
  }
  return new THREE.Shape(points);
}

function tier(shape: THREE.Shape, y: number, height: number, bevel = 0.0035) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  return transform(geometry, [0, y + bevel, 0], [-Math.PI / 2, 0, 0]);
}

function buildTower(detail: Detail): PiecePart[] {
  void detail;
  const ruby: THREE.BufferGeometry[] = [];
  const gold: THREE.BufferGeometry[] = [];
  gold.push(tier(decoShape(0.128, 0.03, 0, 0, 0), 0.268, 0.042, 0.006));
  ruby.push(tier(decoShape(0.1, 0.026, 2, 0.012, 0.016), 0.31, 0.33));
  gold.push(tier(decoShape(0.108, 0.028, 0, 0, 0), 0.636, 0.016, 0.004));
  ruby.push(tier(decoShape(0.082, 0.022, 2, 0.01, 0.013), 0.652, 0.13));
  gold.push(tier(decoShape(0.089, 0.024, 0, 0, 0), 0.778, 0.014, 0.004));
  ruby.push(tier(decoShape(0.064, 0.018, 1, 0.009, 0.014), 0.792, 0.082));
  // Crown: stepped gold setbacks with sunburst fins, then the spire.
  gold.push(tier(decoShape(0.07, 0.02, 0, 0, 0), 0.872, 0.012, 0.003));
  gold.push(tier(decoShape(0.054, 0.016, 0, 0, 0), 0.884, 0.03, 0.004));
  gold.push(tier(decoShape(0.04, 0.012, 0, 0, 0), 0.914, 0.026, 0.004));
  gold.push(tier(decoShape(0.027, 0.008, 0, 0, 0), 0.94, 0.022, 0.003));
  for (let n = 0; n < 8; n++) {
    const angle = (n / 8) * Math.PI * 2 + Math.PI / 8;
    const fin = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.03, 0), new THREE.Vector2(0, 0.085)]);
    const geometry = new THREE.ExtrudeGeometry(fin, { depth: 0.006, bevelEnabled: false });
    gold.push(transform(geometry, [Math.sin(angle) * 0.034, 0.872, Math.cos(angle) * 0.034], [0, angle - Math.PI / 2, 0]));
  }
  gold.push(transform(new THREE.ConeGeometry(0.011, 0.13, detail === "low" ? 8 : 16), [0, 0.962 + 0.065, 0]));
  gold.push(transform(new THREE.SphereGeometry(0.012, 16, 12), [0, 0.968, 0]));
  return [
    { geometry: merge(ruby), material: "ruby", shadow: true },
    { geometry: merge(gold), material: "gold", shadow: true },
  ];
}

function buildLeaf(detail: Detail): PiecePart[] {
  const L = 0.7;
  const maxHalf = 0.152;
  const halfWidth = (u: number) => maxHalf * Math.pow(Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, u)), 0.76)), 0.92);
  const outline: THREE.Vector2[] = [];
  const steps = detail === "low" ? 18 : 40;
  for (let i = 0; i <= steps; i++) { const u = i / steps; outline.push(new THREE.Vector2(halfWidth(u), u * L)); }
  for (let i = steps - 1; i > 0; i--) { const u = i / steps; outline.push(new THREE.Vector2(-halfWidth(u), u * L)); }
  const thickness = 0.012;
  const bevel = 0.011;
  const blade = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth: thickness, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.008, bevelSegments: detail === "low" ? 2 : 4, curveSegments: 4, steps: 1 });
  blade.translate(0, 0, -thickness / 2);

  // Midline arc (tangent angle grows: leans back at the stem, curls forward at the tip).
  const base: V3 = [0, 0.34, 0.03];
  const samples = 64;
  const arc: Array<[number, number, number]> = [[base[1], base[2], -0.26]];
  for (let i = 1; i <= samples; i++) {
    const u = i / samples;
    const phi = -0.26 + 0.78 * Math.pow(u, 1.6);
    const [py, pz] = arc[i - 1]!;
    const ds = L / samples;
    arc.push([py + Math.cos(phi) * ds, pz + Math.sin(phi) * ds, phi]);
  }
  const deform = (x: number, y: number, z: number, out: THREE.Vector3) => {
    const u = Math.min(1, Math.max(0, y / L));
    const f = u * samples;
    const i = Math.min(samples - 1, Math.floor(f));
    const t = f - i;
    const a = arc[i]!, b = arc[i + 1]!;
    const cy = a[0] + (b[0] - a[0]) * t, cz = a[1] + (b[1] - a[1]) * t, phi = a[2] + (b[2] - a[2]) * t;
    const fold = 0.36 * (Math.sqrt(x * x + 0.0003) - Math.sqrt(0.0003));
    const zl = z - fold - 0.08 * Math.sin(Math.PI * u) * Math.abs(x);
    const twist = 0.22 * u;
    const xr = x * Math.cos(twist) - zl * Math.sin(twist);
    const zr = x * Math.sin(twist) + zl * Math.cos(twist);
    out.set(base[0] + xr, cy - Math.sin(phi) * zr, cz + Math.cos(phi) * zr);
    return out;
  };
  const position = blade.getAttribute("position") as THREE.BufferAttribute;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    deform(position.getX(i), position.getY(i), position.getZ(i), tmp);
    position.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  blade.deleteAttribute("normal");
  blade.deleteAttribute("uv");
  const smoothBlade = mergeVertices(blade, 1e-5);
  smoothBlade.computeVertexNormals();

  const front = thickness / 2 + bevel * 0.55;
  const tubular = detail === "low" ? 20 : 48;
  const radial = detail === "low" ? 6 : 12;
  const veins: THREE.BufferGeometry[] = [];
  const mid: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) mid.push(deform(0, (0.01 + 0.9 * (i / 8)) * L, front + 0.004, new THREE.Vector3()));
  veins.push(taperedTube(mid, (t) => 0.0105 * (1 - t) + 0.0018, tubular, radial));
  for (const u0 of [0.16, 0.3, 0.44, 0.58, 0.72]) {
    for (const side of [-1, 1]) {
      const points: THREE.Vector3[] = [];
      for (let k = 0; k <= 4; k++) {
        const s = k / 4;
        const u = u0 + 0.13 * Math.pow(s, 0.8);
        points.push(deform(side * halfWidth(u) * 0.8 * s, u * L, front + 0.002 * (1 - s), new THREE.Vector3()));
      }
      veins.push(taperedTube(points, (t) => 0.0048 * (1 - t) + 0.0011, Math.round(tubular / 3), Math.max(5, radial - 4)));
    }
  }
  const stemTop = deform(0, 0.0, 0, new THREE.Vector3());
  veins.push(taperedTube([v3(0, 0.262, 0.0), v3(0, 0.29, 0.008), v3(0, 0.318, stemTop.z * 0.7), stemTop.clone().add(v3(0, 0.03, 0.004))], (t) => 0.019 - 0.007 * t, 16, radial));
  return [
    { geometry: smoothBlade, material: "emerald", shadow: true },
    { geometry: merge(veins), material: "gold", shadow: true },
  ];
}

const BUILDERS: Record<PawnId, (detail: Detail) => PiecePart[]> = {
  lion: buildLion, bull: buildBull, globe: buildGlobePiece, crystal: buildCrystal, tower: buildTower, leaf: buildLeaf,
};

const modelCache = new Map<string, PiecePart[]>();
const detailOf = (quality: ObjectQuality): Detail => (quality === "low" ? "low" : "high");

/** Geometry parts of a piece (built once per detail level, then shared). */
export function getPieceParts(piece: PawnId, quality: ObjectQuality = "high"): PiecePart[] {
  const detail = detailOf(quality);
  const key = `${piece}|${detail}`;
  let parts = modelCache.get(key);
  if (!parts) {
    const builder = BUILDERS[piece] ?? BUILDERS.lion;
    parts = [...basePartsFor(detail), ...builder(detail)];
    modelCache.set(key, parts);
  }
  return parts;
}

/** True once a piece's geometry exists (rendering it will not stall). */
export function isPieceReady(piece: PawnId, quality: ObjectQuality = "high") {
  return modelCache.has(`${piece}|${detailOf(quality)}`);
}

interface IdleDeadlineLike { timeRemaining(): number; didTimeout: boolean }
function whenIdle(callback: (deadline: IdleDeadlineLike) => void) {
  const w = window as Window & { requestIdleCallback?: (cb: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(callback, { timeout: 120 });
  else window.setTimeout(() => callback({ timeRemaining: () => 12, didTimeout: true }), 16);
}

/** Sculpted pieces cost the most: build the hard-surface ones first. */
const BUILD_ORDER: PawnId[] = ["globe", "crystal", "tower", "leaf", "bull", "lion"];

/**
 * Builds figurine geometry ahead of time in idle slots (cheapest first, several
 * per slot when there is time), so the first frame does not stall on sculpting.
 * Safe to call repeatedly; returns a cancel function.
 */
export function preloadPawnModels(pieces: PawnId[] = PAWN_IDS, quality: ObjectQuality = "high", onEach?: (piece: PawnId) => void) {
  if (typeof window === "undefined") return () => {};
  const queue = BUILD_ORDER.filter((piece) => pieces.includes(piece) && !isPieceReady(piece, quality));
  let cancelled = false;
  const next = (deadline: IdleDeadlineLike) => {
    if (cancelled) return;
    let built = 0;
    while (queue.length && (built === 0 || deadline.timeRemaining() > 10)) {
      const piece = queue.shift()!;
      getPieceParts(piece, quality);
      onEach?.(piece);
      built++;
    }
    if (queue.length) whenIdle(next);
  };
  if (queue.length) whenIdle(next);
  return () => { cancelled = true; };
}

/** Re-renders as pieces become ready (built in idle slots, never all at once). */
export function usePiecesReady(pieces: PawnId[], quality: ObjectQuality = "high") {
  const [, bump] = useReducer((value: number) => value + 1, 0);
  const key = `${pieces.join(",")}|${detailOf(quality)}`;
  useEffect(() => preloadPawnModels(pieces, quality, () => bump()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (piece: PawnId) => isPieceReady(piece, quality);
}

// =========================================================================
// Engraved platinum globe material (land / ocean maps once the data loads)
// =========================================================================
let globeMaps: { map: THREE.Texture; roughness: THREE.Texture } | null = null;
let globeMapsPromise: Promise<void> | null = null;
const globeBallMaterials = new Map<string, THREE.MeshStandardMaterial>();

function loadGlobeBallMaps() {
  if (globeMapsPromise || typeof document === "undefined") return globeMapsPromise;
  globeMapsPromise = loadLandRings().then((rings) => {
    if (!rings.length) return;
    const w = 1024, h = 512;
    const colour = document.createElement("canvas");
    colour.width = w; colour.height = h;
    const c = colour.getContext("2d")!;
    c.fillStyle = "#3d6cb8";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(190, 214, 245, 0.32)";
    c.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) { c.beginPath(); c.moveTo(((lon + 180) / 360) * w, 0); c.lineTo(((lon + 180) / 360) * w, h); c.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { c.beginPath(); c.moveTo(0, ((90 - lat) / 180) * h); c.lineTo(w, ((90 - lat) / 180) * h); c.stroke(); }
    c.fillStyle = "#eef0f3";
    traceLand(c, rings, w, h, "fill");
    c.strokeStyle = "#8c96a3";
    c.lineWidth = 1.6;
    c.lineJoin = "round";
    traceLand(c, rings, w, h, "stroke");

    const rough = document.createElement("canvas");
    rough.width = w; rough.height = h;
    const r = rough.getContext("2d")!;
    r.fillStyle = "rgb(0, 60, 0)";
    r.fillRect(0, 0, w, h);
    r.fillStyle = "rgb(0, 84, 255)";
    traceLand(r, rings, w, h, "fill");
    r.strokeStyle = "rgb(0, 140, 255)";
    r.lineWidth = 1.6;
    traceLand(r, rings, w, h, "stroke");

    const map = new THREE.CanvasTexture(colour);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const roughness = new THREE.CanvasTexture(rough);
    roughness.anisotropy = 8;
    globeMaps = { map, roughness };
    for (const [key, material] of globeBallMaterials) applyGlobeMaps(material, key.endsWith("|1"));
  });
  return globeMapsPromise;
}

function applyGlobeMaps(material: THREE.MeshStandardMaterial, jailed: boolean) {
  if (!globeMaps) return;
  material.map = globeMaps.map;
  // One texture: G = roughness, B = metalness (enamel seas, platinum continents).
  material.roughnessMap = globeMaps.roughness;
  material.metalnessMap = globeMaps.roughness;
  material.roughness = 1;
  material.metalness = 1;
  if (material instanceof THREE.MeshPhysicalMaterial) { material.clearcoat = 1; material.clearcoatRoughness = 0.05; }
  material.color = jailed ? desaturate("#ffffff", 0, 0.45) : new THREE.Color("#ffffff");
  material.needsUpdate = true;
}

function globeBallMaterial(quality: ObjectQuality, jailed: boolean) {
  const key = `${quality}|${jailed ? 1 : 0}`;
  let material = globeBallMaterials.get(key);
  if (!material) {
    material = (pieceMaterial("platinum", quality, jailed) as THREE.MeshStandardMaterial).clone();
    material.name = `gf-globe-ball-${key}`;
    globeBallMaterials.set(key, material);
    applyGlobeMaps(material, jailed);
  }
  return material;
}

// =========================================================================
// Component
// =========================================================================
export const PawnModel = memo(function PawnModel({
  piece, seatColor, jailed = false, active = false, quality = "high", reducedMotion, halo = true, ...group
}: PawnModelProps & ThreeElements["group"]) {
  const settings = usePresentationSettings();
  const still = reducedMotion ?? settings.reducedMotion;
  const invalidate = useThree((state) => state.invalidate);
  const parts = useMemo(() => getPieceParts(piece, quality), [piece, quality]);
  const ringMode: SeatRingMode = jailed ? "jailed" : !seatColor ? "neutral" : active ? "active" : "idle";
  const ring = seatRingMaterial(seatColor, ringMode, quality);
  const haloMaterial = halo && active && !jailed && seatColor ? (glowMaterial(seatColor, "halo") as THREE.MeshBasicMaterial) : null;
  const haloRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (piece !== "globe" || globeMaps) return;
    let alive = true;
    loadGlobeBallMaps()?.then(() => { if (alive) invalidate(); });
    return () => { alive = false; };
  }, [piece, invalidate]);

  useFrame(({ clock }) => {
    if (!haloMaterial) return;
    if (still) {
      haloMaterial.opacity = 0.62;
      ring.emissiveIntensity = 2.2;
      haloRef.current?.scale.setScalar(1);
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.3);
    haloMaterial.opacity = 0.4 + 0.36 * pulse;
    ring.emissiveIntensity = 1.6 + 1.0 * pulse;
    haloRef.current?.scale.setScalar(0.95 + 0.07 * pulse);
  });

  return (
    <group {...group}>
      {parts.map((part, index) => (
        <mesh
          key={index}
          geometry={part.geometry}
          material={part.material === "globeBall" ? globeBallMaterial(quality, jailed) : pieceMaterial(part.material, quality, jailed)}
          castShadow={part.shadow}
          receiveShadow
        />
      ))}
      <mesh geometry={ringGeometry(detailOf(quality))} material={ring} />
      {haloMaterial && <mesh ref={haloRef} geometry={getHaloGeometry()} material={haloMaterial} renderOrder={2} />}
    </group>
  );
});
