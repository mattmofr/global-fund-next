/**
 * Sector-themed arrival flourishes. When a figurine lands (PAWN_ARRIVAL), a
 * short (~2 s) effect rises from its cell, in the colour of its sector:
 *
 *   technology  circuit traces race across the plaque, holographic data squares rise
 *   finance     gold coins pop, spin, fall back with a glint and sink into the plaque
 *   industry    three interlocking gears rise and turn, sparks fly where they mesh
 *   health      a heartbeat line is drawn, two pulse rings, floating crosses
 *   energy      a crown of flickering flames, lightning flashes, rising embers
 *   realestate  a miniature skyline grows out of the plaque, lights up, sinks back
 *   agrifood    gold wheat stalks sprout and sway, leaves and pollen drift away
 *   media       broadcast rings spread over the board, signal arcs from the figurine
 *   transport   a small ivory plane glides over the cell with wingtip contrails
 *   Départ      a golden burst of rays and rings, a spiral of motes
 *   Événement   a "?" card rises, spins, shimmers and vanishes in sparkles
 *   Bull        emerald arrows surge upwards in a column of light
 *   Bear        steel arrows drift down into the plaque through a cold mist
 *   Crash       red shards rain and shatter, a crack glows, the board flashes red
 *
 * One effect plays at a time. Everything is allocated once and pooled: two
 * instanced glow meshes (camera-facing sprites and flat decals reading one
 * glyph atlas) and a few instanced lit meshes. Motion is a pure function of
 * the presentation clock (performance.now() − arrival.at), so it stays in
 * step with the pawn, the camera and the plaque flash drawn by Plaques.
 * Reduced motion plays nothing; the low tier uses about half the particles.
 */
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ZAP_PATH } from "./icons";
import { PLAQUE_TOP, cellAt, standOffset } from "./layout";
import { useDisposable } from "./Board";
import { clamp01, easeInCubic, easeOutBack, easeOutCubic, envelope, seeded, smoothstep, useRuntime, type BoardRuntime, type FxTheme } from "./runtime";

/** Longest effect (s). */
const FX_SECONDS = 2.3;
const TAU = Math.PI * 2;

