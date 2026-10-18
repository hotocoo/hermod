import * as THREE from 'three';
import { DIRECTOR } from '@/config/scene';

/** Camera state in the rig's terms: orbit angles, distance and look target, field of view. */
export interface Pose { az: number; el: number; dist: number; tx: number; ty: number; tz: number; fov: number }
export type ShotKind = keyof typeof DIRECTOR.shots;
export interface Obstacle { x: number; z: number; r: number }
export interface DirectorWorld { heightAt: (x: number, z: number) => number; obstacles: () => readonly Obstacle[] }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const toPos = (p: Pose, out: THREE.Vector3) => out.set(p.tx + Math.sin(p.az) * Math.cos(p.el) * p.dist, p.ty + Math.sin(p.el) * p.dist, p.tz + Math.cos(p.az) * Math.cos(p.el) * p.dist);

/**
 * Plays camera shots: the position follows a centripetal Catmull-Rom spline through a lifted, swung midpoint, the look target
 * leads it along its own eased curve, and the fov can dolly-zoom. The result is handed back as a Pose each frame.
 */
export function createDirector(world: DirectorWorld) {
  let shot: { posCurve: THREE.CatmullRomCurve3; tgtCurve: THREE.CatmullRomCurve3; from: Pose; to: Pose; t: number; dur: number; lead: number; dolly: number; lastAz: number } | null = null;
  const P = new THREE.Vector3(), T = new THREE.Vector3(), P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), M = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3();
  const out: Pose = { az: 0, el: 0, dist: 1, tx: 0, ty: 0, tz: 0, fov: 30 };

  function start(from: Pose, to: Pose, kind: ShotKind) {
    const S = DIRECTOR.shots[kind]; toPos(from, P0); toPos(to, P1);
    const travel = P0.distanceTo(P1); M.copy(P0).add(P1).multiplyScalar(0.5);
    M.addScaledVector(up, S.arc * travel * 0.22); side.subVectors(P1, P0).setY(0).cross(up).normalize();
    const sgn = (M.x * side.x + M.z * side.z) >= 0 ? 1 : -1; M.addScaledVector(side, sgn * S.swing * travel * 0.12);
    const posCurve = new THREE.CatmullRomCurve3([P0.clone(), M.clone(), P1.clone()], false, 'centripetal');
    const t0 = new THREE.Vector3(from.tx, from.ty, from.tz), t1 = new THREE.Vector3(to.tx, to.ty, to.tz);
    const tgtCurve = new THREE.CatmullRomCurve3([t0, t0.clone().lerp(t1, 0.5), t1], false, 'centripetal');
    shot = { posCurve, tgtCurve, from: { ...from }, to: { ...to }, t: 0, dur: S.dur, lead: S.lead, dolly: S.dolly, lastAz: from.az };
  }

  /** Advance; returns the pose to apply, or null when no shot is playing. `last` is true on the frame the shot ends. */
  function update(dt: number): { pose: Pose; done: boolean; u: number } | null {
    if (!shot) return null; const s = shot; s.t = Math.min(s.dur, s.t + dt); const u = s.t / s.dur; const pu = easeInOut(u); const tu = easeInOut(clamp01(u + s.lead));
    s.posCurve.getPoint(pu, P); s.tgtCurve.getPoint(tu, T);
    // keep the camera above the ground and out of buildings until the final approach
    const gy = world.heightAt(P.x, P.z) + DIRECTOR.groundClearance; if (P.y < gy) P.y = gy;
    if (u < DIRECTOR.obstacleReleaseAt && P.y < DIRECTOR.obstacleMaxY) for (const o of world.obstacles()) { const dx = P.x - o.x, dz = P.z - o.z; const d = Math.hypot(dx, dz), lim = o.r + DIRECTOR.obstacleMargin; if (d < lim && d > 1e-4) { P.x = o.x + (dx / d) * lim; P.z = o.z + (dz / d) * lim; } }
    const dx = P.x - T.x, dy = P.y - T.y, dz = P.z - T.z; const dist = Math.max(0.2, Math.hypot(dx, dy, dz));
    let az = Math.atan2(dx, dz); while (az - s.lastAz > Math.PI) az -= Math.PI * 2; while (s.lastAz - az > Math.PI) az += Math.PI * 2; s.lastAz = az;
    const lin = s.from.fov + (s.to.fov - s.from.fov) * easeInOut(u);
    const dollyFov = 2 * Math.atan(Math.tan((s.to.fov * Math.PI) / 360) * (dist / Math.max(0.2, s.to.dist))) * (180 / Math.PI);
    out.az = az; out.el = Math.asin(THREE.MathUtils.clamp(dy / dist, -1, 1)); out.dist = dist; out.tx = T.x; out.ty = T.y; out.tz = T.z; out.fov = THREE.MathUtils.clamp(lin + (dollyFov - lin) * s.dolly * Math.sin(Math.PI * u) , 8, 70);
    const done = s.t >= s.dur; if (done) shot = null; return { pose: out, done, u };
  }
  return { start, update, active: () => !!shot, cancel() { shot = null; } };
}
export type Director = ReturnType<typeof createDirector>;

/** Smooth procedural offsets for handheld camera feel: sums of incommensurate sines (no allocation). */
export function handheld(t: number, f: number, out: { x: number; y: number; z: number; roll: number }) {
  const w = t * f * Math.PI * 2;
  out.x = Math.sin(w * 0.93 + 1.3) + 0.5 * Math.sin(w * 2.11 + 4.1); out.y = Math.sin(w * 1.07 + 2.2) + 0.45 * Math.sin(w * 2.37); out.z = Math.sin(w * 0.81 + 5.0) + 0.4 * Math.sin(w * 1.93 + 0.7); out.roll = Math.sin(w * 0.77 + 3.3) + 0.5 * Math.sin(w * 1.71 + 1.1);
}
