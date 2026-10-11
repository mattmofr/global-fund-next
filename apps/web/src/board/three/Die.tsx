/**
 * Onyx die with inset gold pips. The throw is driven by the presentation
 * timeline (diceStartedAt → +PRESENTATION_TIMING.dice): it flies from the
 * active fund's side, tumbles, bounces twice and settles by unwinding its
 * spin onto the orientation that shows exactly `timeline.roll` on top.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { PRESENTATION_TIMING } from "../../presentation/sequence";
import { atlasUV, type BoardAtlas } from "./atlas";
import { CENTRE, DIE_SIZE, SLAB_H, cellAt } from "./layout";
import { useDisposable } from "./Board";
import { clamp01, easeOutCubic, seeded, useRuntime } from "./runtime";

const HALF = DIE_SIZE / 2;
const REST_Y = SLAB_H + 0.012;
const UP = new THREE.Vector3(0, 1, 0);
/** Face normals in die space: 1 opposite 6, 2 opposite 5, 3 opposite 4. */
const FACES: Record<number, { n: [number, number, number]; t: [number, number, number]; b: [number, number, number] }> = {
  1: { n: [0, 1, 0], t: [1, 0, 0], b: [0, 0, 1] },
  6: { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, -1] },
  2: { n: [0, 0, 1], t: [1, 0, 0], b: [0, -1, 0] },
  5: { n: [0, 0, -1], t: [-1, 0, 0], b: [0, -1, 0] },
  3: { n: [1, 0, 0], t: [0, 0, -1], b: [0, -1, 0] },
  4: { n: [-1, 0, 0], t: [0, 0, 1], b: [0, -1, 0] },
};
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** Orientation that puts face `value` up, with a yaw around the vertical. */
function restQuaternion(value: number, yaw: number, out: THREE.Quaternion) {
  const face = FACES[value] ?? FACES[1]!;
  const n = new THREE.Vector3(...face.n);
  out.setFromUnitVectors(n, UP);
  const spin = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  return out.premultiply(spin);
}

interface Plan {
  key: number;
  start: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  p3: THREE.Vector3;
  rest: THREE.Vector3;
  final: THREE.Quaternion;
  axisA: THREE.Vector3;
  axisB: THREE.Vector3;
  spinA: number;
  spinB: number;
}