// ------------------------------------------------------------ glyph atlas --
const ATLAS_W = 1024;
const ATLAS_H = 512;
const CELL_PX = 128;
type Glyph = readonly [number, number, number, number];
/** UV rectangle (u0, v0, du, dv) of an atlas cell (three.js flipY convention). */
const glyph = (col: number, row: number, span = 1): Glyph => [
  (col * CELL_PX) / ATLAS_W, 1 - ((row + 1) * CELL_PX) / ATLAS_H, (span * CELL_PX) / ATLAS_W, CELL_PX / ATLAS_H,
];
const G = {
  dot: glyph(0, 0), ring: glyph(1, 0), square: glyph(2, 0), cross: glyph(3, 0),
  star: glyph(4, 0), chevron: glyph(5, 0), flame: glyph(6, 0), bolt: glyph(7, 0),
  arc: glyph(0, 1), streak: glyph(1, 1), leaf: glyph(2, 1), crack: glyph(3, 1),
  disc: glyph(4, 1), haze: glyph(5, 1),
  ecg: glyph(0, 2, 4),
} as const;
/** Ring radius inside its glyph, as a fraction of the glyph size. */
const RING_R = 0.38;

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function radial(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, stops: [number, number][]) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** White glyphs on a transparent canvas: the shader reads alpha as intensity. Strokes are bold: sprites are small on screen. */
function glyphCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext("2d")!;
  const S = CELL_PX, H = S / 2;
  const cell = (col: number, row: number, draw: () => void, span = 1) => {
    ctx.save();
    ctx.translate(col * S, row * S);
    ctx.beginPath();
    ctx.rect(0, 0, S * span, S);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    draw();
    ctx.restore();
  };
  const glow = (blur: number) => { ctx.shadowColor = "rgba(255,255,255,0.95)"; ctx.shadowBlur = blur; };
  const crisp = () => { ctx.shadowBlur = 0; ctx.shadowColor = "rgba(0,0,0,0)"; };

  cell(0, 0, () => radial(ctx, H, H, H, [[0, 1], [0.12, 0.8], [0.3, 0.32], [0.58, 0.07], [1, 0]]));
  cell(1, 0, () => {
    glow(10);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(H, H, S * RING_R, 0, TAU);
    ctx.stroke();
    crisp();
    ctx.lineWidth = 3;
    ctx.stroke();
  });
  cell(2, 0, () => {
    const w = S * 0.62, x = H - w / 2;
    ctx.globalAlpha = 0.22;
    roundRectPath(ctx, x, x, w, w, 9);
    ctx.fill();
    ctx.globalAlpha = 1;
    glow(10);
    ctx.lineWidth = 9;
    roundRectPath(ctx, x, x, w, w, 9);
    ctx.stroke();
    crisp();
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillRect(x + 17, H - 10, w - 34, 7);
    ctx.fillRect(x + 17, H + 5, (w - 34) * 0.55, 7);
  });
  cell(3, 0, () => {
    const arm = S * 0.13, len = S * 0.34;
    glow(12);
    roundRectPath(ctx, H - arm, H - len, arm * 2, len * 2, arm * 0.55);
    ctx.fill();
    roundRectPath(ctx, H - len, H - arm, len * 2, arm * 2, arm * 0.55);
    ctx.fill();
  });
  cell(4, 0, () => {
    radial(ctx, H, H, H * 0.5, [[0, 1], [0.35, 0.5], [1, 0]]);
    for (const [sx, sy] of [[1, 0.09], [0.09, 1]] as const) {
      ctx.save();
      ctx.translate(H, H);
      ctx.scale(sx, sy);
      radial(ctx, 0, 0, H * 0.97, [[0, 1], [0.22, 0.65], [0.6, 0.14], [1, 0]]);
      ctx.restore();
    }
  });
  cell(5, 0, () => {
    glow(12);
    ctx.lineWidth = 17;
    ctx.beginPath();
    ctx.moveTo(H - 34, H + 16);
    ctx.lineTo(H, H - 18);
    ctx.lineTo(H + 34, H + 16);
    ctx.stroke();
  });
  cell(6, 0, () => {
    const flame = new Path2D();
    flame.moveTo(H, S * 0.06);
    flame.bezierCurveTo(H + S * 0.07, S * 0.3, H + S * 0.31, S * 0.46, H + S * 0.27, S * 0.7);
    flame.bezierCurveTo(H + S * 0.24, S * 0.92, H - S * 0.24, S * 0.92, H - S * 0.27, S * 0.7);
    flame.bezierCurveTo(H - S * 0.31, S * 0.46, H - S * 0.07, S * 0.3, H, S * 0.06);
    glow(12);
    const g = ctx.createRadialGradient(H, S * 0.74, 2, H, S * 0.62, S * 0.5);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.72)");
    g.addColorStop(1, "rgba(255,255,255,0.2)");
    ctx.fillStyle = g;
    ctx.fill(flame);
  });
  cell(7, 0, () => {
    glow(12);
    ctx.translate(H - 52, H - 52);
    ctx.scale(104 / 24, 104 / 24);
    ctx.fill(new Path2D(ZAP_PATH));
  });
  cell(0, 1, () => {
    glow(10);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(H, H, S * 0.37, -0.78, 0.78);
    ctx.stroke();
  });
  cell(1, 1, () => {
    // Vertical soft line, long axis = quad y (streaks, traces, rays, beams).
    const gx = ctx.createLinearGradient(0, 0, S, 0);
    for (const [at, a] of [[0, 0], [0.16, 0.08], [0.32, 0.5], [0.42, 0.95], [0.5, 1], [0.58, 0.95], [0.68, 0.5], [0.84, 0.08], [1, 0]] as const) gx.addColorStop(at, `rgba(255,255,255,${a})`);
    ctx.fillStyle = gx;
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = "destination-in";
    const gy = ctx.createLinearGradient(0, 0, 0, S);
    for (const [at, a] of [[0, 0], [0.12, 1], [0.88, 1], [1, 0]] as const) gy.addColorStop(at, `rgba(255,255,255,${a})`);
    ctx.fillStyle = gy;
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = "source-over";
  });
  cell(2, 1, () => {
    glow(8);
    ctx.beginPath();
    ctx.moveTo(H, S * 0.1);
    ctx.quadraticCurveTo(H + S * 0.34, H, H, S * 0.9);
    ctx.quadraticCurveTo(H - S * 0.34, H, H, S * 0.1);
    ctx.fill();
    crisp();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(H, S * 0.2);
    ctx.lineTo(H, S * 0.8);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  });
  cell(3, 1, () => {
    const random = seeded(77);
    glow(8);
    for (let b = 0; b < 9; b++) {
      let a = (b / 9) * TAU + (random() - 0.5) * 0.5;
      let x = H, y = H, len = 0;
      const reach = S * (0.32 + random() * 0.18);
      ctx.lineWidth = 6 - b * 0.35;
      ctx.beginPath();
      ctx.moveTo(x, y);
      while (len < reach) {
        const step = 5 + random() * 9;
        a += (random() - 0.5) * 0.9;
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
        len += step;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    crisp();
    radial(ctx, H, H, S * 0.16, [[0, 0.95], [1, 0]]);
  });
  cell(4, 1, () => radial(ctx, H, H, H, [[0, 1], [0.5, 0.85], [0.78, 0.32], [1, 0]]));
  cell(5, 1, () => radial(ctx, H, H, H, [[0, 0.55], [0.4, 0.3], [0.75, 0.08], [1, 0]]));
  cell(0, 2, () => {
    // Two heartbeats; QRS peaks at 31 % and 73 % of the width.
    const W = S * 4, base = H + 14;
    const beat = (o: number): [number, number][] => [
      [o - 0.12, 0], [o - 0.1, -6], [o - 0.08, -9], [o - 0.06, -6], [o - 0.04, 0], [o - 0.02, 0], [o - 0.01, 8],
      [o, -50], [o + 0.015, 22], [o + 0.03, 0], [o + 0.09, 0], [o + 0.12, -12], [o + 0.15, -14], [o + 0.18, -9], [o + 0.21, 0],
    ];
    const points: [number, number][] = [[0.02, 0], ...beat(0.31), ...beat(0.73), [0.98, 0]];
    ctx.beginPath();
    points.forEach(([f, dy], i) => (i ? ctx.lineTo(f * W, base + dy) : ctx.moveTo(f * W, base + dy)));
    glow(14);
    ctx.lineWidth = 10;
    ctx.stroke();
    crisp();
    ctx.lineWidth = 5;
    ctx.stroke();
  }, 4);
  return canvas;
}

function glyphTexture() {
  const texture = new THREE.CanvasTexture(glyphCanvas());
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// --------------------------------------------------------------- shaders --
const GLOW_VARYINGS = /* glsl */ `
attribute vec4 aGlyph;
attribute vec4 aParams;
varying vec2 vUv;
varying vec2 vQuad;
varying vec3 vColor;
varying float vReveal;`;

/*
 * Camera-facing quads: size from the instance matrix scale, rotated in screen
 * space by aParams.z. aParams = (intensity, reveal, rotation, unused).
 * Streaks (sparks, embers, beams) are billboards whose rotation and length
 * are projected on the CPU from the camera (see GlowBatch.streak).
 */
const SPRITE_VERTEX = /* glsl */ `${GLOW_VARYINGS}
void main() {
  vec4 mv = modelViewMatrix * vec4( instanceMatrix[3].xyz, 1.0 );
  float spin = aParams.z;
  vec2 quad = position.xy * vec2( length( instanceMatrix[0].xyz ), length( instanceMatrix[1].xyz ) );
  mv.xy += vec2( cos( spin ) * quad.x - sin( spin ) * quad.y, sin( spin ) * quad.x + cos( spin ) * quad.y );
  gl_Position = projectionMatrix * mv;
  vQuad = uv;
  vUv = aGlyph.xy + uv * aGlyph.zw;
  vColor = instanceColor * aParams.x;
  vReveal = aParams.y;
}`;

/** Quads placed by their full instance matrix (flat on the plaque). */
const DECAL_VERTEX = /* glsl */ `${GLOW_VARYINGS}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * ( instanceMatrix * vec4( position, 1.0 ) );
  vQuad = uv;
  vUv = aGlyph.xy + uv * aGlyph.zw;
  vColor = instanceColor * aParams.x;
  vReveal = aParams.y;
}`;

/** Additive glow; reveal < 1.5 wipes the glyph in from the left with a bright front. */
const GLOW_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec2 vQuad;
varying vec3 vColor;
varying float vReveal;
void main() {
  float a = texture2D( uAtlas, vUv ).a;
  if ( vReveal < 1.5 ) {
    float front = vQuad.x - vReveal;
    a = a * ( 1.0 - smoothstep( -0.012, 0.0, front ) ) + a * exp( -front * front * 1400.0 ) * 1.8;
  }
  gl_FragColor = vec4( vColor * a, clamp( a * max( vColor.r, max( vColor.g, vColor.b ) ), 0.0, 1.0 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function glowMaterial(atlas: THREE.Texture, vertexShader: string) {
  return new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: atlas } },
    vertexShader,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
}

const SHEEN_FRAGMENT = /* glsl */ `
uniform float uProgress;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float d = ( vUv.x + vUv.y ) * 0.5 - ( uProgress * 1.6 - 0.3 );
  float band = exp( -d * d * 140.0 ) * uOpacity;
  gl_FragColor = vec4( uColor * band, band );
}`;
const SHEEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;

// --------------------------------------------------------------- batches --
/** Pooled instanced glow quads, refilled every frame. */
class GlowBatch {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;
  private readonly glyphs: Float32Array;
  private readonly params: Float32Array;
  private readonly attributes: THREE.BufferAttribute[];
  private n = 0;
  private drawn = 0;
  /** Camera view matrix (world → view), set every frame before streaks are pushed. */
  view: THREE.Matrix4 | null = null;

  constructor(readonly max: number, material: THREE.ShaderMaterial, renderOrder: number) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.glyphs = new Float32Array(max * 4);
    this.params = new Float32Array(max * 4);
    this.colors = new Float32Array(max * 3);
    const glyphs = new THREE.InstancedBufferAttribute(this.glyphs, 4).setUsage(THREE.DynamicDrawUsage);
    const params = new THREE.InstancedBufferAttribute(this.params, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aGlyph", glyphs);
    geometry.setAttribute("aParams", params);
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
    this.attributes = [this.mesh.instanceMatrix, this.mesh.instanceColor, glyphs, params];
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  begin() { this.n = 0; }

  private slot(color: THREE.Color, intensity: number, g: Glyph, reveal: number, rotation: number) {
    if (this.n >= this.max || !(intensity > 0.003)) return -1;
    const i = this.n++;
    this.colors[i * 3] = color.r;
    this.colors[i * 3 + 1] = color.g;
    this.colors[i * 3 + 2] = color.b;
    this.glyphs.set(g, i * 4);
    this.params[i * 4] = intensity;
    this.params[i * 4 + 1] = reveal;
    this.params[i * 4 + 2] = rotation;
    this.params[i * 4 + 3] = 0;
    return i * 16;
  }

  private write(o: number, c0x: number, c0y: number, c0z: number, c1x: number, c1y: number, c1z: number, c2x: number, c2y: number, c2z: number, x: number, y: number, z: number) {
    const m = this.matrices;
    m[o] = c0x; m[o + 1] = c0y; m[o + 2] = c0z; m[o + 3] = 0;
    m[o + 4] = c1x; m[o + 5] = c1y; m[o + 6] = c1z; m[o + 7] = 0;
    m[o + 8] = c2x; m[o + 9] = c2y; m[o + 10] = c2z; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
  }

  /** Camera-facing quad of w × h world units, rotated in screen space. */
  sprite(x: number, y: number, z: number, w: number, h: number, rotation: number, color: THREE.Color, intensity: number, g: Glyph, reveal = 2) {
    if (!(w > 0.0005)) return;
    const o = this.slot(color, intensity, g, reveal, rotation);
    if (o >= 0) this.write(o, w, 0, 0, 0, h, 0, 0, 0, 1, x, y, z);
  }

  /**
   * Camera-facing streak along the world vector (ax, ay, az), whose length is
   * the streak length: projected on the view plane here, drawn as a rotated
   * billboard (the glyph's long axis is its height).
   */
  streak(x: number, y: number, z: number, ax: number, ay: number, az: number, width: number, color: THREE.Color, intensity: number, g: Glyph) {
    const e = this.view?.elements;
    let dx = 0, dy = Math.hypot(ax, ay, az);
    if (e) {
      dx = e[0]! * ax + e[4]! * ay + e[8]! * az;
      dy = e[1]! * ax + e[5]! * ay + e[9]! * az;
    }
    const len = Math.hypot(dx, dy);
    this.sprite(x, y, z, width, Math.max(len, width), len > 1e-6 ? Math.atan2(-dx, dy) : 0, color, intensity, g);
  }

  /** Quad lying flat at height y; local x follows the yaw, the glyph's top points along (−sin, −cos). */
  decal(x: number, y: number, z: number, w: number, h: number, yaw: number, color: THREE.Color, intensity: number, g: Glyph, reveal = 2) {
    if (!(w > 0.0005)) return;
    const o = this.slot(color, intensity, g, reveal, 0);
    if (o < 0) return;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.write(o, c * w, 0, -s * w, -s * h, 0, -c * h, 0, 1, 0, x, y, z);
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0 || this.drawn > 0) for (const attribute of this.attributes) attribute.needsUpdate = true;
    this.drawn = this.n;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

const _m4 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Pooled instanced lit meshes (coins, towers, wheat, arrows, shards). */
class LitPool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private drawn = 0;
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly max: number, shadows: boolean) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
  begin() { this.n = 0; }
  push(p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3) {
    if (this.n >= this.max) return;
    _m4.compose(p, q, s);
    this.mesh.setMatrixAt(this.n++, _m4);
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0 || this.drawn > 0) this.mesh.instanceMatrix.needsUpdate = true;
    this.drawn = this.n;
  }
}

// ------------------------------------------------------------ geometries --
function paint(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b; }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  merged.computeBoundingSphere();
  return merged;
}

/** Struck coin: raised rim, recessed field (lathe profile, bottom to top). */
function coinGeometry() {
  const R = COIN_R, T = COIN_T;
  const profile = [
    [0, -T * 0.7], [R * 0.8, -T * 0.7], [R * 0.84, -T], [R * 0.96, -T], [R, -T * 0.55],
    [R, T * 0.55], [R * 0.96, T], [R * 0.84, T], [R * 0.8, T * 0.7], [0, T * 0.7],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(profile, 36);
}

/** Spur gear in the XY plane, tooth centred on +x, with spoke windows when large enough. */
function gearGeometry(teeth: number, r: number) {
  const m = (2 * r) / teeth;
  const ro = r + m * 0.85, rr = r - m * 1.05;
  const pa = TAU / teeth;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a = i * pa;
    const pts: [number, number][] = [[a - pa * 0.5, rr], [a - pa * 0.27, rr], [a - pa * 0.14, ro], [a + pa * 0.14, ro], [a + pa * 0.27, rr]];
    pts.forEach(([ang, rad], k) => {
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const axle = new THREE.Path();
  axle.absarc(0, 0, r * 0.15, 0, TAU, true);
  shape.holes.push(axle);
  if (teeth >= 8) {
    const spokes = teeth >= 12 ? 5 : 4;
    for (let k = 0; k < spokes; k++) {
      const a0 = (k / spokes) * TAU + 0.24, a1 = a0 + TAU / spokes - 0.48;
      const slot = new THREE.Path();
      slot.absarc(0, 0, rr * 0.8, a0, a1, false);
      slot.absarc(0, 0, r * 0.33, a1, a0, true);
      slot.closePath();
      shape.holes.push(slot);
    }
  }
  const depth = 0.04;
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** Unit tower (base at y = 0); roof and floor sample the gold crown of the facade texture. */
function towerGeometry() {
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.5, 0.985);
  return geometry;
}

/** Wheat stalk, normalised height ≈ 1 (gold ear, olive-gilt stem, two green leaves). Chunky: it is small on screen. */
function stalkGeometry() {
  const stem = new THREE.Color("#a39a48"), ear = new THREE.Color("#f2d27a"), leaf = new THREE.Color("#6aa83e");
  const parts: THREE.BufferGeometry[] = [paint(new THREE.CylinderGeometry(0.02, 0.028, 0.62, 6, 1).translate(0, 0.31, 0), stem)];
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      parts.push(paint(new THREE.SphereGeometry(1, 8, 6).scale(0.042, 0.075, 0.036).rotateZ(side * 0.45).translate(side * 0.034, 0.64 + i * 0.062, 0), ear));
    }
  }
  parts.push(paint(new THREE.SphereGeometry(1, 8, 6).scale(0.03, 0.065, 0.03).translate(0, 0.64 + 6 * 0.062 + 0.015, 0), ear));
  for (const [y0, side, len] of [[0.1, 1, 0.38], [0.28, -1, 0.34]] as const) {
    const blade = new THREE.PlaneGeometry(0.1, len, 1, 8);
    const pos = blade.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const f = (pos.getY(k) + len / 2) / len;
      const x = pos.getX(k) * (1 - 0.85 * f);
      pos.setXYZ(k, side * (0.02 + 0.2 * f * f) + x, y0 + len * 0.8 * f, 0.006 * Math.sin(f * 3));
    }
    blade.computeVertexNormals();
    parts.push(paint(blade, leaf));
  }
  return merge(parts);
}

/** Small airliner, nose along +x (ivory with gilt fin and engines). */
function aircraftGeometry() {
  const ivory = new THREE.Color("#f1e9d8"), gilt = new THREE.Color("#d8b066");
  const parts: THREE.BufferGeometry[] = [
    paint(new THREE.CylinderGeometry(0.023, 0.012, 0.29, 14).rotateZ(-Math.PI / 2), ivory),
    paint(new THREE.SphereGeometry(0.023, 14, 10).scale(1.8, 1, 1).translate(0.145, 0, 0), ivory),
  ];
  const planform = (points: [number, number][], side: number) => {
    const shape = new THREE.Shape();
    points.forEach(([x, y], i) => (i ? shape.lineTo(x, y * side) : shape.moveTo(x, y * side)));
    shape.closePath();
    return shape;
  };
  for (const side of [1, -1]) {
    parts.push(paint(new THREE.ExtrudeGeometry(planform([[0.055, 0], [-0.035, 0.2], [-0.075, 0.2], [-0.045, 0]], side), { depth: 0.007, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0.01, 0.0035, 0), ivory));
    parts.push(paint(new THREE.ExtrudeGeometry(planform([[0, 0], [-0.03, 0.075], [-0.052, 0.075], [-0.036, 0]], side), { depth: 0.005, bevelEnabled: false }).rotateX(Math.PI / 2).translate(-0.1, 0.0025, 0), ivory));
    parts.push(paint(new THREE.CylinderGeometry(0.011, 0.01, 0.055, 10).rotateZ(-Math.PI / 2).translate(0.025, -0.014, 0.08 * side), gilt));
  }
  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(-0.05, 0.078); fin.lineTo(-0.072, 0.078); fin.lineTo(-0.056, 0); fin.closePath();
  parts.push(paint(new THREE.ExtrudeGeometry(fin, { depth: 0.006, bevelEnabled: false }).translate(-0.085, 0.008, -0.003), gilt));
  return merge(parts);
}

/** Thin triangular prism (crash shard), about one unit across before scaling. */
function shardGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.5); shape.lineTo(0.32, -0.38); shape.lineTo(-0.28, -0.22); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06);
}

