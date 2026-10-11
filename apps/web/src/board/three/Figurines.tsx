/**
 * Gemstone figurines on the sector track. Movement replays the timeline:
 * one cell per motionStepMs from motionStartedAt, each step an arc with a
 * squash on landing. Several figurines on one cell share a small ellipse.
 * HUD hover (runtime.highlightPlayerId) lifts a figurine into a soft
 * spotlight with a halo in its seat colour; the camera never moves for it.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Player } from "@global-fund/shared";
import { playCue } from "../../presentation/audio";
import { PRESENTATION_TIMING, type BoardTimeline } from "../../presentation/sequence";
import { PawnModel } from "./pawns";
import { haloRingTexture, radialGlowTexture } from "./materials";
import { CELL_COUNT, PLAQUE_TOP, cellAt, stackSlot, standOffset, wrapCell } from "./layout";
import { clamp01, dampFactor, useRuntime } from "./runtime";
import { useDisposable } from "./Board";

const HOP = 0.55;
const FIGURINE_SCALE = 0.95;
/** HUD hover: lift (world units) and halo pulse period (s). */
const HIGHLIGHT_LIFT = 0.17;
const HIGHLIGHT_PERIOD = 1.2;

/** Display position of each figurine this frame (read by the highlight light). */
type Positions = Map<string, { x: number; y: number; z: number }>;

interface Motion {
  from: number;
  to: number;
  start: number;
  steps: number;
  lastAudibleStep: number;
  endAt: number;
  x: number;
  z: number;
  scale: number;
  yaw: number;
  initialised: boolean;
  moving: boolean;
  lift: number;
}

