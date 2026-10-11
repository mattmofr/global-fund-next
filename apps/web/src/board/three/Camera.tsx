/**
 * Camera rig. The board is framed inside the free rectangle left by the HUD
 * (insets) with a lens shift (setViewOffset), so it stays centred at any
 * aspect ratio. Modes are damped (~500 ms); idle drift, pointer parallax and
 * the crash shake are disabled in reduced motion.
 *
 * Travel ("flight"): the globe publishes the close-up camera of the travel
 * cinematic in runtime.travel for this very frame (it runs first); the rig keeps
 * computing the plain board framing underneath and blends the two with the
 * cinematic's close weight (dive in, return out), so the hand-back is exact.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BOARD_SIZE, CENTRE, FRAME_TOP, cellAt } from "./layout";
import { GLOBE_CENTER_Y } from "./Centerpiece";
import { dampFactor, useRuntime, type CameraMode } from "./runtime";
import { blendCameraPoses, createCameraPose } from "./travelCinematic";
import type { BoardInsets } from "../types";

const FOV = 30;
const DEG = Math.PI / 180;
const BOARD_NEAR = 0.5;
const GLOBE_CENTRE = new THREE.Vector3(CENTRE.globe.x, GLOBE_CENTER_Y, CENTRE.globe.z);
const boardPose = createCameraPose();
const flightPose = createCameraPose();
const blendedPose = createCameraPose();

interface Pose { tx: number; ty: number; tz: number; distance: number; elevation: number; azimuth: number; ax: number; ay: number }

const _camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
const _v = new THREE.Vector3();
const KEY_POINTS: THREE.Vector3[] = (() => {
  const h = BOARD_SIZE / 2;
  const list: THREE.Vector3[] = [];
  for (const x of [-h, h]) for (const z of [-h, h]) for (const y of [0, FRAME_TOP]) list.push(new THREE.Vector3(x, y, z));
  list.push(new THREE.Vector3(CENTRE.globe.x, GLOBE_CENTER_Y + CENTRE.globeRadius * 1.25, CENTRE.globe.z));
  return list;
})();

function direction(elevation: number, azimuth: number, out: THREE.Vector3) {
  return out.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
}

/** Distance and image offset that fit the whole board into the free rectangle. */
function fitBoard(width: number, height: number, insets: BoardInsets, elevation: number, azimuth: number, margin: number) {
  const fw = Math.max(80, width - insets.left - insets.right);
  const fh = Math.max(80, height - insets.top - insets.bottom);
  const focal = height / 2 / Math.tan((FOV * DEG) / 2);
  const target = new THREE.Vector3(0, 0.3, 0);
  let distance = 40;
  let bbox = { minU: 0, maxU: 0, minV: 0, maxV: 0 };
  for (let pass = 0; pass < 5; pass++) {
    direction(elevation, azimuth, _v);
    _camera.position.copy(target).addScaledVector(_v, distance);
    _camera.lookAt(target);
    _camera.updateMatrixWorld(true);
    const inverse = _camera.matrixWorldInverse;
    bbox = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
    for (const p of KEY_POINTS) {
      const c = _v.copy(p).applyMatrix4(inverse);
      const u = (focal * c.x) / -c.z, v = (focal * c.y) / -c.z;
      bbox.minU = Math.min(bbox.minU, u); bbox.maxU = Math.max(bbox.maxU, u);
      bbox.minV = Math.min(bbox.minV, v); bbox.maxV = Math.max(bbox.maxV, v);
    }
    const scale = Math.max((bbox.maxU - bbox.minU) / (fw * (1 - margin * 2)), (bbox.maxV - bbox.minV) / (fh * (1 - margin * 2)));
    distance *= scale;
  }
  return {
    distance,
    /** Axis position so the bbox centre lands on the free-rectangle centre. */
    ax: insets.left + fw / 2 - (bbox.minU + bbox.maxU) / 2,
    ay: insets.top + fh / 2 + (bbox.minV + bbox.maxV) / 2,
    cx: insets.left + fw / 2,
    cy: insets.top + fh / 2,
  };
}

