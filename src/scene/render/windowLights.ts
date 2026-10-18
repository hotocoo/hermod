import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { LIGHT_FX as LF, LIGHT_TIERS, NIGHT, type QualityTier } from '@/config/scene';
import { installRectChunk, lfxOn } from './lightFx';

/**
 * Window rect area lights (LTC). The emissive window panes of the buildings become real RectAreaLights at night: three evaluates the linearly transformed cosine
 * integral per pixel, so the glow wraps correctly over walls, roofs and ground. A fixed pool per tier (LIGHT_TIERS.rectLights) is assigned to the windows closest to
 * the camera; slots keep their window until it drops out of range (no flicker) and fade in when re-assigned.
 *
 * Units: three's RectAreaLight intensity is luminance, so a pane that is displayed with radiance L (NIGHT.winIntensity x night amount, HDR scene units where 1 unit is
 * 4 m and light has no distance scale) emits exactly that radiance onto its surroundings; irradiance falls off as area / distance^2, as for a real luminous panel.
 */
const R = LF.rect;
export interface Rect { c: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3; w: number; h: number }
const MAX_RECTS = 48;

/** Split a window-glass geometry into its planar panes: welded-vertex islands, merged when coplanar and close, each reduced to a centre, outward-ish normal and extents. */
export function paneRects(geo: THREE.BufferGeometry): Rect[] {
  const pos = geo.getAttribute('position'); if (!pos) return [];
  const idx = geo.index; const triCount = idx ? idx.count / 3 : pos.count / 3; const weld = new Map<string, number>(); const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) { const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`; let id = weld.get(k); if (id === undefined) { id = weld.size; weld.set(k, id); } vid[i] = id; }
  const parent = Int32Array.from({ length: weld.size }, (_, i) => i); const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const tri = (i: number, j: number) => (idx ? idx.getX(i * 3 + j) : i * 3 + j);
  for (let i = 0; i < triCount; i++) { const a = find(vid[tri(i, 0)]), b = find(vid[tri(i, 1)]), c = find(vid[tri(i, 2)]); parent[b] = a; parent[find(c)] = a; }
  type Tri = { v: THREE.Vector3[]; n: THREE.Vector3; area: number };
  const isl = new Map<number, Tri[]>(); const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < triCount; i++) {
    A.fromBufferAttribute(pos, tri(i, 0)); B.fromBufferAttribute(pos, tri(i, 1)); C.fromBufferAttribute(pos, tri(i, 2)); const n = new THREE.Vector3().crossVectors(B.clone().sub(A), C.clone().sub(A)); const area = n.length() * 0.5; if (area < 1e-9) continue;
    const key = find(vid[tri(i, 0)]); let e = isl.get(key); if (!e) { e = []; isl.set(key, e); } e.push({ v: [A.clone(), B.clone(), C.clone()], n: n.normalize(), area });
  }
  const UP = new THREE.Vector3(0, 1, 0); const out: Rect[] = [];
  for (const tris of isl.values()) {
    // glass is often a thin closed box: keep only the upright, outward-facing (away from the asset pivot) triangles, then those agreeing with their mean normal
    const face = tris.filter((q) => Math.abs(q.n.y) < 0.7 && q.n.x * (q.v[0].x + q.v[1].x + q.v[2].x) + q.n.z * (q.v[0].z + q.v[1].z + q.v[2].z) > 0); if (!face.length) continue;
    const mean = face.reduce((a2, q) => a2.addScaledVector(q.n, q.area), new THREE.Vector3()).normalize(); const keep = face.filter((q) => q.n.dot(mean) > 0.95); if (!keep.length) continue;
    const n = keep.reduce((a2, q) => a2.addScaledVector(q.n, q.area), new THREE.Vector3()).normalize(); const t = new THREE.Vector3().crossVectors(UP, n).normalize(); const b = new THREE.Vector3().crossVectors(n, t);
    let t0 = Infinity, t1 = -Infinity, b0 = Infinity, b1 = -Infinity, nm = 0, cnt = 0; for (const q of keep) for (const v of q.v) { const pt = v.dot(t), pb = v.dot(b); t0 = Math.min(t0, pt); t1 = Math.max(t1, pt); b0 = Math.min(b0, pb); b1 = Math.max(b1, pb); nm += v.dot(n); cnt++; }
    nm /= cnt; out.push({ c: t.clone().multiplyScalar((t0 + t1) / 2).addScaledVector(b, (b0 + b1) / 2).addScaledVector(n, nm), n, t, w: t1 - t0, h: b1 - b0 });
  }
  // merge muntin panes of one window: coplanar, same facing, centres within mergeDist; the union box replaces them
  for (let again = true; again;) {
    again = false;
    outer: for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], q = out[j]; if (a.n.dot(q.n) < 0.98) continue; const d = q.c.clone().sub(a.c); if (Math.abs(d.dot(a.n)) > 0.05 || d.length() > R.mergeDist) continue;
      const bA = new THREE.Vector3().crossVectors(a.n, a.t); const tc = [a.c.dot(a.t) - a.w / 2, a.c.dot(a.t) + a.w / 2, q.c.dot(a.t) - q.w / 2, q.c.dot(a.t) + q.w / 2]; const bc = [a.c.dot(bA) - a.h / 2, a.c.dot(bA) + a.h / 2, q.c.dot(bA) - q.h / 2, q.c.dot(bA) + q.h / 2];
      const t0 = Math.min(tc[0], tc[2]), t1 = Math.max(tc[1], tc[3]), b0 = Math.min(bc[0], bc[2]), b1 = Math.max(bc[1], bc[3]);
      out[i] = { c: a.t.clone().multiplyScalar((t0 + t1) / 2).addScaledVector(bA, (b0 + b1) / 2).addScaledVector(a.n, a.c.dot(a.n)), n: a.n, t: a.t, w: t1 - t0, h: b1 - b0 }; out.splice(j, 1); again = true; break outer;
    }
  }
  return out.filter((r) => r.w * r.h >= R.minArea).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_RECTS);
}

const WINDOW_MAT = /win(dow)?s?$/i;
/** Scale the emissive colour of every window material under `root` to `gain` times its authored colour (base colours are remembered, so repeated calls never compound). */
export function tonePanes(root: THREE.Object3D, gain: number, base: WeakMap<THREE.Material, THREE.Color>): void {
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.Material[] | undefined; if (!(o as THREE.Mesh).isMesh || !mat || Array.isArray(mat) || !WINDOW_MAT.test(mat.name || '') || !mat.emissive) return;
    let b = base.get(mat); if (!b) { b = mat.emissive.clone(); base.set(mat, b); } mat.emissive.copy(b).multiplyScalar(gain);
  });
}

interface Slot { light: THREE.RectAreaLight; key: number; fade: number }
interface Cand { d2: number; score: number; key: number; c: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3; w: number; h: number }
const MAX_DIST = 70;

export function createWindowLights(scene: THREE.Scene, renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
  let inited = false; let tier: QualityTier = 'low'; let slots: Slot[] = []; let meshes: { m: THREE.Mesh; rects: Rect[] }[] = []; let scanT = 1e9; let frame = 0; let on = false; let dirty = true; let last: unknown[] = [];
  const paneBase = new WeakMap<THREE.Material, THREE.Color>(); let paneT = 1e9; let paneDirty = true;
  const cache = new WeakMap<THREE.BufferGeometry, Rect[]>(); const M4 = new THREE.Matrix4(), M3 = new THREE.Matrix4(), V = new THREE.Vector3(), N = new THREE.Vector3(), T = new THREE.Vector3(), O = new THREE.Vector3(), Q = new THREE.Quaternion();
  const col = new THREE.Color(R.color); let best: Cand[] = [];

  const visibleChain = (o: THREE.Object3D | null) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  function rescan() {
    meshes = []; scene.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return; const mat = m.material as THREE.MeshStandardMaterial; if (Array.isArray(mat) || !WINDOW_MAT.test(mat.name || '') || !mat.emissive || mat.emissiveIntensity * (mat.emissive.r + mat.emissive.g + mat.emissive.b) < 0.05) return;
      let rects = cache.get(m.geometry); if (!rects) { rects = paneRects(m.geometry); cache.set(m.geometry, rects); } if (rects.length) meshes.push({ m, rects });
    });
  }
  function pickClosest(n: number) {
    best = []; const cam = camera.position; const push = (d2: number, key: number, c: THREE.Vector3, nn: THREE.Vector3, t: THREE.Vector3, w: number, h: number) => {
      const score = d2 / Math.max(w * h, 0.01); if (best.length >= n && score >= best[best.length - 1].score) return; const e: Cand = { d2, score, key, c: c.clone(), n: nn.clone(), t: t.clone(), w, h }; let i = best.length; while (i > 0 && best[i - 1].score > score) i--; best.splice(i, 0, e); if (best.length > n) best.pop();
    };
    meshes.forEach(({ m, rects }, mi) => {
      if (!visibleChain(m)) return; m.updateWorldMatrix(true, false); const im = m as THREE.InstancedMesh; const count = im.isInstancedMesh ? im.count : 1;
      for (let i = 0; i < count; i++) {
        if (im.isInstancedMesh) { im.getMatrixAt(i, M4); M4.premultiply(m.matrixWorld); } else M4.copy(m.matrixWorld);
        O.setFromMatrixPosition(M4); const s = M4.getMaxScaleOnAxis(); if (s < 0.01) continue; M3.extractRotation(M4);
        for (let r = 0; r < rects.length; r++) {
          const rc = rects[r]; V.copy(rc.c).applyMatrix4(M4); const dx = V.x - cam.x, dy = V.y - cam.y, dz = V.z - cam.z; const d2 = dx * dx + dy * dy + dz * dz; if (d2 > MAX_DIST * MAX_DIST) continue;
          N.copy(rc.n).applyMatrix4(M3); if (N.x * (V.x - O.x) + N.z * (V.z - O.z) < 0) N.negate(); T.copy(rc.t).applyMatrix4(M3);
          push(d2, mi * 1e6 + i * 100 + r, V, N, T, rc.w * s, rc.h * s);
        }
      }
    });
  }
  function apply(dt: number, k: number) {
    const L = Math.max(0, k - NIGHT.winFrom) * NIGHT.winIntensity * R.gain; const used = new Set<number>(); const free: Slot[] = [];
    for (const c of best) used.add(c.key);
    for (const s of slots) if (!used.has(s.key)) free.push(s);
    const have = new Set(slots.map((s) => s.key));
    for (const c of best) {
      if (have.has(c.key)) continue; const s = free.shift(); if (!s) break; s.key = c.key; s.fade = 0; have.add(c.key);
    }
    const byKey = new Map(best.map((c) => [c.key, c])); const B = new THREE.Vector3();
    for (const s of slots) {
      const c = byKey.get(s.key); const l = s.light;
      if (!c) { s.fade = Math.max(0, s.fade - dt / R.fade); l.intensity = L * s.fade; continue; }
      s.fade = Math.min(1, s.fade + dt / R.fade); B.crossVectors(c.n, c.t); T.copy(c.t);
      M4.makeBasis(T, B.negate(), N.copy(c.n).negate()); Q.setFromRotationMatrix(M4); l.quaternion.copy(Q); l.position.copy(c.c).addScaledVector(c.n, R.lift); l.width = Math.max(0.05, c.w); l.height = Math.max(0.05, c.h);
      const range = 1 - THREE.MathUtils.smoothstep(Math.sqrt(c.d2), MAX_DIST * 0.6, MAX_DIST); l.intensity = L * s.fade * range; l.color.copy(col);
    }
  }
  function build() {
    slots.forEach((s) => { scene.remove(s.light); s.light.dispose(); }); slots = [];
    const n = lfxOn('rect') ? (globalThis as { __lfx?: { rectLights?: number } }).__lfx?.rectLights ?? LIGHT_TIERS[tier].rectLights : 0; if (!n) return; // dev A/B: __lfx.rectLights overrides the pool size
    if (!inited) { installRectChunk(); RectAreaLightUniformsLib.init(); inited = true; }
    for (let i = 0; i < n; i++) { const l = new THREE.RectAreaLight(R.color, 0, 0.3, 0.4); l.visible = on; scene.add(l); slots.push({ light: l, key: -1, fade: 0 }); }
    dirty = true;
  }
  /** Set the visible state of the pool. Toggling changes the shader light count, so it only flips at dusk and dawn. */
  function setOn(v: boolean) { if (v === on) return; on = v; slots.forEach((s) => { s.light.visible = v; }); }
  /** While held the pool stays off whatever the hour: room warm-ups compile with the light set of the first inside frame. */
  let held = false;
  return {
    setTier(t: QualityTier) { if (t === tier && slots.length) return; tier = t; tonePanes(scene, LIGHT_TIERS[t].paneGain, paneBase); build(); },
    /** The scene's windows changed (site rebuilt, houses added): rescan on the next update. */
    invalidate() { dirty = true; paneDirty = true; },
    hold(v: boolean) { held = v; if (v) setOn(false); },
    /** `night` 0..1, `outside`: the island is rendered (not inside a room). */
    update(dt: number, night: number, outside: boolean) {
      last = [dt, night, outside]; paneT += dt; if (paneT > 2.5 || paneDirty) { paneT = 0; paneDirty = false; tonePanes(scene, LIGHT_TIERS[tier].paneGain, paneBase); } // new buildings bring new window materials
      if (!slots.length) return; const lit = outside && night - NIGHT.winFrom > 0.01; setOn(lit && !held);
      if (!lit) { slots.forEach((s) => { s.light.intensity = 0; s.fade = 0; s.key = -1; }); return; }
      scanT += dt; if (dirty || scanT > 2.5) { rescan(); scanT = 0; dirty = false; }
      if (++frame % R.every === 1 || !best.length) pickClosest(slots.length);
      apply(dt, night);
    },
    /** Compile the rect-light program variants once, off the hot path, so the first dusk does not hitch. */
    async warm() { if (!slots.length) return; const was = on; slots.forEach((s) => { s.light.visible = true; }); try { await renderer.compileAsync(scene, camera); } catch { /* ignore */ } slots.forEach((s) => { s.light.visible = was; }); },
    get count() { return slots.length; },
    /** Dev only: what the pool currently shows. */
    debug() { const all: unknown[] = []; scene.traverse((o) => { const m = o as THREE.InstancedMesh; const mt = m.material as THREE.MeshStandardMaterial | undefined; if (m.isMesh && mt && !Array.isArray(mt) && /win|glass/i.test(mt.name || '')) { const pos = m.geometry.getAttribute('position'); m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox!; all.push([mt.name, m.isInstancedMesh ? m.count : -1, pos.count, m.geometry.index?.count, bb.min.toArray().map((v) => +v.toFixed(2)), bb.max.toArray().map((v) => +v.toFixed(2)), paneRects(m.geometry).map((r) => [+r.w.toFixed(2), +r.h.toFixed(2)])]); } }); return { all, last, best: best.length, mi: meshes.map((x) => [x.m.name, (x.m as THREE.InstancedMesh).isInstancedMesh ? (x.m as THREE.InstancedMesh).count : -1, x.m.visible, visibleChain(x.m), x.rects.length]), meshes: meshes.length, rects: meshes.reduce((a, x) => a + x.rects.length, 0), slots: slots.map((s) => ({ key: s.key, fade: +s.fade.toFixed(2), I: +s.light.intensity.toFixed(2), w: +s.light.width.toFixed(2), h: +s.light.height.toFixed(2), p: s.light.position.toArray().map((v) => +v.toFixed(1)), vis: s.light.visible })) }; },
    dispose() { slots.forEach((s) => { scene.remove(s.light); s.light.dispose(); }); slots = []; },
  };
}
export type WindowLights = ReturnType<typeof createWindowLights>;