/** Bevelled arrow pointing +y, facing +z. */
function arrowGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.24);
  shape.lineTo(0.15, 0.04);
  shape.lineTo(0.055, 0.04);
  shape.lineTo(0.055, -0.22);
  shape.lineTo(-0.055, -0.22);
  shape.lineTo(-0.055, 0.04);
  shape.lineTo(-0.15, 0.04);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.009, bevelSegments: 2 }).translate(0, 0, -0.0225);
}

const CARD_W = 0.46, CARD_H = 0.66;
/** On-screen scale of the event card and the plane (the board is seen from afar). */
const CARD_SCALE = 1.65;
const PLANE_SCALE = 2;

/** Card box: front face = left half of the card texture, back = right half, edges gilt. */
function cardGeometry() {
  const geometry = new THREE.BoxGeometry(CARD_W, CARD_H, 0.014);
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    if (face === 4) uv.setX(i, uv.getX(i) * 0.5);
    else if (face === 5) uv.setX(i, 0.5 + uv.getX(i) * 0.485);
    else uv.setXY(i, 0.997, 0.5);
  }
  return geometry;
}

// -------------------------------------------------------------- textures --
function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d")! };
}
function srgbTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Smoked-glass facade with gilt mullions and a gold crown; emissive map = lit windows (few, large: towers are small on screen). */
function facadeTextures() {
  const W = 128, H = 256;
  const base = canvas2d(W, H), lit = canvas2d(W, H);
  const m = base.ctx, e = lit.ctx;
  const g = m.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#3a3441"); g.addColorStop(1, "#16141a");
  m.fillStyle = g;
  m.fillRect(0, 0, W, H);
  e.fillStyle = "#000000";
  e.fillRect(0, 0, W, H);
  const random = seeded(23);
  const cols = 3, rows = 8, top = 22, cw = (W - 16) / cols, rh = (H - top - 8) / rows;
  for (let row = 0; row < rows; row++) {
    const rowLit = random() < 0.35;
    for (let c = 0; c < cols; c++) {
      const x = 8 + c * cw + 5, y = top + row * rh + 5, w = cw - 10, h = rh - 12;
      m.fillStyle = "rgba(6,5,8,0.95)";
      m.fillRect(x, y, w, h);
      if (rowLit || random() < 0.45) {
        e.fillStyle = `rgba(255,${212 + Math.round(random() * 30)},${150 + Math.round(random() * 50)},${0.65 + random() * 0.35})`;
        e.fillRect(x, y, w, h);
      }
    }
  }
  m.fillStyle = "rgba(226,196,134,0.7)";
  for (let c = 0; c <= cols; c++) m.fillRect(6 + c * cw, top - 4, 3, H - top);
  m.fillStyle = "#dcb66c";
  m.fillRect(0, 0, W, 12);
  e.fillStyle = "rgba(255,214,140,0.4)";
  e.fillRect(0, 0, W, 5);
  const textures = { map: srgbTexture(base.canvas), windows: srgbTexture(lit.canvas) };
  textures.map.anisotropy = 4;
  textures.windows.anisotropy = 4;
  return textures;
}

/** Ivory event card: gold "?" on the front, engraved emblem on the back. */
function cardTextures() {
  const W = 512, H = 736, F = 256;
  const base = canvas2d(W, H), lit = canvas2d(W, H);
  const c = base.ctx, e = lit.ctx;
  e.fillStyle = "#000000";
  e.fillRect(0, 0, W, H);
  const gold = (y0: number, y1: number) => {
    const g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, "#f7e2a6"); g.addColorStop(0.45, "#d6ab58"); g.addColorStop(1, "#8f6a2c");
    return g;
  };
  for (const face of [0, 1]) {
    const ox = face * F;
    const paper = c.createLinearGradient(ox, 0, ox + F, H);
    paper.addColorStop(0, "#f9f2e2"); paper.addColorStop(1, "#e0d1b0");
    c.fillStyle = paper;
    c.fillRect(ox, 0, F, H);
    for (const ctx of [c, e]) {
      ctx.strokeStyle = ctx === c ? "#c49a4e" : "#7a7a7a";
      ctx.lineWidth = 8;
      ctx.strokeRect(ox + 16, 16, F - 32, H - 32);
      ctx.lineWidth = 2.5;
      ctx.strokeRect(ox + 30, 30, F - 60, H - 60);
    }
    c.textAlign = "center";
    c.textBaseline = "middle";
    if (face === 0) {
      // Dark bronze "?" with a gold rim: legible at a few dozen pixels.
      c.font = "700 330px Cinzel, Georgia, serif";
      c.lineJoin = "round";
      c.lineWidth = 16;
      c.strokeStyle = gold(H * 0.22, H * 0.72);
      c.strokeText("?", ox + F / 2, H * 0.47);
      c.fillStyle = "#3e2a10";
      c.fillText("?", ox + F / 2, H * 0.47);
      e.font = c.font;
      e.textAlign = "center";
      e.textBaseline = "middle";
      e.lineJoin = "round";
      e.lineWidth = 16;
      e.strokeStyle = "#ffffff";
      e.strokeText("?", ox + F / 2, H * 0.47);
      c.font = "600 26px Cinzel, Georgia, serif";
      c.fillStyle = "#9b7535";
      c.fillText("ÉVÉNEMENT", ox + F / 2, H - 74);
    } else {
      const cx = ox + F / 2, cy = H / 2, R = 70;
      c.strokeStyle = gold(cy - R, cy + R);
      c.lineWidth = 4;
      c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
      c.beginPath(); c.ellipse(cx, cy, R * 0.45, R, 0, 0, TAU); c.stroke();
      c.beginPath(); c.ellipse(cx, cy, R, R * 0.36, 0, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
      c.font = "600 22px Cinzel, Georgia, serif";
      c.fillStyle = "#9b7535";
      c.fillText("GLOBAL FUND", cx, H - 74);
    }
  }
  c.fillStyle = "#d6ae5e";
  c.fillRect(W - 4, 0, 4, H);
  return { map: srgbTexture(base.canvas), glow: srgbTexture(lit.canvas) };
}

// --------------------------------------------------------------- palette --
const color = (hex: string) => new THREE.Color(hex);
const C = {
  white: color("#ffffff"),
  tech: color("#4a7fd0"), techHi: color("#a9d6ff"),
  gold: color("#f0bf62"), goldHi: color("#fff0c4"),
  steel: color("#aeb8c3"), spark: color("#ff9a3c"), sparkHi: color("#fff1c2"),
  health: color("#34a88f"), healthHi: color("#9cf7d6"),
  energy: color("#ef7a2c"), energyHi: color("#ffd27a"), flameDeep: color("#d8401c"),
  estate: color("#9b72d6"), estateHi: color("#e2d0ff"),
  agri: color("#8db354"), agriHi: color("#eef5a8"),
  media: color("#d65b86"), mediaHi: color("#ffc6dc"),
  transport: color("#3fa6c4"), transportHi: color("#d2f5ff"),
  bull: color("#36d898"), bullHi: color("#c4ffe4"),
  bear: color("#9fb0c2"), bearHi: color("#e3e9ef"),
  crash: color("#ff3048"), crashHi: color("#ffb3a3"),
  champagne: color("#ead2a0"),
};
const mix = (a: THREE.Color, b: THREE.Color, t: number) => _c.copy(a).lerp(b, t);
const hash = (n: number) => {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
};

