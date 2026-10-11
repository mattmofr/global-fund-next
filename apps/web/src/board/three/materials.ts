/**
 * Shared PBR materials and colour helpers for the hero objects (figurines,
 * armillary globe, menu backdrop). Presentation only.
 *
 * Every material is created lazily and cached at module level, so all
 * instances of a figurine share the same GPU programs and nothing is
 * allocated per frame. Quality tiers:
 *   high   → MeshPhysicalMaterial, gem transmission (refraction pass)
 *   medium → MeshPhysicalMaterial (clearcoat), opaque gems
 *   low    → MeshStandardMaterial, opaque gems, no clearcoat
 */
import * as THREE from "three";

export type ObjectQuality = "high" | "medium" | "low";

/** Base hues of the hero objects (sRGB hex). */
export const OBJECT_PALETTE = {
  lacquer: "#080706",
  brass: "#cfa862",
  gold: "#f0c877",
  goldDeep: "#d8b25f",
  platinum: "#dfe3e8",
  sapphire: "#2a62e6",
  amethyst: "#9a5cf0",
  ruby: "#d91e3c",
  emerald: "#18b877",
  onyx: "#070605",
  obsidian: "#070605",
  ember: "#ffcf8a",
  rubyGlow: "#ff3b52",
  /** Warm haze on the globe's limb (no blue cast anywhere). */
  atmosphere: "#b99f7c",
} as const;

export type PieceMaterialKey =
  | "lacquer" | "brass" | "gold" | "goldSculpt" | "platinum" | "platinumSculpt"
  | "sapphire" | "sapphireSculpt" | "amethyst" | "ruby" | "emerald" | "onyx" | "rock" | "mirror";

// ------------------------------------------------------------ colour utils --
const _hsl = { h: 0, s: 0, l: 0 };

/** Copy of `color` with its saturation scaled (0 = grey) and lightness scaled. */
export function desaturate(color: THREE.ColorRepresentation, saturation = 0.2, lightness = 0.6) {
  const out = new THREE.Color(color);
  out.getHSL(_hsl);
  out.setHSL(_hsl.h, _hsl.s * saturation, _hsl.l * lightness);
  return out;
}

