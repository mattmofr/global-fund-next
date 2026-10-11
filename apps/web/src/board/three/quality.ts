/**
 * Render tiers. A software rasteriser (SwiftShader, llvmpipe, WARP…) always
 * gets the low tier with a reduced pixel ratio: the E2E suite runs there.
 */
import type { BoardQuality } from "../types";

export interface RendererProbe {
  available: boolean;
  software: boolean;
  renderer: string;
  maxTextureSize: number;
}

let cached: RendererProbe | null = null;

/** One throw-away context, read once per page. */
export function probeRenderer(): RendererProbe {
  if (cached) return cached;
  let result: RendererProbe = { available: false, software: true, renderer: "", maxTextureSize: 2048 };
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (gl) {
      let renderer = String(gl.getParameter(gl.RENDERER) ?? "");
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? renderer);
      result = {
        available: true,
        software: /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(renderer),
        renderer,
        maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048,
      };
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    /* No WebGL: the board shows its static fallback. */
  }
  cached = result;
  return result;
}

export interface TierSettings {
  tier: BoardQuality;
  software: boolean;
  dpr: number | [number, number];
  antialias: boolean;
  shadows: boolean;
  shadowSize: number;
  composer: "full" | "lite" | "none";
  multisampling: number;
  /** Atlas pixels per world unit. */
  atlasScale: number;
  mask: boolean;
  envResolution: number;
  /** MeshPhysicalMaterial (clearcoat) allowed. */
  physical: boolean;
  maxFps: number;
}

export function tierSettings(quality: BoardQuality, probe: RendererProbe): TierSettings {
  const device = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  if (!probe.available || probe.software) {
    return { tier: "low", software: true, dpr: Math.min(0.75, device), antialias: false, shadows: false, shadowSize: 512, composer: "none", multisampling: 0, atlasScale: 112, mask: false, envResolution: 64, physical: false, maxFps: 30 };
  }
  if (quality === "low") {
    return { tier: "low", software: false, dpr: Math.min(0.85, device), antialias: true, shadows: true, shadowSize: 1024, composer: "none", multisampling: 0, atlasScale: 144, mask: true, envResolution: 128, physical: false, maxFps: 30 };
  }
  if (quality === "medium") {
    return { tier: "medium", software: false, dpr: [1, 1.25], antialias: false, shadows: true, shadowSize: 1024, composer: "lite", multisampling: 2, atlasScale: 200, mask: true, envResolution: 128, physical: true, maxFps: 60 };
  }
  return { tier: "high", software: false, dpr: [1, 1.75], antialias: false, shadows: true, shadowSize: 2048, composer: "full", multisampling: 4, atlasScale: 256, mask: true, envResolution: 256, physical: true, maxFps: 60 };
}