// ------------------------------------------------------------------ gears --
const GEAR_TILT = -0.5;
const GEAR_SCALE = 1.55;
const GEAR_SPECS = [{ teeth: 12, r: 0.26 }, { teeth: 8, r: 0.17 }, { teeth: 6, r: 0.13 }] as const;
const GEAR_ANGLES = [0, 0.42, Math.PI - 0.52] as const;
const GEAR_CENTRE = { x: 0.12, y: 0.66 };
/**
 * Layout of the three gears (local XY) and the start phase that makes their
 * teeth mesh: a tooth of A facing direction φ meets a gap of B.
 */
const GEAR_LAYOUT = GEAR_SPECS.map((spec, i) => {
  if (i === 0) return { x: GEAR_CENTRE.x, y: GEAR_CENTRE.y, ratio: 1, phase: 0 };
  const big = GEAR_SPECS[0];
  const phi = GEAR_ANGLES[i]!;
  const d = big.r + spec.r;
  return {
    x: GEAR_CENTRE.x + Math.cos(phi) * d,
    y: GEAR_CENTRE.y + Math.sin(phi) * d,
    ratio: -big.teeth / spec.teeth,
    phase: phi + Math.PI - (TAU / spec.teeth) * (0.5 - (phi * big.teeth) / TAU),
  };
});
const GEAR_CONTACT = { x: GEAR_CENTRE.x + Math.cos(GEAR_ANGLES[1]) * GEAR_SPECS[0].r, y: GEAR_CENTRE.y + Math.sin(GEAR_ANGLES[1]) * GEAR_SPECS[0].r };

// ------------------------------------------------------------------ plan --
const COIN_G = 7.8;
const COIN_MAX = 12;
/** Coin radius / half thickness, and the ring around the figurine they launch from. */
const COIN_R = 0.18;
const COIN_T = 0.016;
const COIN_RING = 0.22;
const TOWER_SPOTS: readonly [number, number][] = [
  [-0.75, -0.85], [0.15, -0.9], [0.8, -0.72], [-0.8, -0.38], [0.78, -0.3], [-0.8, 0.08],
  [0.8, 0.12], [-0.72, 0.52], [0.75, 0.56], [0.05, 0.86], [-0.55, 0.9], [0.55, 0.92],
];

interface Plan {
  key: string;
  theme: FxTheme;
  /** Cell centre on the plaque (world). */
  cx: number; cz: number; y: number;
  /** Unit vectors along the track and towards the board centre. */
  ax: number; az: number; ix: number; iz: number;
  /** Half extents along / inward (with a small margin). */
  ha: number; hi: number;
  /** Figurine stand point (world) and its local coordinates. */
  sx: number; sz: number; su: number; sv: number;
  /** Decal yaw aligning local x with `along`. */
  yaw: number;
  /** Flight direction (transport), world x / z. */
  fx: number; fz: number;
  rand: Float32Array;
  traces: Float32Array;
  coins: Float32Array;
  towers: Float32Array;
  towerCount: number;
}

function emptyPlan(): Plan {
  return {
    key: "", theme: "neutral", cx: 0, cz: 0, y: PLAQUE_TOP, ax: 1, az: 0, ix: 0, iz: -1, ha: 0.4, hi: 0.8,
    sx: 0, sz: 0, su: 0, sv: 0, yaw: 0, fx: 1, fz: 0,
    rand: new Float32Array(512), traces: new Float32Array(6 * 4 * 2), coins: new Float32Array(COIN_MAX * 8), towers: new Float32Array(8 * 5), towerCount: 0,
  };
}

const wx = (P: Plan, u: number, v: number) => P.cx + P.ax * u + P.ix * v;
const wz = (P: Plan, u: number, v: number) => P.cz + P.az * u + P.iz * v;

function buildPlan(P: Plan, arrival: NonNullable<BoardRuntime["arrival"]>, key: string) {
  const cell = cellAt(arrival.cell);
  P.key = key;
  P.theme = arrival.theme;
  P.cx = cell.cx;
  P.cz = cell.cz;
  P.y = PLAQUE_TOP;
  let [ax, az] = cell.along;
  let [ix, iz] = cell.inward;
  if (cell.side === "corner") { ax = 1; az = 0; ix = 0; iz = cell.cz > 0 ? -1 : 1; }
  P.ax = ax; P.az = az; P.ix = ix; P.iz = iz;
  const w = cell.x1 - cell.x0, d = cell.z1 - cell.z0;
  P.ha = (Math.abs(ax) > 0.5 ? w : d) / 2 - 0.06;
  P.hi = (Math.abs(ix) > 0.5 ? w : d) / 2 - 0.06;
  const stand = standOffset(cell);
  P.sx = cell.cx + stand.x;
  P.sz = cell.cz + stand.z;
  P.su = stand.x * ax + stand.z * az;
  P.sv = stand.x * ix + stand.z * iz;
  P.yaw = Math.atan2(-az, ax);
  if (Math.abs(ax) > 0.5) { P.fx = ax; P.fz = 0; } else { P.fx = 1; P.fz = 0; }
  const random = seeded(arrival.key * 131 + arrival.cell * 7919 + 17);
  for (let i = 0; i < P.rand.length; i++) P.rand[i] = random();

  // Technology: Manhattan circuit traces from the figurine to the plaque edges.
  for (let k = 0; k < 6; k++) {
    let u = P.su + (random() - 0.5) * 0.1, v = P.sv + (random() - 0.5) * 0.12;
    let dir = k < 4 ? k : random() < 0.5 ? 1 : 3;
    for (let p = 0; p < 4; p++) {
      const o = (k * 4 + p) * 2;
      P.traces[o] = u;
      P.traces[o + 1] = v;
      if (p === 3) break;
      const du = dir === 0 ? 1 : dir === 2 ? -1 : 0, dv = dir === 1 ? 1 : dir === 3 ? -1 : 0;
      const len = (0.12 + random() * 0.28) * (dv ? 1.5 : 1);
      u = Math.max(-P.ha, Math.min(P.ha, u + du * len));
      v = Math.max(-P.hi, Math.min(P.hi, v + dv * len));
      dir = (dir + (random() < 0.5 ? 1 : 3)) % 4;
    }
  }
  // Finance: ballistic coins whose spin lands them flat.
  for (let i = 0; i < COIN_MAX; i++) {
    const vUp = 2.9 + 0.7 * random(), vOut = 0.45 + 0.4 * random();
    const ang = (i / COIN_MAX) * TAU + random() * 0.5;
    const tLand = (vUp + Math.sqrt(vUp * vUp + 2 * COIN_G * (0.03 - COIN_T))) / COIN_G;
    const spin = (Math.max(1, Math.round(((9 + 6 * random()) * tLand) / Math.PI)) * Math.PI) / tLand;
    const o = i * 8;
    P.coins[o] = 0.02 + i * 0.024;
    P.coins[o + 1] = vUp;
    P.coins[o + 2] = vOut;
    P.coins[o + 3] = ang;
    P.coins[o + 4] = -Math.sin(ang);
    P.coins[o + 5] = Math.cos(ang);
    P.coins[o + 6] = spin;
    P.coins[o + 7] = tLand;
  }
  // Real estate: towers on free spots around the figurine.
  const order = TOWER_SPOTS.map((spot, i) => ({ spot, key: random(), i }))
    .filter(({ spot }) => Math.hypot(spot[0] * (P.ha + 0.12) - P.su, spot[1] * P.hi - P.sv) > 0.3)
    .sort((a, b) => a.key - b.key)
    .slice(0, 8);
  P.towerCount = order.length;
  order.forEach(({ spot }, i) => {
    const o = i * 5;
    P.towers[o] = spot[0] * (P.ha + 0.12);
    P.towers[o + 1] = spot[1] * (P.hi - 0.02);
    P.towers[o + 2] = 0.2 + 0.08 * random();
    P.towers[o + 3] = 0.2 + 0.07 * random();
    P.towers[o + 4] = 0.55 + 0.7 * random();
  });
}

// --------------------------------------------------------------- recipes --
interface Fx {
  plan: Plan;
  lite: boolean;
  sprites: GlowBatch;
  decals: GlowBatch;
  coins: LitPool;
  towers: LitPool;
  stalks: LitPool;
  arrows: LitPool;
  shards: LitPool;
  gears: THREE.Group;
  gearMeshes: THREE.Mesh[];
  plane: THREE.Mesh;
  card: THREE.Group;
  cardFace: THREE.MeshStandardMaterial;
  cardSheen: THREE.ShaderMaterial;
  towerMaterial: THREE.MeshStandardMaterial;
  arrowBull: THREE.MeshStandardMaterial;
  arrowBear: THREE.MeshStandardMaterial;
}

const count = (X: Fx, n: number) => (X.lite ? Math.ceil(n * 0.5) : n);

/** Expanding ring on the plaque. */
function ripple(X: Fx, t: number, t0: number, dur: number, r0: number, r1: number, c: THREE.Color, intensity: number, x = X.plan.sx, z = X.plan.sz) {
  const p = (t - t0) / dur;
  if (p < 0 || p >= 1) return;
  const size = (r0 + (r1 - r0) * easeOutCubic(p)) / RING_R;
  X.decals.decal(x, X.plan.y + 0.007, z, size, size, 0, c, intensity * Math.pow(1 - p, 1.5), G.ring);
}

/** Soft pool of light on the plaque. */
function pool(X: Fx, t: number, c: THREE.Color, intensity: number, size: number, a: number, b: number, d0: number, d1: number, x = X.plan.sx, z = X.plan.sz) {
  X.decals.decal(x, X.plan.y + 0.006, z, size, size, 0, c, intensity * envelope(t, a, b, d0, d1), G.dot);
}