export function CameraRig({ mode, insets }: { mode: CameraMode; insets: BoardInsets }) {
  const runtime = useRuntime();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const pose = useRef<Pose | null>(null);
  const elevation = 52 * DEG;
  const fit = useMemo(() => fitBoard(size.width, size.height, insets, elevation, 0, 0.035), [size.width, size.height, insets, elevation]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      pointer.current.x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      pointer.current.y = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
  useEffect(() => { invalidate(); }, [mode, fit, invalidate]);

  useFrame((_, delta) => {
    const rt = runtime.current;
    const now = performance.now();
    const target: Pose = { tx: 0, ty: 0.3, tz: 0, distance: fit.distance, elevation, azimuth: 0, ax: fit.ax, ay: fit.ay };
    const travel = rt.travel?.frame;
    const flying = !rt.reduced && !!travel && travel.active && Math.abs(now - travel.now) < 250;
    // Travel cinematic: underneath, the framing the board takes right after it (the "zone" mode
    // only exists because of the flight), so the return lands exactly where the rig resumes.
    const framing: CameraMode = flying ? (rt.game.phase === "sector" ? "player" : "global") : mode;
    if (framing === "player") {
      // Gentle follow: the roll frames the pawn with the dice tray, the walk follows the pawn.
      const stage = rt.stage ?? "";
      const px = rt.activePos.x, pz = rt.activePos.z;
      target.ty = 0.5; target.ax = fit.cx; target.ay = fit.cy;
      if (stage === "BOARD_FOCUS" || stage === "DICE_ROLLING" || stage === "DICE_RESULT") {
        target.tx = px * 0.32 + CENTRE.tray.x * 0.4; target.tz = pz * 0.32 + CENTRE.tray.z * 0.4;
        target.distance = fit.distance * 0.86; target.elevation = 50 * DEG;
      } else if (stage === "PAWN_MOVING" || stage === "PAWN_ARRIVAL" || stage === "SPACE_REVEAL") {
        // The walk follows the pawn; on arrival a slight push-in lets the sector effects read.
        const landed = stage !== "PAWN_MOVING";
        target.tx = px * (landed ? 0.46 : 0.4); target.tz = pz * (landed ? 0.46 : 0.4) + 0.2;
        target.distance = fit.distance * (landed ? 0.72 : 0.82); target.elevation = (landed ? 47.5 : 49) * DEG;
      } else {
        target.tx = px * 0.16; target.tz = pz * 0.16 + 0.15;
        target.distance = fit.distance * 0.94; target.elevation = 51 * DEG;
      }
    } else if (framing === "cell" && rt.hovered != null) {
      const cell = cellAt(rt.hovered);
      target.tx = cell.cx; target.tz = cell.cz; target.ty = 0.5;
      target.distance = fit.distance * 0.6; target.elevation = 50 * DEG; target.ax = fit.cx; target.ay = fit.cy;
    } else if (framing === "zone") {
      target.tx = CENTRE.globe.x; target.tz = CENTRE.globe.z; target.ty = GLOBE_CENTER_Y * 0.85;
      target.distance = fit.distance * 0.56; target.elevation = 30 * DEG; target.ax = fit.cx; target.ay = fit.cy;
    } else if (framing === "crash") {
      target.distance = fit.distance * 1.07;
    }
    const p = pose.current;
    if (!p || rt.reduced) pose.current = { ...target };
    else {
      const k = dampFactor(6.2, Math.min(delta, 0.1));
      p.tx += (target.tx - p.tx) * k; p.ty += (target.ty - p.ty) * k; p.tz += (target.tz - p.tz) * k;
      p.distance += (target.distance - p.distance) * k;
      p.elevation += (target.elevation - p.elevation) * k;
      p.azimuth += (target.azimuth - p.azimuth) * k;
      p.ax += (target.ax - p.ax) * k; p.ay += (target.ay - p.ay) * k;
    }
    const c = pose.current!;
    let elevationNow = c.elevation, azimuthNow = c.azimuth;
    if (!rt.reduced) {
      const ptr = pointer.current;
      const k = dampFactor(3, Math.min(delta, 0.1));
      ptr.sx += (ptr.x - ptr.sx) * k;
      ptr.sy += (ptr.y - ptr.sy) * k;
      azimuthNow += ptr.sx * 1.5 * DEG + Math.sin(now / 11000) * 0.6 * DEG;
      elevationNow += -ptr.sy * 1.0 * DEG + Math.sin(now / 17000) * 0.35 * DEG;
    }
    direction(elevationNow, azimuthNow, _v);
    camera.position.set(c.tx, c.ty, c.tz).addScaledVector(_v, c.distance);
    if (flying && travel) {
      boardPose.position.copy(camera.position);
      boardPose.target.set(c.tx, c.ty, c.tz);
      boardPose.up.set(0, 1, 0);
      boardPose.fov = FOV;
      boardPose.near = BOARD_NEAR;
      boardPose.shiftX = size.width / 2 - c.ax;
      boardPose.shiftY = size.height / 2 - c.ay;
      flightPose.position.copy(travel.camPos);
      flightPose.target.copy(travel.camTarget);
      flightPose.up.copy(travel.camUp);
      flightPose.fov = travel.fov;
      flightPose.near = travel.near;
      flightPose.shiftX = 0;
      flightPose.shiftY = 0;
      const view = blendCameraPoses(boardPose, flightPose, travel.close, GLOBE_CENTRE, blendedPose);
      camera.position.copy(view.position);
      camera.up.copy(view.up);
      camera.lookAt(view.target);
      camera.fov = view.fov;
      camera.near = view.near;
      camera.setViewOffset(size.width, size.height, view.shiftX, view.shiftY, size.width, size.height);
      camera.updateProjectionMatrix();
      return;
    }
    camera.up.set(0, 1, 0);
    camera.near = BOARD_NEAR;
    camera.lookAt(c.tx, c.ty, c.tz);
    if (!rt.reduced && rt.mood === "crash") {
      const age = (now - rt.shakeAt) / 1000;
      if (age >= 0 && age < 0.7) {
        const amp = 0.09 * (1 - age / 0.7) ** 2;
        camera.position.x += Math.sin(age * 61) * amp;
        camera.position.y += Math.sin(age * 47 + 1.3) * amp * 0.6;
        camera.rotateZ(Math.sin(age * 53 + 0.7) * amp * 0.06);
      }
    }
    if (camera.fov !== FOV) camera.fov = FOV;
    camera.setViewOffset(size.width, size.height, size.width / 2 - c.ax, size.height / 2 - c.ay, size.width, size.height);
    camera.updateProjectionMatrix();
  }, -1);

  return null;
}
