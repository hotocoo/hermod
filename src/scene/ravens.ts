import * as THREE from 'three';
import { HERE_PERCH_Z, RAVEN, SIGN_ARMS, SPRINGS, TIMING } from '@/config/scene';
import { spring, type Spring } from './spring';
import type { Plots, RingFn } from './types';
import type { World } from './world';

export type RavenKind = 'here' | 'away' | 'deliver';
/** A raven in flight (ravens) or sitting on a slot (perched). */
export interface RavenActor {
  g: THREE.Group; kind: RavenKind; slot?: number; phase: 'perched' | 'in' | 'out'; since: number;
  nextCaw: number; nextHop: number; nextPing: number; grow?: Spring; base: number; leaving?: boolean;
  curve?: THREE.CubicBezierCurve3; t: number; dur: number; flap: number; toId?: string; cb?: () => void; silent?: boolean; burst?: number; yaw?: number;
}
/** `anchor(id)` gives the plot (or 'search' signpost) position of the active map style. */
export interface RavenDeps { WK: World; island: THREE.Group; plots: Plots; islandY: Spring; reduced: boolean; ring: RingFn; anchor: (id: string) => { x: number; z: number } | undefined;
  /** False while the island sim is not advancing (inside a building, hidden tab): flights would freeze, so none start. */
  running: () => boolean }

