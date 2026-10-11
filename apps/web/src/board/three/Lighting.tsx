/**
 * Warm neutral studio: a soft zenithal key with shadows from the front left,
 * a gentle neutral rim from behind, a warm-grey fill and a procedural studio
 * environment (no HDR file) for the metal and lacquer reflections. No light
 * is tinted blue: blacks stay neutral and the gold reads warm. Market moods
 * shift the lights: crash ruby, bull gold-emerald, bear cold steel.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { dampFactor, useRuntime, type Mood } from "./runtime";
import type { TierSettings } from "./quality";

interface Rig { key: THREE.Color; keyI: number; rim: THREE.Color; rimI: number; sky: THREE.Color; fillI: number }
const RIGS: Record<"calm" | Exclude<Mood, null>, Rig> = {
  calm: { key: new THREE.Color("#fff0dc"), keyI: 2.65, rim: new THREE.Color("#f3ece2"), rimI: 1.0, sky: new THREE.Color("#3a322b"), fillI: 0.36 },
  crash: { key: new THREE.Color("#ffc4b6"), keyI: 1.6, rim: new THREE.Color("#ff3048"), rimI: 2.8, sky: new THREE.Color("#2c0c10"), fillI: 0.26 },
  bull: { key: new THREE.Color("#fff3d6"), keyI: 3.0, rim: new THREE.Color("#46e2a8"), rimI: 2.0, sky: new THREE.Color("#172f26"), fillI: 0.42 },
  bear: { key: new THREE.Color("#eaecef"), keyI: 2.1, rim: new THREE.Color("#aeb8c4"), rimI: 1.6, sky: new THREE.Color("#25272b"), fillI: 0.3 },
};

/** Soft elliptical falloff so the lacquer reflection has no hard edge. */
function softboxTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 0.5, 0, 0);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.45, "#9a9a9a");
  g.addColorStop(1, "#000000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function Lighting({ tier }: { tier: TierSettings }) {
  const runtime = useRuntime();
  const softbox = useMemo(() => softboxTexture(), []);
  useEffect(() => () => softbox.dispose(), [softbox]);
  const key = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.HemisphereLight>(null);

  useFrame((_, delta) => {
    const rt = runtime.current;
    const rig = RIGS[rt.mood ?? "calm"];
    const k = rt.reduced ? 1 : dampFactor(3.2, Math.min(delta, 0.1));
    if (key.current) { key.current.color.lerp(rig.key, k); key.current.intensity += (rig.keyI - key.current.intensity) * k; }
    if (rim.current) { rim.current.color.lerp(rig.rim, k); rim.current.intensity += (rig.rimI - rim.current.intensity) * k; }
    if (fill.current) { fill.current.color.lerp(rig.sky, k); fill.current.intensity += (rig.fillI - fill.current.intensity) * k; }
  });

  const s = 11.5;
  return (
    <>
      <directionalLight
        ref={key}
        position={[-7, 17, 9.5]}
        intensity={RIGS.calm.keyI}
        color={RIGS.calm.key}
        castShadow={tier.shadows}
        shadow-mapSize-width={tier.shadowSize}
        shadow-mapSize-height={tier.shadowSize}
        shadow-camera-left={-s}
        shadow-camera-right={s}
        shadow-camera-top={s}
        shadow-camera-bottom={-s}
        shadow-camera-near={4}
        shadow-camera-far={48}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-radius={tier.tier === "high" ? 6 : 3}
      />
      <directionalLight ref={rim} position={[7, 6.5, -15]} intensity={RIGS.calm.rimI} color={RIGS.calm.rim} />
      <hemisphereLight ref={fill} args={[RIGS.calm.sky, new THREE.Color("#140f0a"), RIGS.calm.fillI]} />
      <Environment resolution={tier.envResolution} frames={1} background={false} environmentIntensity={1}>
        <color attach="background" args={["#060505"]} />
        {/* Overhead softbox: the long soft highlight across lacquer and enamel. */}
        <Lightformer form="rect" intensity={2.1} color="#fff2e2" scale={[14, 7, 1]} position={[0, 16, 2]} />
        {/* Diffused back softbox. */}
        <Lightformer form="rect" intensity={1.4} color="#fff0de" scale={[30, 11, 1]} position={[0, 13, -13]} map={softbox} />
        {/* Side strips (neutral left, warm right): crisp edges on brass and figurines. */}
        <Lightformer form="rect" intensity={1.25} color="#f4f1eb" scale={[1.4, 20, 1]} position={[-15, 6, 0]} />
        <Lightformer form="rect" intensity={1.25} color="#ffd9a8" scale={[1.4, 20, 1]} position={[15, 6, 0]} />
        {/* Gold kicker behind the board: sparkle on gilt edges. */}
        <Lightformer form="ring" intensity={1.5} color="#ffcf8a" scale={7} position={[0, 6, -17]} />
        {/* Low front strip. */}
        <Lightformer form="rect" intensity={0.65} color="#fff3e0" scale={[24, 0.7, 1]} position={[0, 2, 17]} />
        <Lightformer form="circle" intensity={0.55} color="#efe9df" scale={5} position={[-10, 10, -10]} />
      </Environment>
    </>
  );
}