function Figurine({ player, slot, count, active, quality, timeline, reduced, positions }: {
  player: Player; slot: number; count: number; active: boolean; quality: "high" | "medium" | "low";
  timeline: BoardTimeline | null; reduced: boolean; positions: Positions;
}) {
  const runtime = useRuntime();
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const pos = wrapCell(player.sectorPosition);
  const motion = useRef<Motion>({ from: pos, to: pos, start: 0, steps: 0, lastAudibleStep: -1, endAt: -1e9, x: 0, z: 0, scale: 1, yaw: 0, initialised: false, moving: false, lift: 0 });

  useEffect(() => {
    const m = motion.current;
    if (m.to === pos) return;
    m.from = m.to;
    m.to = pos;
    m.steps = (pos - m.from + CELL_COUNT) % CELL_COUNT;
    if (timeline?.playerId === player.id && timeline.toPosition === pos) {
      m.from = timeline.fromPosition;
      m.steps = timeline.roll;
      m.start = timeline.motionStartedAt;
    } else m.start = performance.now();
    m.lastAudibleStep = -1;
    if (reduced) playCue("pawn_move");
  }, [pos, reduced, timeline, player.id]);

  useFrame((_, delta) => {
    const g = group.current, b = body.current;
    if (!g || !b) return;
    const rt = runtime.current;
    const m = motion.current;
    const now = performance.now();
    const live = rt.timeline;
    const matches = !!live && live.playerId === player.id && live.fromPosition === m.from && live.toPosition === m.to && live.roll === m.steps && m.steps > 0;
    // The presentation clock rebases after commit: always read the live epoch.
    const startedAt = matches ? live!.motionStartedAt : m.start;
    const stepMs = live?.motionStepMs || PRESENTATION_TIMING.step;
    const duration = Math.max(1, m.steps * stepMs);
    const elapsed = Math.max(0, now - startedAt);
    const progress = rt.reduced ? 1 : Math.min(1, elapsed / duration);
    const cell = cellAt(m.to);
    const target = stackSlot(cell, count, slot);
    const tx = cell.cx + target.x, tz = cell.cz + target.z;
    let x = tx, z = tz, y = 0, squash = 1, yawTarget = 0;
    if (progress < 1 && m.steps > 0) {
      const fraction = progress * m.steps;
      const step = Math.min(m.steps - 1, Math.floor(fraction));
      const t = fraction - step;
      if (now >= startedAt && step !== m.lastAudibleStep) { m.lastAudibleStep = step; playCue("pawn_move"); }
      const a = cellAt(m.from + step), c = cellAt(m.from + step + 1);
      const sa = standOffset(a), sc = standOffset(c);
      const ax = step === 0 ? m.x : a.cx + sa.x, az = step === 0 ? m.z : a.cz + sa.z;
      const last = step === m.steps - 1;
      const bx = last ? tx : c.cx + sc.x, bz = last ? tz : c.cz + sc.z;
      const ease = t * t * (3 - 2 * t);
      x = ax + (bx - ax) * ease;
      z = az + (bz - az) * ease;
      const air = clamp01((t - 0.08) / 0.84);
      y = HOP * Math.sin(Math.PI * air);
      squash = t < 0.08 ? 1 - 0.14 * (1 - t / 0.08) : t > 0.92 ? 1 - 0.14 * ((t - 0.92) / 0.08) : 1 + 0.06 * Math.sin(Math.PI * air);
      yawTarget = Math.atan2(bx - ax, bz - az) * 0.45;
      m.endAt = startedAt + duration;
      m.moving = true;
    } else {
      if (!m.initialised || rt.reduced || m.moving) { m.x = tx; m.z = tz; }
      else {
        const k = dampFactor(9, Math.min(delta, 0.1));
        m.x += (tx - m.x) * k;
        m.z += (tz - m.z) * k;
      }
      m.moving = false;
      x = m.x; z = m.z;
      const since = now - m.endAt;
      if (!rt.reduced && since >= 0 && since < 200) squash = 1 - 0.13 * (1 - since / 200);
    }
    m.initialised = true;
    const scaleTarget = target.scale * FIGURINE_SCALE;
    m.scale = rt.reduced ? scaleTarget : m.scale + (scaleTarget - m.scale) * dampFactor(8, Math.min(delta, 0.1));
    m.yaw = rt.reduced ? 0 : m.yaw + (yawTarget - m.yaw) * dampFactor(10, Math.min(delta, 0.1));
    // HUD hover: rise a little and float (static in reduced motion).
    const liftTarget = rt.highlightPlayerId === player.id ? HIGHLIGHT_LIFT : 0;
    m.lift = rt.reduced ? liftTarget : m.lift + (liftTarget - m.lift) * dampFactor(7, Math.min(delta, 0.1));
    const float = rt.reduced ? 0 : m.lift * 0.09 * Math.sin((now / 1000) * ((Math.PI * 2) / HIGHLIGHT_PERIOD));
    g.position.set(x, PLAQUE_TOP + y + m.lift + float, z);
    let at = positions.get(player.id);
    if (!at) { at = { x, y: 0, z }; positions.set(player.id, at); }
    at.x = x; at.y = y + m.lift; at.z = z;
    g.rotation.y = m.yaw;
    const s = m.scale || scaleTarget;
    b.scale.set(s / Math.sqrt(squash), s * squash, s / Math.sqrt(squash));
    if (active) { rt.activePos.x = x; rt.activePos.z = z; }
  });

  return (
    <group ref={group}>
      <group ref={body}>
        <PawnModel piece={player.pawn} seatColor={player.color} active={active} jailed={player.jailed || player.zone === "prison"} quality={quality} />
      </group>
    </group>
  );
}

const GOLD_TINT = new THREE.Color("#ffd58a");