/** Ravens that perch on the commons roof and signpost, hop, caw and fly off when the space changes. */
export function createRavens({ WK, island, plots, islandY, reduced, ring, anchor, running }: RavenDeps) {
  const ravens: RavenActor[] = [];
  const perched: RavenActor[] = [];
  let want = { here: 0, away: 0 }; let perchCool = 0;
  /** A send made while the island was not running; its raven lifts off when the island is back in view (one, however many were sent). */
  let owedOut: string | null = null;
  const pv3 = new THREE.Vector3();
  function makeRaven() { const g = WK.raven(); g.scale.setScalar(RAVEN.scale); g.userData.baseScale = RAVEN.scale; return g; }
  function slotPos(kind: RavenKind, slot: number, out: THREE.Vector3): THREE.Vector3 | null {
    if (kind === 'here') { const pl = plots.chat; if (!pl || !pl.built || pl.dying) return null; out.set(0, ((pl.g.userData.perchY as number | undefined) ?? 4.68) + pl.open.x * 0.85, HERE_PERCH_Z[slot]); pl.g.localToWorld(out); island.worldToLocal(out); return out; }
    const a = SIGN_ARMS[slot].angle; const sg = anchor('search') ?? { x: 0, z: 0 }; out.set(sg.x + Math.cos(a) * 0.88, 1.64 - slot * 0.24, sg.z - Math.sin(a) * 0.88); return out;
  }
  function launchPerch(kind: RavenKind, cb?: (() => void) | null): boolean {
    if (kind !== 'here') return false;
    const slot = HERE_PERCH_Z.findIndex((_, i) => !perched.some((r) => r.slot === i)); if (slot < 0) return false;
    const to = slotPos('here', slot, new THREE.Vector3()); if (!to) return false;
    const g = makeRaven(); g.scale.setScalar(0.0001); island.add(g);
    const rv: RavenActor = { g, kind: 'here', slot, phase: 'perched', since: 0, nextCaw: 1.2, nextHop: 3, nextPing: 0.2, t: 0, dur: 1, flap: 0, grow: spring(0, SPRINGS.raven), base: g.userData.baseScale || RAVEN.fallbackScale };
    rv.grow!.t = 1; if (reduced) rv.grow!.snap(1); perched.push(rv); cb?.(); return true;
  }
  function takeOff(r: RavenActor) { if (r.grow) { r.grow.t = 0; r.leaving = true; return; } const P = r.g.position.clone(); const Q = new THREE.Vector3(-P.x * 2.2 + (Math.random() - 0.5) * 20, 18, -P.z * 2.2 + 20); r.curve = new THREE.CubicBezierCurve3(P, new THREE.Vector3(P.x, P.y + 3, P.z), new THREE.Vector3(Q.x * 0.5, 15, Q.z * 0.5), Q); r.t = 0; r.dur = reduced ? 0.01 : 2.8; r.phase = 'out'; r.g.userData.letter.visible = false; ravens.push(r); }
  /** True while another flight fits under RAVEN.maxFlying; past it a flight is skipped (its callback still runs) so a burst never floods the sky. */
  const flightRoom = () => ravens.length < RAVEN.maxFlying;
  /** A raven from beyond the island carries a letter to the `toId` anchor; `cb` fires on arrival. Without motion, a running island, room or anchor there is no flight and `cb` fires at once. */
  function flyIn(toId: string, cb?: () => void): boolean {
    const q = anchor(toId);
    if (reduced || !running() || !flightRoom() || !q) { cb?.(); return false; }
    const a = Math.random() * Math.PI * 2; const S = RAVEN.spawn;
    const P = new THREE.Vector3(Math.cos(a) * S.dist, S.y, Math.sin(a) * S.dist); const Q = new THREE.Vector3(q.x, RAVEN.landY, q.z);
    const g = makeRaven(); island.add(g); g.userData.letter.visible = true;
    const curve = new THREE.CubicBezierCurve3(P, new THREE.Vector3(P.x * RAVEN.arcFrac, S.y + RAVEN.arcRise, P.z * RAVEN.arcFrac), new THREE.Vector3(Q.x, Q.y + RAVEN.arcRise, Q.z), Q);
    ravens.push({ g, kind: 'deliver', phase: 'in', since: 0, nextCaw: 0, nextHop: 0, nextPing: 0, base: RAVEN.scale, curve, t: 0, dur: RAVEN.flyInSec, flap: 0, toId, cb });
    return true;
  }
  /** A raven lifts off the `fromId` building with the sent letter and flies away. No flight under reduced motion or without room; while the island is not running it is owed until the island is back. */
  function flyOut(fromId: string): boolean {
    const q = anchor(fromId);
    if (reduced || !q) return false;
    if (!running()) { owedOut = fromId; return false; }
    if (!flightRoom()) return false;
    const g = makeRaven(); island.add(g); g.position.set(q.x, RAVEN.launchY, q.z);
    const rv: RavenActor = { g, kind: 'deliver', phase: 'in', since: 0, nextCaw: 0, nextHop: 0, nextPing: 0, base: RAVEN.scale, t: 0, dur: 1, flap: 0 };
    takeOff(rv); g.userData.letter.visible = true; rv.dur = RAVEN.flyOutSec;
    ring(q.x, q.z, { ...RAVEN.ring, y: RAVEN.launchY - RAVEN.ringDrop }); const pl = plots[fromId]; if (pl) pl.pop.v = RAVEN.pop;
    return true;
  }
  /** Poke the perched commons raven (burst of pings) or launch it if absent. */
  function sendRaven(_toId?: string, cb?: () => void) {
    const pr = perched[0]; if (pr) { pr.nextCaw = -0.01; pr.nextPing = 0; pr.burst = RAVEN.burst; cb?.(); return; } if (launchPerch('here', cb)) return; cb?.();
  }
  function reconcile(dt: number) {
    perchCool -= dt; if (perchCool > 0) return;
    (['here', 'away'] as const).forEach((kind) => { const cnt = ravens.concat(perched).filter((r) => r.kind === kind && r.phase !== 'out' && !r.leaving).length; const target = kind === 'here' ? Math.min(RAVEN.maxHere, want.here) : 0;
      if (cnt < target && islandY.x > -0.5 && (kind === 'away' || (plots.chat && plots.chat.scale.x > 0.95))) { if (launchPerch(kind, null)) perchCool = TIMING.perchCooldown; }
      else if (cnt > target) { const r = perched.find((x) => x.kind === kind && !x.leaving); if (r) { takeOff(r); perchCool = TIMING.perchCooldownTakeoff; } } });
  }
  function scatterPerched() { perched.forEach((r) => takeOff(r)); ravens.forEach((r) => { if (r.phase === 'in' && r.kind !== 'deliver') { r.phase = 'out'; r.t = 1; } }); }

  /** Advance every raven one frame (flight paths, hops, caws, pings). */
  function update(dt: number) {
    if (owedOut && running()) { const id = owedOut; owedOut = null; flyOut(id); }
    reconcile(dt);
    for (let i = ravens.length - 1; i >= 0; i--) { const rv = ravens[i]; rv.t = Math.min(1, rv.t + dt / rv.dur); const e = rv.t < 0.5 ? 4 * rv.t * rv.t * rv.t : 1 - Math.pow(-2 * rv.t + 2, 3) / 2; const pos = rv.curve!.getPoint(e); const ahead = rv.curve!.getPoint(Math.min(1, e + 0.02)); rv.g.position.copy(pos); if (ahead.distanceToSquared(pos) > 1e-6) rv.g.lookAt(island.localToWorld(ahead.clone())); rv.flap += dt * (rv.phase === 'in' ? 14 + (1 - e) * 6 : 18); rv.g.userData.wings.forEach((w: { pv: THREE.Group; s: number }) => { w.pv.rotation.y = 0; w.pv.rotation.z = w.s * Math.sin(rv.flap) * 0.8; }); rv.g.userData.legs.visible = false;
      if (rv.t >= 1) {
        if (rv.phase === 'in' && rv.kind !== 'deliver') { ravens.splice(i, 1); rv.phase = 'perched'; rv.since = 0; rv.nextCaw = 1.5 + Math.random() * 3; rv.nextHop = 2 + Math.random() * 3; perched.push(rv); const P = rv.g.position; if (!rv.silent) { ring(P.x, P.z, { ...RAVEN.ring, y: P.y - RAVEN.ringDrop }); if (plots.chat) plots.chat.pop.v = RAVEN.pop; } rv.cb?.(); continue; }
        if (rv.phase === 'in') { const q = (rv.toId ? anchor(rv.toId) : undefined) ?? anchor('search') ?? { x: 0, z: 0 }; ring(q.x, q.z, { r0: 1.2, r1: 7, dur: 1.6, w: 0.04 }); const tp = plots[rv.toId!]; if (tp) tp.pop.v = 6; rv.cb?.(); takeOff(rv); ravens.splice(i, 1); continue; }
        island.remove(rv.g); ravens.splice(i, 1); } }
    for (let k = perched.length - 1; k >= 0; k--) { const rv = perched[k]; if (rv.grow) { rv.grow.step(dt); rv.g.scale.setScalar(Math.max(0.0001, rv.grow.x) * rv.base); if (rv.leaving && rv.grow.x < 0.02) { island.remove(rv.g); perched.splice(k, 1); } } }
    perched.forEach((rv, k) => { const base = slotPos(rv.kind, rv.slot!, pv3); if (!base) { rv.leaving = true; if (rv.grow) rv.grow.t = 0; return; } rv.since += dt; rv.nextPing = (rv.nextPing == null ? 0 : rv.nextPing) - dt; if (!reduced && !rv.leaving && rv.nextPing <= 0) { const P = rv.g.position; const big = (rv.burst || 0) > 0; ring(P.x, P.z, { y: P.y - 0.2, r0: 0.18, r1: big ? 2.6 : 1.4, dur: big ? 1.4 : 1.6, w: big ? 0.03 : 0.02, op: 0.85 }); rv.burst = Math.max(0, (rv.burst || 0) - 1); rv.nextPing = big ? 0.35 : 2.4; } rv.nextCaw -= dt; rv.nextHop -= dt; const ud = rv.g.userData;
      let hop = 0; if (!reduced && rv.nextHop < 0) { const h = -rv.nextHop; hop = Math.sin(Math.min(1, h / 0.3) * Math.PI) * 0.06; if (h > 0.3) { rv.nextHop = 5 + Math.random() * 5; rv.yaw = Math.max(-0.7, Math.min(0.7, (rv.yaw || 0) + (Math.random() - 0.5) * 0.9)); } }
      rv.g.position.set(base.x, base.y + 0.5 + hop + (reduced ? 0 : Math.sin(rv.since * 2 + k) * 0.008), base.z);
      const face = plots.chat ? plots.chat.g.rotation.y + Math.PI : 0; rv.g.rotation.set(0, face + (rv.yaw || 0), 0); if (rv.g.userData.head && !reduced) rv.g.userData.head.rotation.y = Math.sin(rv.since * 0.7) * 0.5;
      let pitch = 0, flapA = 0.06; if (!reduced && rv.nextCaw < 0) { const c = -rv.nextCaw; pitch = -Math.sin(Math.min(1, c / 0.5) * Math.PI) * 0.45; flapA = 0.06 + Math.sin(Math.min(1, c / 0.5) * Math.PI) * 0.5; if (c > 0.5) rv.nextCaw = 3.5 + Math.random() * 4; }
      if (ud.neck) ud.neck.rotation.x = 0.55 + pitch; if (ud.setSpread) ud.setSpread(reduced ? 0 : Math.max(0, flapA - 0.06) * 0.35); if (ud.tail && !reduced) ud.tail.rotation.x = -0.2 + Math.sin(rv.since * 1.3) * 0.04; ud.legs.visible = true; ud.letter.visible = true; });
  }
  return {
    ravens, perched, update, sendRaven, flyIn, flyOut, scatterPerched,
    setWant(here?: number, away?: number) { want = { here: here || 0, away: away || 0 }; },
    /** Hold off new perches for `s` seconds (used while the island is switching). */
    holdPerch(s: number) { perchCool = s; },
  };
}
export type Ravens = ReturnType<typeof createRavens>;
