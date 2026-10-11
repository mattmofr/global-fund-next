/**
 * Travel cinematic (presentation only). ONE pure function of time drives the
 * airliner, the globe's orientation and the camera for the whole flight, so
 * the plane and the camera always share the same clock and never jitter.
 *
 * Shot list (fractions of flight.durationMs = PRESENTATION_TIMING.travel):
 *   0.00–0.14 DIVE      board framing → low 3/4-front close-up; the plane stands on
 *                       the globe just past the departure pin, engines spooling up
 *   0.14–0.30 TAKE-OFF  tail up, roll, rotation, lift-off, gear up; low tracking shot
 *                       sweeping from the front to the side
 *   0.30–0.72 CRUISE    chase camera behind / above / aside; the globe turns beneath,
 *                       gentle weave and bank
 *   0.72–0.88 LANDING   descent with the destination pin ahead, gear down, flare,
 *                       touchdown, roll-out to the pin, propellers winding down
 *   0.88–1.00 RETURN    the camera rises back to the board framing (blended by the
 *                       camera rig with its own insets-based pose: `close` → 0)
 *
 * Spaces: "unit" = the globe's spin group before scaling (unit sphere, +Y north);
 * "world" = scene space. The globe turns like the board's focus logic (spin about
 * its axis, tilt about a horizontal axis) so the plane's route stays on the face
 * looking at the camera's starting position. Nothing here allocates per call.
 */
import * as THREE from "three";
import { AIRPLANE } from "./airplane";

/** Phase ends (fractions of the flight). */
export const TRAVEL_SHOTS = { dive: 0.14, takeoff: 0.3, cruise: 0.72, landing: 0.88 } as const;
/** Plane length in globe radii. */
export const PLANE_SCALE = 0.14;
/** Fractions of the flight for the arrival beats used by the globe. */
export const TRAVEL_BEATS = { touchdown: 0.83, stop: 0.88, gemPop: 0.955, vanish: 0.97 } as const;

// Taildragger geometry (plane units): main-wheel and tail-wheel contacts.
const MAIN_WHEEL_Y = AIRPLANE.mainWheel.y;
const MAIN_WHEEL_Z = AIRPLANE.mainWheel.z;
const TAIL_WHEEL_Y = AIRPLANE.tailWheel.y;
const TAIL_WHEEL_Z = AIRPLANE.tailWheel.z;
/** Nose-up attitude when standing on all three wheels. */
const GROUND_PITCH = Math.atan2(TAIL_WHEEL_Y - MAIN_WHEEL_Y, MAIN_WHEEL_Z - TAIL_WHEEL_Z);
/** Radius of a pin and its fund gems on the globe (unit arc). */
const CLUSTER = 0.088;
const U_ROLL = 0.15;
const U_LIFT = 0.215;
const U_TOUCH = TRAVEL_BEATS.touchdown;
/** Speed knots [u, fraction of cruise speed], smoothstep between knots (continuous acceleration). */
const SPEED_KNOTS: ReadonlyArray<readonly [number, number]> = [[U_ROLL, 0], [U_LIFT, 0.72], [0.3, 1], [0.7, 1], [U_TOUCH, 0.42], [TRAVEL_BEATS.stop, 0]];
const MAX_BANK = 0.3;
const TILT_LIMIT = 0.62;
/** During the close-up the plane rides near the top of the globe (rings dissolved, so the tilt is free). */
const CROWN_ELEVATION = 1.36;
const CROWN_TILT_LIMIT = 1.45;
const AZIMUTH_SAMPLES = 128;