/** Linear mix of two colours (returns a new Color). */
export function mixColor(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

/** Software rasterisers (SwiftShader, llvmpipe, WARP…) must use the low tier. */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined) {
  if (!gl) return false;
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|basic render|microsoft basic|softpipe/i.test(name);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------- materials --
const cache = new Map<string, THREE.Material>();

function physical(quality: ObjectQuality, params: THREE.MeshPhysicalMaterialParameters): THREE.MeshStandardMaterial {
  if (quality !== "low") return new THREE.MeshPhysicalMaterial(params);
  // Low tier: same look without the clearcoat / transmission / sheen lobes.
  const {
    clearcoat, clearcoatRoughness, transmission, thickness, ior, attenuationColor, attenuationDistance,
    specularIntensity, specularColor, sheen, sheenColor, sheenRoughness, iridescence, iridescenceIOR,
    anisotropy, anisotropyRotation, dispersion, reflectivity, ...rest
  } = params;
  void clearcoat; void clearcoatRoughness; void transmission; void thickness; void ior; void attenuationColor;
  void attenuationDistance; void specularIntensity; void specularColor; void sheen; void sheenColor; void sheenRoughness;
  void iridescence; void iridescenceIOR; void anisotropy; void anisotropyRotation; void dispersion; void reflectivity;
  return new THREE.MeshStandardMaterial(rest as THREE.MeshStandardMaterialParameters);
}

/**
 * Cut gem. The scene is dark, so a purely refractive gem would read black:
 * the colour is carried by a saturated body + a soft inner glow (emissive),
 * facets catch the softboxes through a crisp clearcoat, and on "high" a partial
 * transmission adds depth without draining the hue.
 */
function gem(quality: ObjectQuality, hue: string, deep: string, flat: boolean, thickness = 0.2, vertexColors = false): THREE.MeshStandardMaterial {
  if (quality === "low") {
    return new THREE.MeshStandardMaterial({ color: hue, metalness: 0.28, roughness: 0.07, emissive: new THREE.Color(deep), emissiveIntensity: 0.5, envMapIntensity: 2, flatShading: flat, vertexColors });
  }
  return new THREE.MeshPhysicalMaterial({
    color: hue,
    metalness: 0.05,
    roughness: 0.035,
    ior: 1.9,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    iridescence: 0.2,
    iridescenceIOR: 1.45,
    emissive: new THREE.Color(deep),
    emissiveIntensity: 0.5,
    envMapIntensity: 2.1,
    flatShading: flat,
    vertexColors,
    ...(quality === "high" ? { transmission: 0.42, thickness, attenuationColor: new THREE.Color(hue), attenuationDistance: 0.9 } : {}),
  });
}

/** Body colour of each key, used to derive the dimmed "detained" variants. */
const BASE_HUE: Record<PieceMaterialKey, string> = {
  lacquer: OBJECT_PALETTE.lacquer, brass: OBJECT_PALETTE.brass, gold: OBJECT_PALETTE.gold, goldSculpt: OBJECT_PALETTE.gold,
  platinum: OBJECT_PALETTE.platinum, platinumSculpt: OBJECT_PALETTE.platinum, sapphire: OBJECT_PALETTE.sapphire,
  sapphireSculpt: OBJECT_PALETTE.sapphire, amethyst: OBJECT_PALETTE.amethyst, ruby: OBJECT_PALETTE.ruby,
  emerald: OBJECT_PALETTE.emerald, onyx: OBJECT_PALETTE.onyx, rock: "#2a2233", mirror: "#080706",
};

function createPieceMaterial(key: PieceMaterialKey, quality: ObjectQuality): THREE.Material {
  switch (key) {
    case "lacquer":
      return physical(quality, { color: OBJECT_PALETTE.lacquer, metalness: 0.05, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 });
    case "brass":
      return physical(quality, { color: OBJECT_PALETTE.brass, metalness: 1, roughness: 0.3, envMapIntensity: 1.15 });
    case "gold":
      return physical(quality, { color: OBJECT_PALETTE.gold, metalness: 1, roughness: 0.17, envMapIntensity: 1.25 });
    case "goldSculpt":
      return physical(quality, { color: OBJECT_PALETTE.gold, metalness: 1, roughness: 0.2, envMapIntensity: 1.3, vertexColors: true });
    case "platinum":
      return physical(quality, { color: OBJECT_PALETTE.platinum, metalness: 1, roughness: 0.2, envMapIntensity: 1.2 });
    case "platinumSculpt":
      return physical(quality, { color: OBJECT_PALETTE.platinum, metalness: 1, roughness: 0.22, envMapIntensity: 1.2, vertexColors: true });
    case "sapphire":
      return physical(quality, { color: OBJECT_PALETTE.sapphire, metalness: 0.1, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3 });
    case "sapphireSculpt":
      return physical(quality, {
        color: OBJECT_PALETTE.sapphire, metalness: 0.15, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.025,
        emissive: new THREE.Color("#0d2a80"), emissiveIntensity: 0.28, envMapIntensity: 1.4, vertexColors: true,
      });
    case "amethyst":
      return gem(quality, "#c9a6ff", "#4a1aa6", true, 0.2, true);
    case "ruby":
      return gem(quality, OBJECT_PALETTE.ruby, "#7d0619", true);
    case "emerald":
      return gem(quality, OBJECT_PALETTE.emerald, "#05583a", false, 0.06, true);
    case "onyx":
      return physical(quality, { color: OBJECT_PALETTE.onyx, metalness: 0.2, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 });
    case "rock":
      return physical(quality, { color: "#2a2233", metalness: 0.1, roughness: 0.55, flatShading: true });
    case "mirror":
      return physical(quality, { color: "#080706", metalness: 0.6, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 });
  }
}

function jailedVariant(source: THREE.Material, key: PieceMaterialKey): THREE.Material {
  const material = source.clone() as THREE.MeshStandardMaterial;
  material.color = desaturate(BASE_HUE[key], 0.14, key === "lacquer" || key === "onyx" ? 1 : 0.5);
  material.roughness = Math.min(1, material.roughness + 0.22);
  material.envMapIntensity = material.envMapIntensity * 0.5;
  material.emissive = new THREE.Color("#000000");
  material.emissiveIntensity = 0;
  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.transmission = 0;
    material.iridescence = 0;
    material.clearcoat *= 0.4;
  }
  return material;
}