function fxTechnology(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites, D = X.decals;
  const y = P.y + 0.008;
  ripple(X, t, 0, 0.75, 0.15, 1.1, C.tech, 2);
  pool(X, t, C.tech, 0.9, 1.6, 0, 0.1, 0.9, 1.6);
  // A holographic scan ring climbs the figurine.
  if (t < 0.8) {
    const scan = clamp01(t / 0.7);
    D.decal(P.sx, P.y + 0.05 + 1.1 * easeOutCubic(scan), P.sz, 0.95, 0.95, 0, C.techHi, 2.2 * Math.sin(scan * Math.PI), G.ring);
  }
  const fade = 1 - smoothstep(0.95, 1.55, t);
  const traces = count(X, 6);
  for (let k = 0; k < traces; k++) {
    const head = Math.max(0, (t - 0.03 - k * 0.04) * 2.7);
    let acc = 0;
    for (let s = 0; s < 3; s++) {
      const o = (k * 4 + s) * 2;
      const u0 = P.traces[o]!, v0 = P.traces[o + 1]!, du = P.traces[o + 2]! - u0, dv = P.traces[o + 3]! - v0;
      const len = Math.hypot(du, dv);
      if (len < 1e-4) continue;
      const drawn = Math.min(len, Math.max(0, head - acc));
      if (drawn > 0) {
        const f = drawn / len;
        const dx = (P.ax * du + P.ix * dv) / len, dz = (P.az * du + P.iz * dv) / len;
        D.decal(wx(P, u0 + du * f * 0.5, v0 + dv * f * 0.5), y, wz(P, u0 + du * f * 0.5, v0 + dv * f * 0.5), 0.09, drawn + 0.06, Math.atan2(-dx, -dz), mix(C.tech, C.techHi, 0.35), 3 * fade, G.streak);
        if (head - acc < len) S.sprite(wx(P, u0 + du * f, v0 + dv * f), y + 0.03, wz(P, u0 + du * f, v0 + dv * f), 0.17, 0.17, 0, C.techHi, 3.2, G.dot);
      }
      acc += len;
    }
    if (head >= acc) {
      const e = (k * 4 + 3) * 2;
      const pop = easeOutBack(clamp01((head - acc) / 0.35));
      const ex = wx(P, P.traces[e]!, P.traces[e + 1]!), ez = wz(P, P.traces[e]!, P.traces[e + 1]!);
      D.decal(ex, y + 0.001, ez, 0.16 * pop, 0.16 * pop, 0, C.techHi, 2.6 * fade, G.ring);
      S.sprite(ex, y + 0.02, ez, 0.09, 0.09, 0, C.techHi, 2.4 * fade, G.dot);
    }
  }
  const squares = count(X, 12);
  for (let i = 0; i < squares; i++) {
    const age = t - (0.12 + i * 0.06);
    if (age < 0 || age > 1.25) continue;
    const a = r[40 + i]! * TAU, rad = 0.32 + 0.34 * r[60 + i]!, size = 0.2 + 0.14 * r[80 + i]!;
    const x = P.sx + Math.cos(a) * rad, z = P.sz + Math.sin(a) * rad * 0.7;
    const h = P.y + 0.3 + age * (0.8 + 0.45 * r[100 + i]!);
    const flicker = hash(Math.floor(t * 18) + i * 7) > 0.26 ? 1 : 0.5;
    const alpha = envelope(age, 0, 0.12, 0.8, 1.25) * flicker;
    S.sprite(x, h, z, size, size, 0, mix(C.tech, C.techHi, 0.35), 2.4 * alpha, G.square);
    if (i % 2 === 0) S.sprite(x + size * 0.85, h - size * 0.55, z, size * 0.3, size * 0.3, 0, C.techHi, 2.6 * alpha, G.dot);
  }
}

function fxFinance(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites;
  ripple(X, t, 0, 0.75, 0.15, 1.1, C.gold, 1.9);
  if (t < 0.32) S.sprite(P.sx, P.y + 0.3, P.sz, 0.8 + t * 1.6, 0.8 + t * 1.6, 0, C.gold, 1.8 * Math.pow(1 - t / 0.32, 2), G.disc);
  const coins = count(X, 11);
  const ground = P.y + COIN_T;
  for (let i = 0; i < coins; i++) {
    const o = i * 8;
    const t0 = P.coins[o]!, vUp = P.coins[o + 1]!, vOut = P.coins[o + 2]!, ang = P.coins[o + 3]!;
    const spin = P.coins[o + 6]!, tLand = P.coins[o + 7]!;
    const tau = t - t0;
    if (tau < 0) continue;
    let y: number, rot: number, d: number;
    if (tau < tLand) {
      y = P.y + 0.03 + vUp * tau - 0.5 * COIN_G * tau * tau;
      rot = spin * tau;
      d = vOut * tau;
    } else {
      const after = tau - tLand;
      y = ground + (after < 0.24 ? Math.sin((after / 0.24) * Math.PI) * 0.07 : 0);
      rot = spin * tLand + 0.35 * Math.sin(after * 28) * Math.exp(-after * 9);
      d = vOut * tLand + vOut * 0.16 * (1 - Math.exp(-after * 9));
    }
    const k = easeInCubic((t - 1.32 - i * 0.03) / 0.36);
    if (k >= 0.99) continue;
    d += COIN_RING;
    _p.set(P.sx + Math.cos(ang) * d, Math.max(y, ground) - k * 0.03, P.sz + Math.sin(ang) * d);
    _axis.set(P.coins[o + 4]!, 0, P.coins[o + 5]!);
    _q.setFromAxisAngle(_axis, rot);
    _s.setScalar(1 - k);
    X.coins.push(_p, _q, _s);
    if (i % 3 === 0) {
      const apex = t0 + vUp / COIN_G;
      const g = envelope(t, apex - 0.1, apex, apex + 0.03, apex + 0.3);
      if (g > 0) S.sprite(_p.x, _p.y + 0.05, _p.z, 0.46, 0.46, t * 3 + i, C.goldHi, 3.4 * g, G.star);
    }
  }
  ripple(X, t, 0.78, 0.6, 0.15, 0.9, C.gold, 1.5);
  // Gold dust rising as the coins sink into the plaque.
  const motes = count(X, 10);
  for (let i = 0; i < motes; i++) {
    const age = t - (1.32 + i * 0.04);
    if (age < 0 || age > 0.75) continue;
    const a = r[200 + i]! * TAU, rad = 0.25 + r[220 + i]! * 0.5;
    S.sprite(P.sx + Math.cos(a) * rad, P.y + 0.06 + age * 0.8, P.sz + Math.sin(a) * rad, 0.075, 0.075, 0, C.goldHi, 2.6 * envelope(age, 0, 0.1, 0.45, 0.75), G.dot);
  }
}

function fxIndustry(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites;
  const rise = t < 1 ? easeOutBack(clamp01(t / 0.5), 1.2) : 1;
  const sink = easeInCubic((t - 1.32) / 0.45);
  const lift = (rise - 1) * 1.5 - sink * 1.6;
  const gx = P.sx - 0.22, gz = P.sz - 0.34;
  X.gears.visible = sink < 0.999;
  X.gears.position.set(gx, P.y + lift, gz);
  X.gears.rotation.set(GEAR_TILT, 0, 0);
  X.gears.scale.setScalar(GEAR_SCALE);
  const theta = 2.4 * t + 0.9 * t * t;
  for (let i = 0; i < 3; i++) X.gearMeshes[i]!.rotation.z = GEAR_LAYOUT[i]!.phase + GEAR_LAYOUT[i]!.ratio * theta;
  pool(X, t, C.steel, 0.7, 1.7, 0, 0.15, 1.2, 1.7, gx, gz + 0.15);
  ripple(X, t, 0, 0.7, 0.15, 1, C.steel, 1.7);
  // Sparks where the large and the medium gear mesh.
  const ly = GEAR_CONTACT.y * GEAR_SCALE, lz = 0.03 * GEAR_SCALE;
  const cx = gx + GEAR_CONTACT.x * GEAR_SCALE;
  const cy = P.y + lift + ly * Math.cos(GEAR_TILT) - lz * Math.sin(GEAR_TILT);
  const cz = gz + ly * Math.sin(GEAR_TILT) + lz * Math.cos(GEAR_TILT);
  const per = X.lite ? 4 : 9;
  for (let b = 0; b < 3; b++) {
    for (let j = 0; j < per; j++) {
      const i = b * 9 + j;
      const age = t - (0.42 + b * 0.3) - r[300 + i]! * 0.06;
      const life = 0.34 + 0.26 * r[330 + i]!;
      if (age < 0 || age > life) continue;
      const a = -0.5 + r[360 + i]! * 2.4;
      const sp = 0.9 + r[390 + i]! * 1.1;
      const vx = Math.cos(a) * sp, vy = 0.9 + r[420 + i]! * 1.5, vz = 0.5 + r[450 + i]! * 0.7;
      const f = age / life;
      S.streak(cx + vx * age, cy + vy * age - 2.8 * age * age, cz + vz * age, vx * 0.06, (vy - 5.6 * age) * 0.06, vz * 0.06, 0.07, mix(C.sparkHi, C.spark, f), 4 * (1 - f), G.streak);
    }
  }
}

/** Times of the two QRS peaks of the heartbeat line (drawn in 0.72 s from 0.05 s). */
const ECG_BEATS = [0.05 + 0.72 * 0.31, 0.05 + 0.72 * 0.73] as const;
const SIDES = [-1, 1] as const;

function fxHealth(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites;
  const reveal = clamp01((t - 0.05) / 0.72);
  const fade = 1 - smoothstep(1.05, 1.6, t);
  S.sprite(P.sx, P.y + 1.48, P.sz, 2, 0.5, 0, mix(C.health, C.healthHi, 0.55), 2.6 * fade * smoothstep(0, 0.05, t), G.ecg, reveal < 1 ? reveal : 2);
  for (const beat of ECG_BEATS) {
    ripple(X, t, beat, 0.85, 0.15, 1.15, C.health, 2.1);
    pool(X, t, C.healthHi, 1, 1, beat, beat + 0.04, beat + 0.08, beat + 0.42);
  }
  const crosses = count(X, 9);
  for (let i = 0; i < crosses; i++) {
    const age = t - (0.2 + i * 0.1);
    if (age < 0 || age > 1.3) continue;
    const a = r[40 + i]! * TAU, rad = 0.34 + 0.32 * r[60 + i]!, size = 0.22 + 0.1 * r[80 + i]!;
    const x = P.sx + Math.cos(a) * rad + Math.sin(age * 3 + i) * 0.04;
    const z = P.sz + Math.sin(a) * rad * 0.7;
    S.sprite(x, P.y + 0.3 + age * (0.55 + 0.2 * r[100 + i]!), z, size, size, (r[120 + i]! - 0.5) * 0.5, mix(C.health, C.healthHi, 0.45), 2.5 * envelope(age, 0, 0.18, 0.85, 1.3), G.cross);
  }
}

