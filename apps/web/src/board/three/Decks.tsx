/**
 * The two card decks of the centre panel. Their height follows the cards left
 * (contexts / 100, board events / 50). When a card of a deck is being read,
 * its top card lifts and a gold sheen sweeps across it once.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { atlasUV, type AtlasRect, type BoardAtlas } from "./atlas";
import { CARD, CENTRE, SLAB_H } from "./layout";
import { useDisposable } from "./Board";
import { clamp01, easeInOutCubic, useRuntime } from "./runtime";

/** Box with the card back on top, gilt edges on the sides (stripe density follows the count). */
function stackGeometry(atlas: BoardAtlas, back: AtlasRect, height: number, cards: number) {
  const geometry = new THREE.BoxGeometry(CARD.w, height, CARD.d);
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const top = atlasUV(atlas, back);
  const edge = atlasUV(atlas, atlas.edges);
  const side = atlasUV(atlas, atlas.side);
  const fraction = clamp01(cards / 100);
  // Faces: +x, −x, +y, −y, +z, −z — 4 vertices each.
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      const u = uv.getX(i), v = uv.getY(i);
      if (face === 2) uv.setXY(i, top.u0 + u * (top.u1 - top.u0), top.vBottom + v * (top.vTop - top.vBottom));
      else if (face === 3) uv.setXY(i, (side.u0 + side.u1) / 2, (side.vTop + side.vBottom) / 2);
      else uv.setXY(i, edge.u0 + u * (edge.u1 - edge.u0), edge.vTop - (1 - v) * fraction * (edge.vTop - edge.vBottom));
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

const SHEEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SHEEN_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float d = (vUv.x + vUv.y) * 0.5 - (uProgress * 1.6 - 0.3);
    float band = exp(-d * d * 180.0);
    gl_FragColor = vec4(uColor * band * uOpacity, band * uOpacity);
  }`;

function Deck({ atlas, color, mask, physical, kind, cards, full, perDeck, focused, spotlight }: {
  atlas: BoardAtlas; color: THREE.Texture; mask: THREE.Texture | null; physical: boolean; kind: "context" | "event";
  cards: number; full: number; perDeck: number; focused: boolean; spotlight: boolean;
}) {
  const runtime = useRuntime();
  const place = kind === "context" ? CENTRE.contextDeck : CENTRE.eventDeck;
  const back = kind === "context" ? atlas.contextBack : atlas.eventBack;
  const remaining = Math.max(0, cards);
  const height = remaining > 0 ? Math.max(0.012, (remaining / perDeck) * full) : 0;
  const stack = useDisposable(() => stackGeometry(atlas, back, Math.max(0.001, height - 0.006), remaining), [atlas, back, height, remaining]);
  const topCard = useDisposable(() => stackGeometry(atlas, back, 0.006, 1), [atlas, back]);
  const material = useDisposable(() => {
    const params: THREE.MeshPhysicalMaterialParameters = {
      map: color, metalness: mask ? 1 : 0.2, roughness: mask ? 0.62 : 0.4, metalnessMap: mask ?? null, roughnessMap: mask ?? null, envMapIntensity: 1.05,
    };
    return physical ? new THREE.MeshPhysicalMaterial({ ...params, clearcoat: 0.4, clearcoatRoughness: 0.2 }) : new THREE.MeshStandardMaterial(params);
  }, [color, mask, physical]);
  const sheen = useDisposable(() => new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(kind === "context" ? "#ffe2a6" : "#fff4dc").multiplyScalar(2.2) } },
    vertexShader: SHEEN_VERTEX, fragmentShader: SHEEN_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), [kind]);
  const sheenGeometry = useDisposable(() => new THREE.PlaneGeometry(CARD.w, CARD.d).rotateX(-Math.PI / 2), []);
  const top = useRef<THREE.Group>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const rt = runtime.current;
    const now = performance.now();
    const age = focused ? (rt.reduced ? 700 : now - rt.deckAt) : -1;
    const group = top.current;
    if (group) {
      // Lift, tilt and settle in ~1.6 s; reduced motion keeps a still, slightly raised card.
      const t = age < 0 ? 0 : rt.reduced ? 0.4 : Math.sin(clamp01(age / 1600) * Math.PI);
      const lift = easeInOutCubic(t);
      group.position.set(0, height + lift * 0.34, lift * 0.18);
      group.rotation.set(-lift * 0.32, 0, lift * 0.05);
    }
    const p = age < 0 ? -1 : rt.reduced ? 0.5 : clamp01((age - 200) / 1100);
    sheen.uniforms.uProgress!.value = p;
    sheen.uniforms.uOpacity!.value = p < 0 ? 0 : rt.reduced ? 0.25 : Math.sin(p * Math.PI);
    if (spot.current) spot.current.intensity = focused ? (rt.reduced ? 18 : 18 * clamp01(age / 300)) : 0;
  });

  return (
    <group position={[place.x, SLAB_H, place.z]} rotation={[0, place.yaw, 0]}>
      {remaining > 1 && <mesh geometry={stack} material={material} position={[0, (height - 0.006) / 2, 0]} castShadow receiveShadow />}
      {remaining > 0 && (
        <group ref={top} position={[0, height, 0]}>
          <mesh geometry={topCard} material={material} position={[0, -0.003, 0]} castShadow receiveShadow />
          <mesh geometry={sheenGeometry} material={sheen} position={[0, 0.002, 0]} renderOrder={5} />
        </group>
      )}
      {kind === "event" && spotlight && (
        <>
          <primitive object={target} position={[0, 0, 0]} />
          <spotLight ref={spot} position={[0.6, 4.2, 1.6]} angle={0.42} penumbra={0.9} distance={9} decay={1.6} color="#fff1d6" intensity={0} target={target} />
        </>
      )}
    </group>
  );
}

export function Decks({ atlas, color, mask, physical, contexts, events, focus, spotlight }: {
  atlas: BoardAtlas; color: THREE.Texture; mask: THREE.Texture | null; physical: boolean; contexts: number; events: number;
  focus: "context" | "event" | null; spotlight: boolean;
}) {
  return (
    <>
      <Deck atlas={atlas} color={color} mask={mask} physical={physical} kind="context" cards={contexts} full={CARD.contextFull} perDeck={100} focused={focus === "context"} spotlight={spotlight} />
      <Deck atlas={atlas} color={color} mask={mask} physical={physical} kind="event" cards={events} full={CARD.eventFull} perDeck={50} focused={focus === "event"} spotlight={spotlight} />
    </>
  );
}