const TAU = Math.PI * 2;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth01 = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const easeInOut = (t: number) => { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const easeOutBack = (t: number) => { const x = clamp01(t) - 1; return 1 + 2.4 * x * x * x + 1.4 * x * x; };
const easeInBack = (t: number) => { const x = clamp01(t); return 2.2 * x * x * x - 1.2 * x * x; };
const bump = (u: number, a: number, b: number) => (u <= a || u >= b ? 0 : Math.sin(Math.PI * (u - a) / (b - a)));

// =========================================================================
// Plan (built once per flight)
// =========================================================================
export interface FlightPlan {
  key: string | number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Great-circle axis (from × to); +normal is the plane's left. */
  normal: THREE.Vector3;
  /** Unit tangent at `from`, towards `to`. */
  tangent: THREE.Vector3;
  omega: number;
  /** Plane arc positions where it stands at departure / stops at arrival. */
  theta0: number;
  theta1: number;
  span: number;
  /** Cruise arc speed per unit of u. */
  speed: number;
  knotDistance: Float64Array;
  thetaLift: number;
  thetaTouch: number;
  climb: number;
  descent: number;
  gain: number;
  weave: number;
  curvature: number;
  azimuth: Float64Array;
}

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

function greatCircle(plan: FlightPlan, theta: number, out: THREE.Vector3) {
  return out.copy(plan.from).multiplyScalar(Math.cos(theta)).addScaledVector(plan.tangent, Math.sin(theta));
}

/** Lateral weave (radians towards +normal): a gentle S during the cruise, straight take-off and landing. */
function weaveAt(plan: FlightPlan, theta: number) {
  const x = (theta - plan.theta0) / plan.span;
  if (x <= 0 || x >= 1) return 0;
  return plan.weave * Math.sin(TAU * x) * smooth01(x / 0.22) * smooth01((1 - x) / 0.22);
}

function surfacePoint(plan: FlightPlan, theta: number, lateral: number, out: THREE.Vector3) {
  greatCircle(plan, theta, out);
  return out.multiplyScalar(Math.cos(lateral)).addScaledVector(plan.normal, Math.sin(lateral));
}

/** Point of the route centreline at fraction s (0 departure pin … 1 destination pin), at `radius`. */
export function routePoint(plan: FlightPlan, s: number, radius: number, out: THREE.Vector3) {
  return greatCircle(plan, s * plan.omega, out).multiplyScalar(radius);
}

function distanceAt(plan: FlightPlan, u: number) {
  if (u <= SPEED_KNOTS[0]![0]) return 0;
  for (let i = 0; i < SPEED_KNOTS.length - 1; i++) {
    const [u0, v0] = SPEED_KNOTS[i]!;
    const [u1, v1] = SPEED_KNOTS[i + 1]!;
    if (u <= u1) {
      const du = u1 - u0;
      const x = (u - u0) / du;
      return plan.knotDistance[i]! + du * plan.speed * (v0 * x + (v1 - v0) * (x * x * x - (x * x * x * x) / 2));
    }
  }
  return plan.knotDistance[SPEED_KNOTS.length - 1]!;
}

function speedAt(plan: FlightPlan, u: number) {
  if (u <= SPEED_KNOTS[0]![0] || u >= SPEED_KNOTS[SPEED_KNOTS.length - 1]![0]) return 0;
  for (let i = 0; i < SPEED_KNOTS.length - 1; i++) {
    const [u0, v0] = SPEED_KNOTS[i]!;
    const [u1, v1] = SPEED_KNOTS[i + 1]!;
    if (u <= u1) return plan.speed * (v0 + (v1 - v0) * smooth01((u - u0) / (u1 - u0)));
  }
  return 0;
}

/** Height gained in the air (above the roll height) at arc position theta. */
function airborne(plan: FlightPlan, theta: number) {
  if (theta <= plan.thetaLift || theta >= plan.thetaTouch) return 0;
  const up = smooth01((theta - plan.thetaLift) / plan.climb);
  const down = smooth01((plan.thetaTouch - theta) / plan.descent);
  return plan.gain * Math.min(up, down);
}

/** Normalised lateral curvature of the weave (−1 … 1, + = turning left). */
function curvatureAt(plan: FlightPlan, theta: number) {
  const h = plan.span * 0.004;
  return ((weaveAt(plan, theta + h) - 2 * weaveAt(plan, theta) + weaveAt(plan, theta - h)) / (h * h)) / plan.curvature;
}

function azimuthAt(plan: FlightPlan, theta: number) {
  const f = THREE.MathUtils.clamp(theta / plan.omega, 0, 1) * (AZIMUTH_SAMPLES - 1);
  const i = Math.min(AZIMUTH_SAMPLES - 2, Math.floor(f));
  const t = f - i;
  return plan.azimuth[i]! + (plan.azimuth[i + 1]! - plan.azimuth[i]!) * t;
}

export function planFlight(from: THREE.Vector3, to: THREE.Vector3, key: string | number): FlightPlan {
  const omega = Math.acos(THREE.MathUtils.clamp(from.dot(to), -1, 1));
  const normal = new THREE.Vector3().crossVectors(from, to);
  if (normal.lengthSq() < 1e-10) normal.set(0, 1, 0).cross(from);
  if (normal.lengthSq() < 1e-10) normal.set(1, 0, 0);
  normal.normalize();
  const tangent = new THREE.Vector3().crossVectors(normal, from).normalize();
  const margin = CLUSTER + 0.5 * PLANE_SCALE + 0.02;
  let theta0 = margin, theta1 = omega - margin;
  if (theta1 - theta0 < 0.2) { theta0 = omega * 0.25; theta1 = omega * 0.75; }
  const span = theta1 - theta0;
  // Cruise speed so the speed profile covers the span exactly.
  let units = 0;
  const knotDistance = new Float64Array(SPEED_KNOTS.length);
  for (let i = 0; i < SPEED_KNOTS.length - 1; i++) {
    knotDistance[i] = units;
    units += (SPEED_KNOTS[i + 1]![0] - SPEED_KNOTS[i]![0]) * (SPEED_KNOTS[i]![1] + SPEED_KNOTS[i + 1]![1]) / 2;
  }
  knotDistance[SPEED_KNOTS.length - 1] = units;
  const speed = span / units;
  for (let i = 0; i < knotDistance.length; i++) knotDistance[i]! *= speed;
  const plan: FlightPlan = {
    key, from: from.clone(), to: to.clone(), normal, tangent, omega, theta0, theta1, span, speed, knotDistance,
    thetaLift: 0, thetaTouch: 0, climb: 1, descent: 1, gain: 0,
    weave: Math.tan((10 * Math.PI) / 180) * span / TAU, curvature: 1,
    azimuth: new Float64Array(AZIMUTH_SAMPLES),
  };
  plan.thetaLift = theta0 + distanceAt(plan, U_LIFT);
  plan.thetaTouch = theta0 + distanceAt(plan, U_TOUCH);
  const air = plan.thetaTouch - plan.thetaLift;
  plan.climb = THREE.MathUtils.clamp(air * 0.38, 0.06, 0.7);
  plan.descent = THREE.MathUtils.clamp(air * 0.4, 0.06, 0.75);
  plan.gain = Math.min(0.16, 0.21 * Math.min(plan.climb, plan.descent));
  // Normalisation of the weave curvature.
  let peak = 1e-9;
  for (let i = 1; i < 255; i++) {
    const theta = theta0 + (span * i) / 255, h = span * 0.004;
    peak = Math.max(peak, Math.abs((weaveAt(plan, theta + h) - 2 * weaveAt(plan, theta) + weaveAt(plan, theta - h)) / (h * h)));
  }
  plan.curvature = peak;
  // Unwrapped azimuth of the centreline (the globe spin follows it).
  let previous = 0;
  for (let i = 0; i < AZIMUTH_SAMPLES; i++) {
    greatCircle(plan, (omega * i) / (AZIMUTH_SAMPLES - 1), _c);
    let az = Math.atan2(_c.x, _c.z);
    if (i > 0) az = previous + Math.atan2(Math.sin(az - previous), Math.cos(az - previous));
    plan.azimuth[i] = az;
    previous = az;
  }
  return plan;
}

// =========================================================================
// Start capture (the globe's pose and the facing direction when the cinematic begins)
// =========================================================================
export interface FlightStart {
  key: string | number | null;
  spin: number;
  tilt: number;
  azF: number;
  elevF: number;
  /** 2πk so the cinematic spin starts on the globe's current turn. */
  offset: number;
}

export function createFlightStart(): FlightStart {
  return { key: null, spin: 0, tilt: 0, azF: 0, elevF: 0.8, offset: 0 };
}

/** `facing` = direction from the globe centre towards the camera, in the globe root's space. */
export function captureFlightStart(plan: FlightPlan, spin: number, tilt: number, facing: THREE.Vector3, out: FlightStart) {
  _a.copy(facing);
  if (_a.lengthSq() < 1e-8) _a.set(0, 0.7, 0.7);
  _a.normalize();
  out.key = plan.key;
  out.spin = spin;
  out.tilt = tilt;
  out.azF = Math.atan2(_a.x, _a.z);
  out.elevF = Math.asin(THREE.MathUtils.clamp(_a.y, -1, 1));
  const first = out.azF - azimuthAt(plan, plan.theta0);
  out.offset = TAU * Math.round((spin - first) / TAU);
  return out;
}

// =========================================================================
// Frame (output of flightPose, preallocated)
// =========================================================================
export interface FlightFrame {
  key: string | number | null;
  /** Clock used for this frame (performance.now()). */
  now: number;
  raw: number;
  u: number;
  /** Cinematic running (motion allowed and 0 ≤ raw < 1). */
  active: boolean;
  /** 0 = board framing … 1 = full close-up (dive in, return out). */
  close: number;
  spin: number;
  tilt: number;
  axis: THREE.Vector3;
  /** Plane pose in unit space (the globe's spin group). */
  planePos: THREE.Vector3;
  planeQuat: THREE.Quaternion;
  planeScale: number;
  throttle: number;
  gear: number;
  /** Contrail emission weight (0 … 1). */
  emit: number;
  /** Route fraction reached by the plane (0 … 1). */
  head: number;
  onGround: boolean;
  /** World space: plane and cinematic camera. */
  planeWorld: THREE.Vector3;
  camPos: THREE.Vector3;
  camTarget: THREE.Vector3;
  camUp: THREE.Vector3;
  fov: number;
  near: number;
  /** Depth-of-field focus distance (world units) for post-processing. */
  dofFocus: number;
}

export function createFlightFrame(): FlightFrame {
  return {
    key: null, now: -1e9, raw: -1, u: 0, active: false, close: 0, spin: 0, tilt: 0, axis: new THREE.Vector3(-1, 0, 0),
    planePos: new THREE.Vector3(), planeQuat: new THREE.Quaternion(), planeScale: 0, throttle: 0, gear: 1, emit: 0, head: 0, onGround: true,
    planeWorld: new THREE.Vector3(), camPos: new THREE.Vector3(), camTarget: new THREE.Vector3(), camUp: new THREE.Vector3(0, 1, 0),
    fov: 30, near: 0.5, dofFocus: 10,
  };
}

/** What the globe publishes for the camera rig every frame (same clock, same pose). */
export interface TravelChannel {
  frame: FlightFrame;
}

export function createTravelChannel(): TravelChannel {
  return { frame: createFlightFrame() };
}

/** Close-up weight: eases in over the dive, out over the return. */
export function closeWeight(raw: number) {
  if (raw <= 0 || raw >= 1) return 0;
  return Math.min(easeInOut(raw / 0.135), 1 - easeInOut((raw - 0.885) / 0.115));
}

// Camera keys: [u, camera F, S, U, target F, S, U, fov, roll (× plane bank)], offsets in plane lengths
// in the route frame at the plane (F along the route, S to its right, U radial).
const CAMERA_KEYS: ReadonlyArray<readonly number[]> = [
  [0.0, 2.0, 1.35, 0.42, -0.3, 0, 0.16, 30, 0],
  [0.14, 1.82, 1.42, 0.38, -0.22, 0, 0.15, 31, 0],
  [0.19, 1.1, 1.78, 0.3, 0.12, 0, 0.12, 32, 0],
  [0.245, -0.25, 2.0, 0.36, 0.55, 0, 0.12, 33, 0.15],
  [0.31, -1.6, 1.45, 0.6, 0.55, 0, 0.1, 33, 0.25],
  [0.38, -2.1, 0.75, 1.3, 0.45, 0, -0.12, 33, 0.3],
  [0.54, -2.0, -0.4, 1.62, 0.35, 0, -0.2, 33, 0.3],
  [0.68, -2.1, 0.35, 1.4, 0.5, 0, -0.1, 33, 0.3],
  [0.77, -2.0, 0.8, 0.46, 1.25, 0, 0.06, 33, 0.2],
  [0.83, -1.75, 1.15, 0.34, 0.95, 0, 0.08, 32, 0.05],
  [0.885, -0.9, 1.75, 0.4, 0.35, 0, 0.12, 31, 0],
  [1.0, -0.7, 1.9, 0.55, 0.3, 0, 0.14, 31, 0],
];
const KEY_WIDTH = CAMERA_KEYS[0]!.length - 1;
const _key = new Float64Array(KEY_WIDTH);

/** Catmull-Rom (Hermite form, non-uniform knots) through the camera keys. */
function sampleCameraKeys(u: number, out: Float64Array) {
  const keys = CAMERA_KEYS;
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1]![0]!) i++;
  const k0 = keys[Math.max(0, i - 1)]!, k1 = keys[i]!, k2 = keys[i + 1]!, k3 = keys[Math.min(keys.length - 1, i + 2)]!;
  const u1 = k1[0]!, u2 = k2[0]!;
  const width = u2 - u1;
  const t = clamp01((u - u1) / width);
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  for (let c = 1; c <= KEY_WIDTH; c++) {
    const m1 = i === 0 ? 0 : ((k2[c]! - k0[c]!) / (u2 - k0[0]!)) * width;
    const m2 = i + 2 >= keys.length ? 0 : ((k3[c]! - k1[c]!) / (k3[0]! - u1)) * width;
    out[c - 1] = h00 * k1[c]! + h10 * m1 + h01 * k2[c]! + h11 * m2;
  }
  return out;
}