const BOLT_WINDOWS = [0.03, 0.1, 0.15, 0.21, 0.28, 0.35] as const;

function fxEnergy(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites;
  pool(X, t, C.energy, 1.3, 1.7, 0, 0.06, 0.6, 1.4);
  ripple(X, t, 0, 0.6, 0.15, 1.05, C.energyHi, 1.9);
  for (let k = 0; k < 3; k++) {
    const a0 = BOLT_WINDOWS[k * 2]!, a1 = BOLT_WINDOWS[k * 2 + 1]!;
    if (t < a0 || t > a1) continue;
    const f = Math.sin(((t - a0) / (a1 - a0)) * Math.PI);
    const ang = r[10 + k]! * TAU;
    S.sprite(P.sx + Math.cos(ang) * 0.36, P.y + 0.65 + r[20 + k]! * 0.45, P.sz + Math.sin(ang) * 0.24, 0.95, 0.95, (r[30 + k]! - 0.5) * 0.9, mix(C.white, C.energyHi, 0.35), 4.2 * f, G.bolt);
  }
  const flames = count(X, 8);
  const env = envelope(t, 0.02, 0.2, 0.85, 1.4);
  for (let k = 0; k < flames; k++) {
    const ang = (k / flames) * TAU + 0.3;
    const flick = 0.8 + 0.14 * Math.sin(t * 31 + k * 1.7) + 0.1 * Math.sin(t * 53 + k * 3.1);
    const h = (0.55 + 0.25 * r[40 + k]!) * flick * env;
    if (h < 0.01) continue;
    const x = P.sx + Math.cos(ang) * 0.38, z = P.sz + Math.sin(ang) * 0.3;
    const lean = 0.08 * Math.sin(t * 9 + k * 2.3);
    S.sprite(x, P.y + h * 0.44, z, h * 0.5, h, lean, C.flameDeep, 2.4, G.flame);
    S.sprite(x, P.y + h * 0.36, z, h * 0.34, h * 0.72, lean, C.energy, 2.2, G.flame);
    S.sprite(x, P.y + h * 0.24, z, h * 0.18, h * 0.4, lean, C.energyHi, 1.6, G.flame);
  }
  const embers = count(X, 32);
  for (let i = 0; i < embers; i++) {
    const age = t - (0.04 + i * 0.032);
    const life = 0.6 + 0.45 * r[100 + i]!;
    if (age < 0 || age > life) continue;
    const a = r[140 + i]! * TAU, spread = 0.35 + 0.5 * r[180 + i]!;
    const vx = Math.cos(a) * spread, vz = Math.sin(a) * spread * 0.8, vy = 1.6 + 1.2 * r[220 + i]!;
    const f = age / life;
    S.streak(
      P.sx + Math.cos(a) * 0.3 + vx * age + 0.06 * Math.sin(age * 12 + i), P.y + 0.1 + vy * age - 0.9 * age * age, P.sz + Math.sin(a) * 0.22 + vz * age,
      vx * 0.06, (vy - 1.8 * age) * 0.06, vz * 0.06, 0.065, mix(C.sparkHi, C.energy, f), 3.6 * Math.pow(1 - f, 1.2), G.streak,
    );
  }
}

function fxRealEstate(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites;
  pool(X, t, C.estate, 1, 1.9, 0, 0.15, 1.25, 1.75, P.cx, P.cz);
  ripple(X, t, 0, 0.7, 0.15, 1.05, C.estateHi, 1.8);
  X.towerMaterial.emissiveIntensity = 1.5 * envelope(t, 0.22, 0.55, 1.25, 1.6);
  const n = Math.min(count(X, 7), P.towerCount);
  _q.setFromAxisAngle(UP, P.yaw);
  for (let i = 0; i < n; i++) {
    const o = i * 5;
    const grow = easeOutBack(clamp01((t - 0.02 - i * 0.05) / 0.42), 1.5);
    const sy = grow * (1 - easeInCubic((t - 1.28 - i * 0.04) / 0.38));
    if (sy <= 0.004) continue;
    const u = P.towers[o]!, v = P.towers[o + 1]!;
    _p.set(wx(P, u, v), P.y - 0.003, wz(P, u, v));
    _s.set(P.towers[o + 2]!, P.towers[o + 4]! * sy, P.towers[o + 3]!);
    X.towers.push(_p, _q, _s);
  }
  const motes = count(X, 10);
  for (let i = 0; i < motes; i++) {
    const age = t - (0.3 + i * 0.08);
    if (age < 0 || age > 1.1) continue;
    const u = (r[300 + i]! - 0.5) * 2.4 * P.ha, v = (r[320 + i]! - 0.5) * 2 * P.hi;
    S.sprite(wx(P, u, v), P.y + 0.15 + age * 1.05, wz(P, u, v), 0.07, 0.07, 0, C.goldHi, 2.4 * envelope(age, 0, 0.15, 0.65, 1.1), G.dot);
  }
}

function fxAgrifood(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites;
  pool(X, t, C.agri, 0.9, 1.8, 0, 0.15, 1.2, 1.7);
  ripple(X, t, 0, 0.75, 0.15, 1.1, C.agriHi, 1.6);
  const n = count(X, 14);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r[10 + i]! * 0.4;
    const rad = 0.3 + 0.36 * r[30 + i]!;
    const x = P.sx + Math.cos(a) * rad, z = P.sz + Math.sin(a) * rad * 0.78;
    const grow = easeOutBack(clamp01((t - 0.02 - (rad - 0.3) * 0.5 - i * 0.01) / 0.5), 1.3);
    const s = grow * (1 - easeInCubic((t - 1.3 - i * 0.025) / 0.42));
    if (s <= 0.01) continue;
    const h = 0.75 + 0.35 * r[50 + i]!;
    const sway = (0.14 * Math.sin(t * 3.4 + i * 0.8 - x * 3) + 0.05 * Math.sin(t * 7.3 + i)) * Math.min(1, grow);
    _e.set(0.06 * Math.sin(t * 2.1 + i), r[70 + i]! * TAU, sway, "ZYX");
    _q.setFromEuler(_e);
    _p.set(x, P.y - 0.002, z);
    _s.set(h * (0.9 + 0.2 * r[90 + i]!), h * s, h);
    X.stalks.push(_p, _q, _s);
  }
  const drift = count(X, 14);
  for (let i = 0; i < drift; i++) {
    const age = t - (0.3 + i * 0.065);
    if (age < 0 || age > 1.3) continue;
    const x = P.sx + (r[100 + i]! - 0.5) * 1 + age * 0.38;
    const z = P.sz + (r[120 + i]! - 0.5) * 0.6;
    const y = P.y + 0.55 + r[140 + i]! * 0.35 + age * 0.5 + 0.04 * Math.sin(age * 5 + i);
    const alpha = envelope(age, 0, 0.2, 0.85, 1.3);
    if (i % 2 === 0) S.sprite(x, y, z, 0.17, 0.17, age * 2.4 * (r[160 + i]! - 0.5) + i, C.agri, 2.1 * alpha, G.leaf);
    else S.sprite(x, y, z, 0.07, 0.07, 0, C.agriHi, 2.3 * alpha, G.dot);
  }
}

function fxMedia(X: Fx, t: number) {
  const P = X.plan, S = X.sprites;
  const waves = count(X, 5);
  for (let k = 0; k < waves; k++) ripple(X, t, k * 0.17, 0.95, 0.12, 1.45, C.media, 1.6);
  const ay = P.y + 1.1;
  const env = envelope(t, 0, 0.08, 1, 1.45);
  const pulse = 0.2 + 0.05 * Math.sin(t * 28);
  S.sprite(P.sx, ay, P.sz, pulse, pulse, 0, C.mediaHi, 3.2 * env, G.dot);
  S.streak(P.sx, P.y + 0.55, P.sz, 0, 1.05, 0, 0.09, C.media, 0.75 * env, G.streak);
  for (let k = 0; k < 3; k++) {
    const age = t - (0.1 + k * 0.17);
    if (age < 0 || age > 0.95) continue;
    const size = 0.45 + age * 1.45;
    const alpha = 2 * envelope(age, 0, 0.1, 0.35, 0.95);
    const c = mix(C.media, C.mediaHi, 0.25);
    S.sprite(P.sx, ay, P.sz, size, size, 0, c, alpha, G.arc);
    S.sprite(P.sx, ay, P.sz, size, size, Math.PI, c, alpha, G.arc);
  }
}

const FLIGHT = 1.55;
function flightPose(P: Plan, p: number, out: THREE.Vector3) {
  const lateral = 0.22 * Math.sin(Math.PI * p);
  const along = -1.6 + 3.2 * p;
  return out.set(
    P.cx + P.fx * along - P.fz * lateral,
    P.y + 0.95 + 0.3 * p + 0.05 * Math.sin(TAU * p),
    P.cz + P.fz * along + P.fx * lateral,
  );
}

function fxTransport(X: Fx, t: number) {
  const P = X.plan, S = X.sprites;
  ripple(X, t, 0, 0.7, 0.15, 1, C.transport, 1.8);
  const p = t / FLIGHT;
  if (p < 1) {
    flightPose(P, p, _p);
    flightPose(P, Math.min(1, p + 0.01), _v);
    const dx = _v.x - _p.x, dy = _v.y - _p.y, dz = _v.z - _p.z;
    _e.set(-0.4 * Math.cos(Math.PI * p), Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)), "YZX");
    X.plane.quaternion.setFromEuler(_e);
    X.plane.position.copy(_p);
    const s = PLANE_SCALE * smoothstep(0, 0.1, p) * (1 - smoothstep(0.88, 1, p));
    X.plane.scale.setScalar(Math.max(0.001, s));
    X.plane.visible = s > 0.01;
    X.decals.decal(_p.x, P.y + 0.006, _p.z, 0.85, 0.85, 0, C.transport, (0.6 * s) / PLANE_SCALE, G.dot);
  }
  const trail = count(X, 48);
  for (let j = 0; j < trail; j++) {
    const born = (j * FLIGHT * 0.92) / trail;
    const age = t - born;
    if (age < 0 || age > 0.8) continue;
    const q = born / FLIGHT;
    flightPose(P, q, _p);
    flightPose(P, Math.min(1, q + 0.01), _v);
    const dx = _v.x - _p.x, dz = _v.z - _p.z, len = Math.hypot(dx, dz) || 1;
    const lx = -dz / len, lz = dx / len;
    const f = age / 0.8;
    const size = 0.08 + age * 0.22;
    const alpha = 1.35 * Math.pow(1 - f, 1.5) * smoothstep(0, 0.08, q);
    const c = mix(C.transportHi, C.white, 0.2);
    for (const side of SIDES) {
      S.sprite(_p.x + lx * 0.36 * side - (dx / len) * 0.18, _p.y - 0.02, _p.z + lz * 0.36 * side - (dz / len) * 0.18, size, size, 0, c, alpha, G.dot);
    }
  }
}

