/**
 * Post-processing per tier. high: mipmap bloom on HDR highlights (> 1),
 * ACES tone mapping, vignette and a whisper of grain, MSAA 4, plus a depth of
 * field that only blends in during the travel close-up (focused on the
 * airliner, published by the globe in runtime.travel). medium: bloom +
 * vignette, MSAA 2. low / software: no composer (direct ACES rendering).
 * The composer keeps the canvas alpha, so the office shows through.
 */
import { useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect } from "postprocessing";
import { useRuntime } from "./runtime";
import type { TierSettings } from "./quality";

/** Keeps the travel depth of field on the plane; fully transparent (no effect) outside the close-up. */
function TravelFocus({ effect }: { effect: RefObject<DepthOfFieldEffect | null> }) {
  const runtime = useRuntime();
  const camera = useThree((state) => state.camera);
  useFrame(() => {
    const dof = effect.current;
    if (!dof) return;
    // The cinematic lowers camera.near during the close-up: keep the depth linearisation in sync.
    dof.cocMaterial.adoptCameraSettings(camera);
    const rt = runtime.current;
    const frame = rt.travel?.frame;
    const live = !rt.reduced && !!frame && frame.active && Math.abs(performance.now() - frame.now) < 250;
    const weight = live ? Math.min(1, Math.max(0, (frame.close - 0.55) / 0.35)) : 0;
    dof.blendMode.opacity.value = weight;
    if (live && dof.target) dof.target.copy(frame.planeWorld);
  });
  return null;
}

export function PostFX({ tier }: { tier: TierSettings }) {
  const dof = useRef<DepthOfFieldEffect>(null);
  if (tier.composer === "none") return null;
  if (tier.composer === "lite") {
    return (
      <EffectComposer multisampling={tier.multisampling} enableNormalPass={false}>
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.25} intensity={0.55} radius={0.62} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.32} darkness={0.5} />
      </EffectComposer>
    );
  }
  return (
    <>
      <EffectComposer multisampling={tier.multisampling} enableNormalPass={false}>
        <DepthOfField ref={dof} target={[0, 0, 0]} focusRange={1.5} bokehScale={2.2} resolutionScale={0.5} />
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.3} intensity={0.7} radius={0.7} levels={7} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.3} darkness={0.55} />
        <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.035} />
      </EffectComposer>
      <TravelFocus effect={dof} />
    </>
  );
}