const _f = new THREE.Vector3();
const _up = new THREE.Vector3();
const _x = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _uw = new THREE.Vector3();
const _ub = new THREE.Vector3();
const _xb = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qt = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _anchor = new THREE.Vector3();
const _F = new THREE.Vector3();
const _S = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _view = new THREE.Vector3();
const _rootQ = new THREE.Quaternion();
const _rootP = new THREE.Vector3();
const _rootS = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

/**
 * The cinematic at `raw` (fraction of the flight; < 0 before, ≥ 1 after).
 * `root` = world matrix of the globe's root group, `radius` = globe radius.
 */
export function flightPose(plan: FlightPlan, start: FlightStart, raw: number, root: THREE.Matrix4, radius: number, out: FlightFrame) {
  const u = clamp01(raw);
  out.key = plan.key;
  out.raw = raw;
  out.u = u;
  out.close = closeWeight(raw);

  // --- plane along the route
  const theta = plan.theta0 + distanceAt(plan, u);
  const v = speedAt(plan, u);
  const vRel = plan.speed > 0 ? v / plan.speed : 0;
  const tailUp = smooth01((u - 0.165) / 0.035);
  const tailDown = smooth01((u - 0.845) / 0.03);
  const groundPitch = u < 0.5 ? GROUND_PITCH * (1 - tailUp) : GROUND_PITCH * tailDown;
  const ground = (-MAIN_WHEEL_Y * Math.cos(groundPitch) - MAIN_WHEEL_Z * Math.sin(groundPitch)) * PLANE_SCALE;
  const air = airborne(plan, theta);
  const slope = (airborne(plan, theta + 1e-4) - airborne(plan, theta - 1e-4)) / 2e-4;
  const alt = ground + air;
  const radial = 1 + alt;
  surfacePoint(plan, theta, weaveAt(plan, theta), _p);
  out.planePos.copy(_p).multiplyScalar(radial);
  out.onGround = air <= 1e-5;
  // Heading along the (weaving) ground track, then pitch about the wings, then bank about the nose.
  surfacePoint(plan, theta + 1e-3, weaveAt(plan, theta + 1e-3), _a);
  surfacePoint(plan, theta - 1e-3, weaveAt(plan, theta - 1e-3), _b);
  _up.copy(_p);
  _f.subVectors(_a, _b);
  _f.addScaledVector(_up, -_f.dot(_up)).normalize();
  const pitch = groundPitch + Math.atan(slope / radial)
    + 0.05 * smooth01((u - 0.2) / 0.03) * (1 - smooth01((u - 0.8) / 0.03))
    + 0.07 * bump(u, 0.785, 0.84);
  const bank = MAX_BANK * THREE.MathUtils.clamp(curvatureAt(plan, theta), -1, 1) * vRel * vRel;
  _x.crossVectors(_up, _f);
  _fw.copy(_f).multiplyScalar(Math.cos(pitch)).addScaledVector(_up, Math.sin(pitch));
  _uw.copy(_up).multiplyScalar(Math.cos(pitch)).addScaledVector(_f, -Math.sin(pitch));
  _ub.copy(_uw).multiplyScalar(Math.cos(bank)).addScaledVector(_x, Math.sin(bank));
  _xb.copy(_x).multiplyScalar(Math.cos(bank)).addScaledVector(_uw, -Math.sin(bank));
  out.planeQuat.setFromRotationMatrix(_m.makeBasis(_xb, _ub, _fw));
  out.planeScale = raw < 0 ? 0 : raw < 0.5 ? easeOutBack(raw / 0.045) : 1 - easeInBack((raw - TRAVEL_BEATS.vanish) / 0.07);
  out.throttle = u < 0.14 ? 0.5 * smooth01((u - 0.02) / 0.1)
    : u < 0.72 ? 0.5 + 0.5 * smooth01((u - 0.14) / 0.04) - 0.15 * smooth01((u - 0.36) / 0.1)
    : 0.85 - 0.3 * smooth01((u - 0.72) / 0.06) - 0.4 * smooth01((u - 0.83) / 0.04) - 0.15 * smooth01((u - 0.88) / 0.05);
  out.gear = u < 0.5 ? 1 - smooth01((u - 0.25) / 0.06) : smooth01((u - 0.69) / 0.06);
  out.emit = smooth01((u - 0.22) / 0.05) * (1 - smooth01((u - 0.78) / 0.05)) * vRel;
  out.head = theta / plan.omega;

  // --- globe orientation: the route centreline under the plane faces the start camera, rising
  // towards the top of the globe during the close-up (world up = the plane's up: a level horizon).
  greatCircle(plan, theta, _c);
  const crown = easeInOut(raw / 0.11) * (1 - easeInOut((raw - 0.885) / 0.115));
  const elevF = start.elevF + (CROWN_ELEVATION - start.elevF) * crown;
  const limit = TILT_LIMIT + (CROWN_TILT_LIMIT - TILT_LIMIT) * crown;
  let spin = start.azF - azimuthAt(plan, theta) + start.offset;
  let tilt = THREE.MathUtils.clamp(elevF - Math.asin(THREE.MathUtils.clamp(_c.y, -1, 1)), -limit, limit);
  const e = easeInOut(raw / 0.11);
  spin = start.spin + (spin - start.spin) * e;
  tilt = start.tilt + (tilt - start.tilt) * e;
  out.spin = spin;
  out.tilt = tilt;
  out.axis.set(-Math.cos(start.azF), 0, Math.sin(start.azF));
  _qt.setFromAxisAngle(out.axis, tilt);
  _qs.setFromAxisAngle(Y, spin);
  _q.multiplyQuaternions(_qt, _qs);
  root.decompose(_rootP, _rootQ, _rootS);
  const scale = radius * _rootS.x;
  out.planeWorld.copy(out.planePos).applyQuaternion(_q).applyQuaternion(_rootQ).multiplyScalar(scale).add(_rootP);

  // --- cinematic camera in the route frame at the plane (no weave: the plane sways in frame)
  const k = sampleCameraKeys(u, _key);
  _anchor.copy(_c).multiplyScalar(radial);
  _F.copy(plan.from).multiplyScalar(-Math.sin(theta)).addScaledVector(plan.tangent, Math.cos(theta)).normalize();
  _S.crossVectors(_F, _c);
  const L = PLANE_SCALE;
  // A breath of life: very slow drift, plus a faint rumble during the take-off roll only.
  const drift = Math.sin(u * 19) * 0.06 + Math.sin(u * 31 + 1.3) * 0.03;
  const rumble = bump(u, U_ROLL, U_LIFT + 0.01) * 0.012;
  _cam.copy(_anchor)
    .addScaledVector(_F, (k[0]! + drift * 0.5) * L)
    .addScaledVector(_S, (k[1]! + drift) * L)
    .addScaledVector(_c, (k[2]! + rumble * Math.sin(u * 900)) * L);
  const minRadius = 1.035;
  const r = _cam.length();
  if (r < minRadius) _cam.multiplyScalar(minRadius / r);
  _tgt.copy(_anchor).addScaledVector(_F, k[3]! * L).addScaledVector(_S, k[4]! * L).addScaledVector(_c, k[5]! * L);
  out.camPos.copy(_cam).applyQuaternion(_q).applyQuaternion(_rootQ).multiplyScalar(scale).add(_rootP);
  out.camTarget.copy(_tgt).applyQuaternion(_q).applyQuaternion(_rootQ).multiplyScalar(scale).add(_rootP);
  out.camUp.copy(_c).applyQuaternion(_q).applyQuaternion(_rootQ);
  _view.subVectors(out.camTarget, out.camPos).normalize();
  out.camUp.applyQuaternion(_qr.setFromAxisAngle(_view, -bank * k[7]!));
  out.fov = k[6]!;
  out.near = Math.max(0.012, 0.06 * scale * L);
  out.dofFocus = out.camPos.distanceTo(out.planeWorld);
  return out;
}