/** Cached material of a figurine part. Shared by every instance: never mutate it. */
export function pieceMaterial(key: PieceMaterialKey, quality: ObjectQuality = "high", jailed = false): THREE.Material {
  const id = `${key}|${quality}|${jailed ? 1 : 0}`;
  let material = cache.get(id);
  if (!material) {
    material = jailed ? jailedVariant(pieceMaterial(key, quality, false), key) : createPieceMaterial(key, quality);
    material.name = `gf-${key}-${quality}${jailed ? "-jailed" : ""}`;
    cache.set(id, material);
  }
  return material;
}

export type SeatRingMode = "neutral" | "idle" | "active" | "jailed";

/**
 * Seat-colour ring material. "active" is shared by the active figurine(s) and
 * its emissive intensity is animated by them (same value for everyone).
 */
export function seatRingMaterial(color: string | undefined, mode: SeatRingMode, quality: ObjectQuality = "high"): THREE.MeshStandardMaterial {
  const seat = mode === "jailed" ? OBJECT_PALETTE.rubyGlow : color ?? OBJECT_PALETTE.brass;
  const id = `ring|${seat}|${mode}|${quality}`;
  let material = cache.get(id) as THREE.MeshStandardMaterial | undefined;
  if (!material) {
    const base = new THREE.Color(seat);
    if (mode === "neutral") {
      material = physical(quality, { color: OBJECT_PALETTE.brass, metalness: 1, roughness: 0.24, envMapIntensity: 1.2 });
    } else {
      material = new THREE.MeshStandardMaterial({
        color: base,
        emissive: base,
        emissiveIntensity: mode === "active" ? 2.2 : mode === "jailed" ? 1.1 : 0.55,
        metalness: 0.35,
        roughness: 0.28,
        toneMapped: mode !== "active",
      });
    }
    material.name = `gf-ring-${mode}`;
    cache.set(id, material);
  }
  return material;
}

// ------------------------------------------------------- glow / halo assets --
let glowTexture: THREE.Texture | null = null;
let haloTexture: THREE.Texture | null = null;

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Soft white radial falloff (sprites, comet heads, pin glows). */
export function radialGlowTexture() {
  if (!glowTexture) {
    glowTexture = canvasTexture(128, (ctx, size) => {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.18, "rgba(255,255,255,0.75)");
      g.addColorStop(0.45, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    });
  }
  return glowTexture;
}