function fxStart(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites, D = X.decals;
  const cx = P.cx, cz = P.cz;
  if (t < 0.4) S.sprite(cx, P.y + 0.35, cz, 1.4 + t * 2, 1.4 + t * 2, 0, C.gold, 1.6 * Math.pow(1 - t / 0.4, 2), G.disc);
  const rays = count(X, 14);
  const grow = easeOutCubic(t / 0.55);
  const env = envelope(t, 0, 0.08, 0.6, 1.3);
  for (let k = 0; k < rays; k++) {
    const a = (k / rays) * TAU + t * 0.25;
    const len = (0.35 + 1.25 * grow) * (k % 2 ? 0.6 : 1);
    const dx = Math.cos(a), dz = Math.sin(a), mid = 0.18 + len / 2;
    D.decal(cx + dx * mid, P.y + 0.008, cz + dz * mid, 0.1, len, Math.atan2(-dx, -dz), mix(C.gold, C.goldHi, 0.15), 1.5 * env, G.streak);
  }
  ripple(X, t, 0, 0.9, 0.25, 1.8, C.gold, 2, cx, cz);
  ripple(X, t, 0.16, 0.9, 0.2, 1.3, C.gold, 1.5, cx, cz);
  const motes = count(X, 18);
  for (let i = 0; i < motes; i++) {
    const age = t - (0.08 + i * 0.035);
    if (age < 0 || age > 1.35) continue;
    const a = i * 2.39996 + age * 2.2;
    const rad = (0.3 + 0.45 * r[40 + i]!) * (1 - age * 0.25);
    const size = 0.06 + 0.035 * r[60 + i]!;
    S.sprite(cx + Math.cos(a) * rad, P.y + 0.12 + age * 1.2, cz + Math.sin(a) * rad, size, size, 0, C.gold, 2.6 * envelope(age, 0, 0.15, 0.85, 1.35), G.dot);
  }
  const sparkles = count(X, 8);
  for (let i = 0; i < sparkles; i++) {
    const age = t - (0.15 + i * 0.09);
    if (age < 0 || age > 0.38) continue;
    const a = r[80 + i]! * TAU, rad = 0.4 + 0.5 * r[90 + i]!;
    const k = Math.sin((age / 0.38) * Math.PI);
    S.sprite(cx + Math.cos(a) * rad, P.y + 0.3 + r[100 + i]!, cz + Math.sin(a) * rad, 0.38 * k, 0.38 * k, age * 4, C.goldHi, 3.2 * k, G.star);
  }
}

function fxEvent(X: Fx, t: number) {
  const P = X.plan, S = X.sprites;
  ripple(X, t, 0, 0.8, 0.15, 1.1, C.champagne, 2.1);
  pool(X, t, C.champagne, 0.8, 1.5, 0, 0.15, 1.3, 1.8);
  const exit = easeInCubic((t - 1.5) / 0.35);
  const scale = easeOutBack(clamp01(t / 0.38), 1.6) * (1 - exit) * CARD_SCALE;
  const cy = P.y + 1.6;
  if (scale > 0.005) {
    X.card.visible = true;
    X.card.position.set(P.sx, P.y + 0.4 + 1.2 * easeOutCubic(t / 0.5) + 0.03 * Math.sin(t * 4.2) + exit * 0.2, P.sz);
    X.card.rotation.set(-0.28, TAU * easeOutCubic(clamp01(t / 0.95)), 0, "YXZ");
    X.card.scale.setScalar(scale);
    X.cardFace.emissiveIntensity = 0.45 + 1.1 * envelope(t, 0.95, 1.12, 1.3, 1.6);
    const sheen = clamp01((t - 0.98) / 0.45);
    X.cardSheen.uniforms.uProgress!.value = sheen;
    X.cardSheen.uniforms.uOpacity!.value = sheen > 0 && sheen < 1 ? Math.sin(sheen * Math.PI) : 0;
  }
  const orbit = count(X, 8);
  for (let i = 0; i < orbit; i++) {
    const a = (i / orbit) * TAU + t * 2.4;
    const alpha = envelope(t, 0.2, 0.45, 1.3, 1.6) * (0.6 + 0.4 * Math.sin(t * 9 + i * 2));
    S.sprite(P.sx + Math.cos(a) * 0.72, cy + Math.sin(a * 2 + i) * 0.18, P.sz + Math.sin(a) * 0.42, 0.17, 0.17, t * 2 + i, C.champagne, 2.6 * alpha, i % 2 ? G.star : G.dot);
  }
  if (t > 1.5 && t < 1.95) {
    const age = t - 1.5;
    const k = Math.sin((age / 0.45) * Math.PI);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.4, d = 0.1 + age * 1.2;
      S.sprite(P.sx + Math.cos(a) * d, cy + 0.2 + Math.sin(a) * d * 0.7, P.sz, 0.3 * k, 0.3 * k, age * 5, C.goldHi, 3 * k, G.star);
    }
  }
}

function fxBull(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites;
  X.arrows.mesh.material = X.arrowBull;
  ripple(X, t, 0, 0.75, 0.15, 1.2, C.bull, 2);
  pool(X, t, C.bull, 1, 1.7, 0, 0.1, 0.9, 1.6);
  S.streak(P.sx, P.y + 1.2, P.sz, 0, 2.4, 0, 0.9, C.bull, 0.6 * envelope(t, 0, 0.12, 0.55, 1.3), G.streak);
  const n = count(X, 5);
  for (let i = 0; i < n; i++) {
    const tau = t - (0.02 + i * 0.07);
    if (tau < 0 || tau > 1.05) continue;
    const s = (1.4 + 0.35 * r[20 + i]!) * smoothstep(0, 0.12, tau) * (1 - smoothstep(0.72, 1.05, tau));
    if (s <= 0.01) continue;
    const a = (i / n) * TAU + 0.4, rad = 0.3 + 0.15 * r[10 + i]!;
    _p.set(P.sx + Math.cos(a) * rad, P.y - 0.4 + 0.7 * tau + 1.9 * tau * tau, P.sz + Math.sin(a) * rad * 0.7);
    _e.set(-0.35, (r[30 + i]! - 0.5) * 0.6, 0, "XYZ");
    _q.setFromEuler(_e);
    _s.setScalar(s);
    X.arrows.push(_p, _q, _s);
  }
  const streaks = count(X, 14);
  for (let i = 0; i < streaks; i++) {
    const tau = t - (0.05 + i * 0.06);
    if (tau < 0 || tau > 0.7) continue;
    const a = r[60 + i]! * TAU, rad = 0.12 + 0.5 * r[80 + i]!;
    S.streak(P.sx + Math.cos(a) * rad, P.y + 0.08 + tau * (2.8 + 1.2 * r[120 + i]!), P.sz + Math.sin(a) * rad * 0.7, 0, 0.28 + 0.24 * r[100 + i]!, 0, 0.05, mix(C.bull, C.goldHi, 0.3 * r[140 + i]!), 2.8 * envelope(tau, 0, 0.1, 0.4, 0.7), G.streak);
  }
}

function fxBear(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites;
  X.arrows.mesh.material = X.arrowBear;
  ripple(X, t, 0, 1.3, 0.2, 1.2, C.bear, 1.6);
  pool(X, t, C.bear, 0.6, 1.7, 0, 0.3, 1.2, 1.9);
  const n = count(X, 4);
  for (let i = 0; i < n; i++) {
    const tau = t - i * 0.12;
    if (tau < 0 || tau > 1.35) continue;
    const a = (i / n) * TAU + 0.8, rad = 0.28 + 0.18 * r[10 + i]!;
    const y0 = P.y + 1.9 + r[20 + i]! * 0.3, y1 = P.y - 0.45;
    _p.set(P.sx + Math.cos(a) * rad, y0 + (y1 - y0) * Math.pow(tau / 1.35, 1.7), P.sz + Math.sin(a) * rad * 0.7);
    _e.set(-0.35, (r[30 + i]! - 0.5) * 0.5, Math.PI, "XYZ");
    _q.setFromEuler(_e);
    _s.setScalar(1.55 * smoothstep(0, 0.22, tau));
    X.arrows.push(_p, _q, _s);
  }
  const mist = count(X, 16);
  for (let i = 0; i < mist; i++) {
    const age = t - i * 0.07;
    if (age < 0 || age > 1.5) continue;
    const size = 0.35 + 0.25 * r[80 + i]!;
    S.sprite(P.sx + (r[40 + i]! - 0.5) * 1.2 + 0.08 * Math.sin(age * 2 + i), P.y + 1.6 - age * 0.9, P.sz + (r[60 + i]! - 0.5) * 0.7, size, size, 0, C.bear, 0.55 * envelope(age, 0, 0.35, 1, 1.5), G.haze);
  }
  const chevrons = count(X, 6);
  for (let i = 0; i < chevrons; i++) {
    const age = t - (0.2 + i * 0.13);
    if (age < 0 || age > 0.9) continue;
    const a = r[100 + i]! * TAU, rad = 0.2 + 0.4 * r[110 + i]!;
    S.sprite(P.sx + Math.cos(a) * rad, P.y + 1.35 - age * 0.95, P.sz + Math.sin(a) * rad * 0.6, 0.2, 0.2, Math.PI, C.bearHi, 1.9 * envelope(age, 0, 0.15, 0.5, 0.9), G.chevron);
  }
}