function planThrow(key: number, roll: number, fromX: number, fromZ: number): Plan {
  const random = seeded(key * 7919 + roll * 31);
  const tray = CENTRE.tray;
  const dir = new THREE.Vector3(tray.x - fromX, 0, tray.z - fromZ);
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
  dir.normalize();
  const rest = new THREE.Vector3(tray.x + (random() - 0.5) * 0.5, REST_Y, tray.z + (random() - 0.5) * 0.36);
  const back = (d: number) => rest.clone().addScaledVector(dir, -d);
  const start = new THREE.Vector3(fromX + (tray.x - fromX) * 0.38, REST_Y + 1.9, fromZ + (tray.z - fromZ) * 0.38);
  const final = restQuaternion(roll, random() * Math.PI * 2, new THREE.Quaternion());
  const world = new THREE.Vector3().crossVectors(UP, dir).normalize();
  const inverse = final.clone().invert();
  return {
    key, start, rest, final,
    p1: back(1.3), p2: back(0.72), p3: back(0.26),
    axisA: world.applyQuaternion(inverse).normalize(),
    axisB: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
    spinA: -(Math.PI * 4 + random() * Math.PI * 2),
    spinB: (random() - 0.5) * Math.PI * 3,
  };
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** Writes the throw pose at normalised time u (0 → 1) into `pos` / `quat`. */
function throwPose(plan: Plan, u: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
  let lift = 0;
  if (u < 0.42) {
    const s = u / 0.42;
    pos.lerpVectors(plan.start, plan.p1, s);
    const startLift = plan.start.y - REST_Y;
    lift = startLift * (1 - s) + 0.55 * 4 * s * (1 - s);
  } else if (u < 0.64) {
    const s = (u - 0.42) / 0.22;
    pos.lerpVectors(plan.p1, plan.p2, s);
    lift = 0.42 * Math.sin(Math.PI * s);
  } else if (u < 0.8) {
    const s = (u - 0.64) / 0.16;
    pos.lerpVectors(plan.p2, plan.p3, s);
    lift = 0.13 * Math.sin(Math.PI * s);
  } else {
    pos.lerpVectors(plan.p3, plan.rest, easeOutCubic((u - 0.8) / 0.2));
  }
  const settleA = 1 - Math.pow(1 - clamp01(u / 0.94), 2.3);
  const settleB = 1 - Math.pow(1 - clamp01(u / 0.72), 2);
  _qa.setFromAxisAngle(plan.axisA, plan.spinA * (1 - settleA));
  _qb.setFromAxisAngle(plan.axisB, plan.spinB * (1 - settleB));
  quat.copy(plan.final).multiply(_qa).multiply(_qb);
  // Keep the lowest corner on the felt while tumbling.
  _m.makeRotationFromQuaternion(quat);
  const e = _m.elements;
  const support = HALF * (Math.abs(e[1]!) + Math.abs(e[5]!) + Math.abs(e[9]!)) - 0.03 * (Math.abs(e[1]!) + Math.abs(e[5]!) + Math.abs(e[9]!) - 1);
  pos.y = REST_Y + support + lift;
}

export function Die({ atlas, color, physical, latestRoll }: { atlas: BoardAtlas; color: THREE.Texture; physical: boolean; latestRoll: number }) {
  const runtime = useRuntime();
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const die = useRef<THREE.Group>(null);
  const badge = useRef<THREE.Mesh>(null);
  const glint = useRef<THREE.Mesh>(null);
  const plan = useRef<Plan | null>(null);
  const rest = useRef({ pos: new THREE.Vector3(CENTRE.tray.x + 0.12, REST_Y + HALF, CENTRE.tray.z - 0.05), quat: restQuaternion(latestRoll || 1, 0.62, new THREE.Quaternion()), value: latestRoll || 1 });
  const resultAt = useRef(-1e9);

  const onyx = useDisposable(() => physical
    ? new THREE.MeshPhysicalMaterial({ color: "#0b0b0e", roughness: 0.16, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3 })
    : new THREE.MeshStandardMaterial({ color: "#0c0c10", roughness: 0.18, metalness: 0.2, envMapIntensity: 1.2 }), [physical]);
  const goldPip = useDisposable(() => new THREE.MeshStandardMaterial({ color: "#f2cf86", metalness: 1, roughness: 0.2, emissive: "#3b2808", emissiveIntensity: 0.6, envMapIntensity: 1.4 }), []);
  const hole = useDisposable(() => new THREE.MeshBasicMaterial({ color: "#000000", polygonOffset: true, polygonOffsetFactor: -1 }), []);
  const pipGeometry = useDisposable(() => new THREE.SphereGeometry(DIE_SIZE * 0.088, 18, 10).scale(1, 0.38, 1), []);
  const holeGeometry = useDisposable(() => new THREE.CircleGeometry(DIE_SIZE * 0.11, 24).rotateX(-Math.PI / 2), []);
  const pipMatrices = useMemo(() => {
    const list: THREE.Matrix4[] = [];
    const d = DIE_SIZE * 0.25;
    for (const [value, spots] of Object.entries(PIPS)) {
      const face = FACES[Number(value)]!;
      const n = new THREE.Vector3(...face.n), t = new THREE.Vector3(...face.t), b = new THREE.Vector3(...face.b);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, n);
      for (const [u, w] of spots) {
        const p = n.clone().multiplyScalar(HALF - 0.004).addScaledVector(t, u * d).addScaledVector(b, w * d);
        list.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
      }
    }
    return list;
  }, []);
  const holeMatrices = useMemo(() => pipMatrices.map((m) => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    p.addScaledVector(n, 0.0055);
    return new THREE.Matrix4().compose(p, q, s);
  }), [pipMatrices]);
  const pips = useRef<THREE.InstancedMesh>(null);
  const holes = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    pipMatrices.forEach((m, i) => pips.current?.setMatrixAt(i, m));
    holeMatrices.forEach((m, i) => holes.current?.setMatrixAt(i, m));
    if (pips.current) pips.current.instanceMatrix.needsUpdate = true;
    if (holes.current) holes.current.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [pipMatrices, holeMatrices, invalidate]);

  const badges = useDisposable(() => {
    const geos = atlas.badges.map((r) => {
      const geo = new THREE.PlaneGeometry(0.7, 0.7);
      const uv = atlasUV(atlas, r);
      const attr = geo.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < attr.count; i++) attr.setXY(i, attr.getX(i) ? uv.u1 : uv.u0, attr.getY(i) ? uv.vTop : uv.vBottom);
      return geo;
    });
    return { geos, dispose: () => geos.forEach((g) => g.dispose()) };
  }, [atlas]);
  const glintGeometry = useDisposable(() => {
    const geo = new THREE.PlaneGeometry(0.62, 0.62);
    const uv = atlasUV(atlas, atlas.glint);
    const attr = geo.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < attr.count; i++) attr.setXY(i, attr.getX(i) ? uv.u1 : uv.u0, attr.getY(i) ? uv.vTop : uv.vBottom);
    return geo;
  }, [atlas]);
  const badgeMaterial = useDisposable(() => new THREE.MeshBasicMaterial({ map: color, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, color: new THREE.Color(1.25, 1.2, 1.1) }), [color]);
  const glintMaterial = useDisposable(() => new THREE.MeshBasicMaterial({ map: color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(1.5, 1.32, 1.0) }), [color]);

  // Resting value follows the latest roll when no throw is on screen.
  useEffect(() => {
    if (runtime.current.timeline || !latestRoll || rest.current.value === latestRoll) return;
    restQuaternion(latestRoll, 0.62, rest.current.quat);
    rest.current.value = latestRoll;
    invalidate();
  }, [latestRoll, runtime, invalidate]);

  useFrame(() => {
    const group = die.current;
    if (!group) return;
    const rt = runtime.current;
    const now = performance.now();
    const timeline = rt.timeline;
    let shownValue = rest.current.value;
    if (timeline && timeline.roll >= 1 && timeline.roll <= 6) {
      if (plan.current?.key !== timeline.noticeId) {
        const from = rt.game.players.find((p) => p.id === timeline.playerId);
        const cell = cellAt(from ? timeline.fromPosition : 0);
        plan.current = planThrow(timeline.noticeId, timeline.roll, cell.cx, cell.cz);
      }
      const current = plan.current;
      const elapsed = now - timeline.diceStartedAt;
      if (rt.reduced || elapsed >= PRESENTATION_TIMING.dice) {
        group.position.copy(current.rest).setY(REST_Y + HALF);
        group.quaternion.copy(current.final);
        rest.current.pos.copy(group.position);
        rest.current.quat.copy(current.final);
        rest.current.value = timeline.roll;
        shownValue = timeline.roll;
      } else if (elapsed >= 0) {
        throwPose(current, elapsed / PRESENTATION_TIMING.dice, group.position, group.quaternion);
        shownValue = 0;
      } else {
        group.position.copy(rest.current.pos);
        group.quaternion.copy(rest.current.quat);
      }
    } else {
      group.position.copy(rest.current.pos);
      group.quaternion.copy(rest.current.quat);
    }

    // Result medallion + glint during DICE_RESULT (never in reduced motion: the stage is skipped).
    const showing = rt.stage === "DICE_RESULT" && !rt.reduced && shownValue > 0;
    if (showing && resultAt.current < 0) resultAt.current = now;
    if (!showing && rt.stage !== "DICE_RESULT") resultAt.current = -1;
    const age = resultAt.current < 0 ? -1 : now - resultAt.current;
    if (badge.current) {
      const visible = age >= 0 && age < PRESENTATION_TIMING.result + 600;
      badge.current.visible = visible;
      if (visible) {
        const grow = easeOutCubic(age / 260);
        const fade = rt.stage === "DICE_RESULT" ? 1 : clamp01(1 - (age - PRESENTATION_TIMING.result) / 300);
        const overshoot = 1 + 0.12 * Math.sin(clamp01(age / 420) * Math.PI);
        badge.current.scale.setScalar(Math.max(0.001, grow * overshoot * fade));
        badge.current.position.set(group.position.x, group.position.y + 0.78 + grow * 0.1, group.position.z);
        badge.current.quaternion.copy(camera.quaternion);
        badge.current.geometry = badges.geos[(shownValue || rest.current.value) - 1] ?? badges.geos[0]!;
        badgeMaterial.opacity = fade;
      }
    }
    if (glint.current) {
      const visible = age >= 0 && age < 520;
      glint.current.visible = visible;
      if (visible) {
        const k = Math.sin(clamp01(age / 520) * Math.PI);
        glint.current.scale.setScalar(0.25 + k * 0.75);
        glint.current.position.set(group.position.x + HALF * 0.7, group.position.y + HALF * 0.9, group.position.z + HALF * 0.7);
        glint.current.quaternion.copy(camera.quaternion);
        glint.current.rotateZ(age / 900);
        glintMaterial.opacity = k;
      }
    }
  });

  return (
    <>
      <group ref={die} position={rest.current.pos} quaternion={rest.current.quat}>
        <RoundedBox args={[DIE_SIZE, DIE_SIZE, DIE_SIZE]} radius={DIE_SIZE * 0.13} smoothness={4} material={onyx} castShadow receiveShadow />
        <instancedMesh ref={holes} args={[holeGeometry, hole, 21]} />
        <instancedMesh ref={pips} args={[pipGeometry, goldPip, 21]} castShadow={false} />
      </group>
      <mesh ref={badge} visible={false} material={badgeMaterial} geometry={badges.geos[0]} renderOrder={20} />
      <mesh ref={glint} visible={false} material={glintMaterial} geometry={glintGeometry} renderOrder={21} />
    </>
  );
}