/** Ground halo: bright ring fading inward and outward (active figurine). */
export function haloRingTexture() {
  if (!haloTexture) {
    haloTexture = canvasTexture(256, (ctx, size) => {
      const c = size / 2;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, "rgba(255,255,255,0.10)");
      g.addColorStop(0.42, "rgba(255,255,255,0.22)");
      g.addColorStop(0.56, "rgba(255,255,255,0.95)");
      g.addColorStop(0.64, "rgba(255,255,255,0.5)");
      g.addColorStop(0.82, "rgba(255,255,255,0.12)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    });
  }
  return haloTexture;
}

/** Additive glow material for a ground halo or a sprite, cached per colour. */
export function glowMaterial(color: string, kind: "halo" | "sprite" = "halo"): THREE.MeshBasicMaterial | THREE.SpriteMaterial {
  const id = `glow|${kind}|${color}`;
  let material = cache.get(id) as THREE.MeshBasicMaterial | THREE.SpriteMaterial | undefined;
  if (!material) {
    const common = {
      color: new THREE.Color(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    };
    material = kind === "halo"
      ? new THREE.MeshBasicMaterial({ ...common, map: haloRingTexture(), opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      : new THREE.SpriteMaterial({ ...common, map: radialGlowTexture(), opacity: 0.9 });
    cache.set(id, material);
  }
  return material;
}

/**
 * Invisible-to-camera backdrop for transmission: gems refract it, but the main
 * pass discards it (used by the transparent portrait studio). The mesh must
 * set `onBeforeRender = transmissionOnlyBeforeRender`.
 */
export function transmissionBackdropMaterial(top = "#221d17", bottom = "#070605", band = "#a88a55") {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uVisible: { value: 0 },
      uTop: { value: new THREE.Color(top) },
      uBottom: { value: new THREE.Color(bottom) },
      uBand: { value: new THREE.Color(band) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uVisible;
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uBand;
      varying vec3 vDir;
      void main() {
        if (uVisible < 0.5) discard;
        float h = vDir.y * 0.5 + 0.5;
        vec3 col = mix(uBottom, uTop, smoothstep(0.15, 0.95, h));
        col += uBand * smoothstep(0.08, 0.0, abs(vDir.y - 0.18)) * 0.9;
        col += uBand * 0.6 * smoothstep(0.35, 0.0, length(vDir.xz - vec2(-0.55, 0.55)));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ------------------------------------------------------------ world data --
/** One closed polygon ring of [lon, lat] pairs (degrees). */
export type LandRing = Array<[number, number]>;
let landPromise: Promise<LandRing[]> | null = null;

const onEdge = (p: [number, number]) => Math.abs(p[0]) > 179.9 || p[1] < -89.9;

/** Chaikin corner cutting (keeps antimeridian / pole cut points fixed). */
function smoothRing(ring: LandRing, passes: number): LandRing {
  let current = ring;
  for (let pass = 0; pass < passes; pass++) {
    const next: LandRing = [];
    for (let i = 0; i < current.length - 1; i++) {
      const p = current[i]!;
      const q = current[i + 1]!;
      if (onEdge(p) || onEdge(q)) {
        next.push(p);
        continue;
      }
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    next.push(next[0]!);
    current = next;
  }
  return current;
}

/** Natural Earth 1:110m land polygons, lightly smoothed. Cached; never rejects. */
export function loadLandRings(): Promise<LandRing[]> {
  if (!landPromise) {
    landPromise = fetch("/assets/world/ne_110m_land.geojson")
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { features?: Array<{ geometry?: { type: string; coordinates: unknown } }> } | null) => {
        const rings: LandRing[] = [];
        for (const feature of json?.features ?? []) {
          const geometry = feature.geometry;
          if (!geometry) continue;
          const polygons = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : []) as number[][][][];
          for (const polygon of polygons) for (const ring of polygon) rings.push(smoothRing(ring.map((p) => [p[0]!, p[1]!] as [number, number]), 2));
        }
        return rings;
      })
      .catch(() => []);
  }
  return landPromise;
}

/** Equirectangular projection helpers for canvas textures. */
export function traceLand(ctx: CanvasRenderingContext2D, rings: LandRing[], width: number, height: number, mode: "fill" | "stroke") {
  const px = (lon: number) => ((lon + 180) / 360) * width;
  const py = (lat: number) => ((90 - lat) / 180) * height;
  ctx.beginPath();
  for (const ring of rings) {
    if (mode === "fill") {
      ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(px(lon), py(lat)) : ctx.moveTo(px(lon), py(lat))));
      ctx.closePath();
    } else {
      // Coastlines only: skip the artificial antimeridian / south-pole cuts.
      let pen = false;
      for (let i = 1; i < ring.length; i++) {
        const p = ring[i - 1]!;
        const q = ring[i]!;
        const artificial = (onEdge(p) && onEdge(q)) || Math.abs(p[0] - q[0]) > 180;
        if (artificial) { pen = false; continue; }
        if (!pen) { ctx.moveTo(px(p[0]), py(p[1])); pen = true; }
        ctx.lineTo(px(q[0]), py(q[1]));
      }
    }
  }
  if (mode === "fill") ctx.fill("evenodd");
  else ctx.stroke();
}

export function transmissionOnlyBeforeRender(this: THREE.Object3D, renderer: THREE.WebGLRenderer, _scene: THREE.Scene, _camera: THREE.Camera, _geometry: THREE.BufferGeometry, material: THREE.Material) {
  const shader = material as THREE.ShaderMaterial;
  const visible = renderer.getRenderTarget() !== null ? 1 : 0;
  if (shader.uniforms?.uVisible && shader.uniforms.uVisible.value !== visible) {
    shader.uniforms.uVisible.value = visible;
    shader.uniformsNeedUpdate = true;
  }
}