function fxCrash(X: Fx, t: number) {
  const P = X.plan, r = P.rand, S = X.sprites, D = X.decals;
  if (t < 0.36) S.sprite(P.cx, P.y + 0.35, P.cz, 2.2, 2.2, 0, C.crash, 1.9 * Math.pow(1 - t / 0.36, 2), G.disc);
  const crack = easeOutCubic(clamp01((t - 0.04) / 0.14));
  D.decal(P.cx, P.y + 0.008, P.cz, 1.7 * crack, 1.7 * crack, P.yaw + r[5]! * TAU, C.crash, 2.5 * envelope(t, 0.04, 0.1, 1.1, 1.8), G.crack);
  ripple(X, t, 0, 0.7, 0.15, 1.3, C.crash, 2.2, P.cx, P.cz);
  const n = count(X, 16);
  for (let i = 0; i < n; i++) {
    const tau = t - i * 0.022;
    if (tau < 0) continue;
    const x0 = P.cx + (r[20 + i]! - 0.5) * 1.3, z0 = P.cz + (r[40 + i]! - 0.5) * 1;
    const y0 = P.y + 1.8 + r[60 + i]! * 0.8;
    const hit = Math.sqrt((2 * (y0 - P.y - 0.03)) / 9.5);
    const size = 0.15 + 0.12 * r[80 + i]!;
    _axis.set(r[100 + i]! - 0.5, r[120 + i]! - 0.5, r[140 + i]! - 0.5).normalize();
    const spin = 6 + 6 * r[160 + i]!;
    if (tau < hit) {
      _p.set(x0, y0 - 0.5 * 9.5 * tau * tau, z0);
      _q.setFromAxisAngle(_axis, spin * tau + r[180 + i]! * TAU);
      _s.set(size, size * 1.35, size * 0.6).multiplyScalar(smoothstep(0, 0.05, tau));
      X.shards.push(_p, _q, _s);
      continue;
    }
    const age = tau - hit;
    if (age < 0.14) {
      _p.set(x0, P.y + 0.03, z0);
      _q.setFromAxisAngle(_axis, spin * hit + r[180 + i]! * TAU);
      _s.set(size, size * 1.35, size * 0.6).multiplyScalar(1 - age / 0.14);
      X.shards.push(_p, _q, _s);
    }
    if (age < 0.34 && (!X.lite || i % 2 === 0)) {
      const f = age / 0.34;
      for (let j = 0; j < 3; j++) {
        const b = r[200 + i * 3 + j]! * TAU, sp = 0.8 + 0.8 * r[260 + i * 3 + j]!;
        const vx = Math.cos(b) * sp, vz = Math.sin(b) * sp, vy = 0.7 + 0.9 * r[320 + i * 3 + j]!;
        S.streak(x0 + vx * age, P.y + 0.03 + vy * age - 4 * age * age, z0 + vz * age, vx * 0.045, (vy - 8 * age) * 0.045, vz * 0.045, 0.045, mix(C.crashHi, C.crash, f), 3 * (1 - f), G.streak);
      }
    }
  }
}

function fxNeutral(X: Fx, t: number) {
  ripple(X, t, 0, 0.8, 0.15, 1.05, C.gold, 2);
  pool(X, t, C.gold, 0.8, 1.5, 0, 0.12, 0.8, 1.4);
}

const RECIPES: Record<FxTheme, (X: Fx, t: number) => void> = {
  technology: fxTechnology, finance: fxFinance, industry: fxIndustry, health: fxHealth, energy: fxEnergy,
  realestate: fxRealEstate, agrifood: fxAgrifood, media: fxMedia, transport: fxTransport,
  start: fxStart, event: fxEvent, bull: fxBull, bear: fxBear, crash: fxCrash, neutral: fxNeutral,
};

// -------------------------------------------------------------- assembly --
function createFx(lite: boolean, shadows: boolean) {
  const atlas = glyphTexture();
  const spriteMaterial = glowMaterial(atlas, SPRITE_VERTEX);
  const decalMaterial = glowMaterial(atlas, DECAL_VERTEX);
  const sprites = new GlowBatch(lite ? 120 : 220, spriteMaterial, 8);
  const decals = new GlowBatch(lite ? 32 : 48, decalMaterial, 7);

  const gold = new THREE.MeshStandardMaterial({ color: "#f3c776", metalness: 1, roughness: 0.2, envMapIntensity: 1.5, emissive: "#3d2706", emissiveIntensity: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: "#cfa65e", metalness: 1, roughness: 0.3, envMapIntensity: 1.35 });
  const steel = new THREE.MeshStandardMaterial({ color: "#b8c0c9", metalness: 1, roughness: 0.26, envMapIntensity: 1.35 });
  const facade = facadeTextures();
  const towerMaterial = new THREE.MeshStandardMaterial({ map: facade.map, emissiveMap: facade.windows, emissive: "#ffd08a", emissiveIntensity: 0, metalness: 0.45, roughness: 0.3, envMapIntensity: 1.2 });
  const stalkMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.34, envMapIntensity: 1.3, emissive: "#1d1405", side: THREE.DoubleSide });
  const arrowBull = new THREE.MeshStandardMaterial({ color: "#22c886", emissive: "#0e8f5a", emissiveIntensity: 0.9, metalness: 0.35, roughness: 0.18, envMapIntensity: 1.4 });
  const arrowBear = new THREE.MeshStandardMaterial({ color: "#8f9aa7", emissive: "#252c34", emissiveIntensity: 0.5, metalness: 0.85, roughness: 0.42, envMapIntensity: 1.2 });
  const shardMaterial = new THREE.MeshStandardMaterial({ color: "#c4102c", emissive: "#ff1834", emissiveIntensity: 0.7, metalness: 0.25, roughness: 0.12, envMapIntensity: 1.6, flatShading: true });
  const planeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.3, envMapIntensity: 1.25 });
  const card = cardTextures();
  const cardFace = new THREE.MeshStandardMaterial({ map: card.map, emissiveMap: card.glow, emissive: "#ffcf7a", emissiveIntensity: 0.45, metalness: 0.15, roughness: 0.45 });
  const cardSheen = new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color("#fff3d6").multiplyScalar(2.2) } },
    vertexShader: SHEEN_VERTEX, fragmentShader: SHEEN_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });

  const coinGeo = coinGeometry();
  const towerGeo = towerGeometry();
  const stalkGeo = stalkGeometry();
  const arrowGeo = arrowGeometry();
  const shardGeo = shardGeometry();
  const gearGeos = GEAR_SPECS.map((spec) => gearGeometry(spec.teeth, spec.r));
  const planeGeo = aircraftGeometry();
  const cardGeo = cardGeometry();
  const sheenGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);

  const coins = new LitPool(coinGeo, gold, COIN_MAX, shadows);
  const towers = new LitPool(towerGeo, towerMaterial, 8, shadows);
  const stalks = new LitPool(stalkGeo, stalkMaterial, 10, shadows);
  const arrows = new LitPool(arrowGeo, arrowBull, 6, shadows);
  const shards = new LitPool(shardGeo, shardMaterial, 16, shadows);

  const gears = new THREE.Group();
  const gearMeshes = gearGeos.map((geometry, i) => {
    const mesh = new THREE.Mesh(geometry, i === 1 ? steel : brass);
    mesh.position.set(GEAR_LAYOUT[i]!.x, GEAR_LAYOUT[i]!.y, 0);
    mesh.castShadow = shadows;
    gears.add(mesh);
    return mesh;
  });
  const plane = new THREE.Mesh(planeGeo, planeMaterial);
  plane.castShadow = shadows;
  const cardGroup = new THREE.Group();
  const cardMesh = new THREE.Mesh(cardGeo, cardFace);
  cardMesh.castShadow = shadows;
  const sheen = new THREE.Mesh(sheenGeo, cardSheen);
  sheen.position.z = 0.0085;
  sheen.renderOrder = 9;
  cardGroup.add(cardMesh, sheen);
  for (const object of [gears, plane, cardGroup]) { object.visible = false; object.frustumCulled = false; }

  const root = new THREE.Group();
  root.name = "sector-fx";
  root.add(decals.mesh, sprites.mesh, coins.mesh, towers.mesh, stalks.mesh, arrows.mesh, shards.mesh, gears, plane, cardGroup);

  const X: Fx = {
    plan: emptyPlan(), lite, sprites, decals, coins, towers, stalks, arrows, shards,
    gears, gearMeshes, plane, card: cardGroup, cardFace, cardSheen, towerMaterial, arrowBull, arrowBear,
  };
  const batches = [sprites, decals, coins, towers, stalks, arrows, shards];
  let idle = false;

  const reset = () => {
    for (const b of batches) b.begin();
    gears.visible = false;
    plane.visible = false;
    cardGroup.visible = false;
  };
  return {
    root,
    /** Draw the effect of `arrival` at t seconds after the landing. */
    play(arrival: NonNullable<BoardRuntime["arrival"]>, t: number, view: THREE.Matrix4) {
      const key = `${arrival.key}:${arrival.cell}:${arrival.at}`;
      if (X.plan.key !== key) buildPlan(X.plan, arrival, key);
      idle = false;
      sprites.view = view;
      reset();
      RECIPES[X.plan.theme](X, t);
      for (const b of batches) b.end();
    },
    /** Hide everything (once). */
    idle() {
      if (idle) return;
      idle = true;
      reset();
      for (const b of batches) b.end();
    },
    dispose() {
      for (const b of [sprites, decals]) b.dispose();
      for (const p of [coins, towers, stalks, arrows, shards]) p.mesh.dispose();
      for (const g of [coinGeo, towerGeo, stalkGeo, arrowGeo, shardGeo, planeGeo, cardGeo, sheenGeo, ...gearGeos]) g.dispose();
      for (const m of [spriteMaterial, decalMaterial, gold, brass, steel, towerMaterial, stalkMaterial, arrowBull, arrowBear, shardMaterial, planeMaterial, cardFace, cardSheen]) m.dispose();
      for (const tex of [atlas, facade.map, facade.windows, card.map, card.glow]) tex.dispose();
    },
  };
}

/** Arrival flourishes; mount once the board fonts are ready (the card uses Cinzel). */
export function SectorFx({ lite, shadows }: { lite: boolean; shadows: boolean }) {
  const runtime = useRuntime();
  const camera = useThree((s) => s.camera);
  const fx = useDisposable(() => createFx(lite, shadows), [lite, shadows]);
  useFrame(() => {
    const rt = runtime.current;
    const arrival = rt.arrival;
    const t = arrival ? (performance.now() - arrival.at) / 1000 : Infinity;
    if (!arrival || rt.reduced || t < 0 || t >= FX_SECONDS) fx.idle();
    else fx.play(arrival, t, camera.matrixWorldInverse);
  });
  return <primitive object={fx.root} />;
}