export function Figurines({ players, activeId, quality, timeline, reduced, spotlight }: {
  players: Player[]; activeId: string; quality: "high" | "medium" | "low"; timeline: BoardTimeline | null; reduced: boolean; spotlight: boolean;
}) {
  const runtime = useRuntime();
  const positions = useMemo<Positions>(() => new Map(), []);
  const slots = useMemo(() => {
    const map = new Map<string, { slot: number; count: number }>();
    for (const player of players) {
      const peers = players.filter((p) => wrapCell(p.sectorPosition) === wrapCell(player.sectorPosition));
      map.set(player.id, { slot: peers.findIndex((p) => p.id === player.id), count: peers.length });
    }
    return map;
  }, [players]);
  const light = useRef<THREE.SpotLight>(null);
  const pool = useRef<THREE.Mesh>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const poolMaterial = useDisposable(() => new THREE.MeshBasicMaterial({ map: radialGlowTexture(), color: new THREE.Color("#ffcf86").multiplyScalar(0.16), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 }), []);
  const poolGeometry = useDisposable(() => new THREE.PlaneGeometry(1.15, 1.15).rotateX(-Math.PI / 2), []);
  // HUD hover highlight: ground halo in the seat colour + a soft spotlight.
  const halo = useRef<THREE.Mesh>(null);
  const haloLight = useRef<THREE.SpotLight>(null);
  const haloTarget = useMemo(() => new THREE.Object3D(), []);
  const haloMaterial = useDisposable(() => new THREE.MeshBasicMaterial({ map: haloRingTexture(), color: new THREE.Color("#ffd58a"), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }), []);
  const haloGeometry = useDisposable(() => new THREE.PlaneGeometry(1.45, 1.45).rotateX(-Math.PI / 2), []);
  const highlight = useRef({ id: null as string | null, level: 0, color: new THREE.Color() });

  useFrame((_, delta) => {
    const rt = runtime.current;
    const p = rt.activePos;
    target.position.set(p.x, PLAQUE_TOP, p.z);
    target.updateMatrixWorld();
    if (light.current) light.current.position.set(p.x * 0.85, 6.2, p.z * 0.85 + 2.2);
    if (pool.current) {
      pool.current.position.set(p.x, PLAQUE_TOP + 0.004, p.z);
      const breathe = rt.reduced ? 1 : 0.85 + 0.15 * Math.sin(performance.now() / 700);
      (pool.current.material as THREE.MeshBasicMaterial).opacity = 0.6 * breathe;
    }

    // Highlight: fade towards the hovered figurine (keeps the last one while fading out).
    const h = highlight.current;
    const wanted = rt.highlightPlayerId && positions.has(rt.highlightPlayerId) ? rt.highlightPlayerId : null;
    if (wanted && wanted !== h.id) {
      h.id = wanted;
      const seat = rt.game.players.find((player) => player.id === wanted)?.color ?? "#d2ad66";
      h.color.set(seat).lerp(GOLD_TINT, 0.25);
    }
    const goal = wanted ? 1 : 0;
    h.level = rt.reduced ? goal : h.level + (goal - h.level) * dampFactor(8, Math.min(delta, 0.1));
    const at = h.id ? positions.get(h.id) : undefined;
    const visible = !!at && h.level > 0.003;
    if (halo.current) {
      halo.current.visible = visible;
      if (visible && at) {
        const pulse = rt.reduced ? 0.85 : 0.75 + 0.25 * Math.sin((performance.now() / 1000) * ((Math.PI * 2) / HIGHLIGHT_PERIOD));
        halo.current.position.set(at.x, PLAQUE_TOP + 0.006, at.z);
        halo.current.scale.setScalar(0.94 + 0.08 * pulse);
        haloMaterial.color.copy(h.color).multiplyScalar(2.2);
        haloMaterial.opacity = 0.9 * h.level * pulse;
      }
    }
    if (haloLight.current) {
      haloLight.current.intensity = visible ? 44 * h.level : 0;
      if (at) {
        haloTarget.position.set(at.x, PLAQUE_TOP + 0.35, at.z);
        haloTarget.updateMatrixWorld();
        haloLight.current.position.set(at.x * 0.9, 5.4, at.z * 0.9 + 1.8);
      }
    }
  });

  return (
    <group>
      {players.map((player) => {
        const s = slots.get(player.id) ?? { slot: 0, count: 1 };
        return <Figurine key={player.id} player={player} slot={s.slot} count={s.count} active={player.id === activeId} quality={quality} timeline={timeline} reduced={reduced} positions={positions} />;
      })}
      <mesh ref={pool} geometry={poolGeometry} material={poolMaterial} renderOrder={2} />
      <primitive object={target} />
      {spotlight && <spotLight ref={light} angle={0.24} penumbra={1} distance={14} decay={1.4} color="#ffe6bf" intensity={17} target={target} />}
      <mesh ref={halo} geometry={haloGeometry} material={haloMaterial} visible={false} renderOrder={3} />
      <primitive object={haloTarget} />
      {spotlight && <spotLight ref={haloLight} angle={0.22} penumbra={1} distance={12} decay={1.3} color="#fff0d8" intensity={0} target={haloTarget} />}
    </group>
  );
}