// =========================================================================
// Camera blending (dive and return): around the globe centre, log distance
// =========================================================================
export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  fov: number;
  near: number;
  /** Lens shift in px (setViewOffset x / y); 0 = centred. */
  shiftX: number;
  shiftY: number;
}

export function createCameraPose(): CameraPose {
  return { position: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 30, near: 0.5, shiftX: 0, shiftY: 0 };
}

const _da = new THREE.Vector3();
const _db = new THREE.Vector3();

/** a → b by w, swinging around `center` (no straight cut through the globe). */
export function blendCameraPoses(a: CameraPose, b: CameraPose, w: number, center: THREE.Vector3, out: CameraPose) {
  const t = clamp01(w);
  _da.subVectors(a.position, center);
  _db.subVectors(b.position, center);
  const la = Math.max(1e-4, _da.length()), lb = Math.max(1e-4, _db.length());
  _da.divideScalar(la);
  _db.divideScalar(lb);
  const angle = Math.acos(THREE.MathUtils.clamp(_da.dot(_db), -1, 1));
  if (angle < 1e-4) out.position.copy(_da);
  else {
    const s = Math.sin(angle);
    out.position.copy(_da).multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(_db, Math.sin(t * angle) / s);
  }
  out.position.normalize().multiplyScalar(Math.exp(Math.log(la) * (1 - t) + Math.log(lb) * t)).add(center);
  out.target.lerpVectors(a.target, b.target, t);
  out.up.lerpVectors(a.up, b.up, t).normalize();
  out.fov = a.fov + (b.fov - a.fov) * t;
  out.near = Math.exp(Math.log(a.near) * (1 - t) + Math.log(b.near) * t);
  out.shiftX = a.shiftX + (b.shiftX - a.shiftX) * t;
  out.shiftY = a.shiftY + (b.shiftY - a.shiftY) * t;
  return out;
}
