import * as THREE from 'three';
import { GROWTH, PALETTE, POND_POS, type PlotPos } from '@/config/scene';
import { fbm, displace } from '../noise';
import { rng } from '../rng';
import type { Mats } from '../types';
import { windify } from '../render/wind';
import type { DockPlace, Flat, LaneArc } from '../growth/layout';
import { B, C, merge, mtx, type MergePart } from './architecture';

export interface TerrainOpts {
  R: number; tier: number; seed: string; edge: (theta: number) => number; maxR: number;
  /** Extra flattened zones (house plots, lanes, docks). */
  flats: readonly Flat[]; lanes: readonly LaneArc[]; docks: readonly DockPlace[]; grass: number;
}
export interface TerrainResult {
  top: THREE.Mesh; heightAt: (x: number, z: number) => number;
  /** Grass blades drawn, as a base count for the tier (scaled by island area). */
  setGrass: (base: number) => void; dispose: () => void;
}

/** Spatial hash over flat zones so the per-vertex flatten test stays cheap on large islands. */
function flatField(flats: readonly Flat[]) {
  const CELL = 4; const grid = new Map<number, Flat[]>(); const key = (i: number, j: number) => i * 4096 + j;
  flats.forEach((f) => { const reach = f.r + 1.6; for (let i = Math.floor((f.x - reach) / CELL); i <= Math.floor((f.x + reach) / CELL); i++) for (let j = Math.floor((f.z - reach) / CELL); j <= Math.floor((f.z + reach) / CELL); j++) { const k = key(i, j); const a = grid.get(k); if (a) a.push(f); else grid.set(k, [f]); } });
  return (x: number, z: number): number => { let flat = 1; const l = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!l) return 1; for (const f of l) { const dx = x - f.x, dz = z - f.z; const lim = f.r + 1.6; if (dx * dx + dz * dz > lim * lim) continue; const d = Math.sqrt(dx * dx + dz * dz); flat = Math.min(flat, Math.max(0, Math.min(1, (d - f.r) / 1.6))); } return flat; };
}

/** Island top, cliffs, coast, grass tufts, flowers, boulders and piers; returns the height sampler and a disposer. */
export function buildTerrain(M: Mats, parent: THREE.Group, plots: Record<string, PlotPos>, sign: PlotPos, o: TerrainOpts): TerrainResult {
  const root = new THREE.Group(); parent.add(root); const { R, tier, edge } = o; const Rm = o.maxR; const ratio = (R / GROWTH.baseRadius) ** 2;
  const segs = Math.min(340, Math.max(200, Math.round((200 * Rm) / GROWTH.baseRadius)));
  const geo = new THREE.PlaneGeometry(Rm * 2, Rm * 2, segs, segs); geo.rotateX(-Math.PI / 2); const p = geo.attributes.position; const col = new Float32Array(p.count * 3);
  const base: Flat[] = Object.values(plots).map((q) => ({ x: q.x, z: q.z, r: 3.1 })).concat([{ x: sign.x, z: sign.z, r: 1.6 }, { x: 0, z: 0, r: 3.0 }, { x: POND_POS.x, z: POND_POS.z, r: 2.6 }]);
  Object.entries(plots).concat([['sign', sign]]).forEach(([id, q]) => { if (id === 'hearth') return; const d = Math.hypot(q.x, q.z); for (let s = 2.6; s < d; s += 0.7) base.push({ x: (q.x / d) * s, z: (q.z / d) * s, r: 0.75 }); });
  const flats = base.concat(o.flats); const flatAt = flatField(flats);
  const g1 = new THREE.Color(PALETTE.terrain.g1), g2 = new THREE.Color(PALETTE.terrain.g2), g3 = new THREE.Color(PALETTE.terrain.g3), dirt = new THREE.Color(PALETTE.terrain.dirt), c = new THREE.Color();
  const height = (x: number, z: number, flat: number) => (fbm(x * 0.18, 0, z * 0.18, 4) * 0.55 + fbm(x * 0.9, 3, z * 0.9, 2) * 0.05) * flat + 0.02;
  for (let i = 0; i < p.count; i++) { let x = p.getX(i), z = p.getZ(i); const r = Math.hypot(x, z); const e = edge(Math.atan2(z, x)); if (r > e) { x *= e / r; z *= e / r; } const rr = Math.min(r, e); const flat = flatAt(x, z);
    let h = height(x, z, flat); const eg = Math.max(0, (rr - (e - 0.6)) / 0.6); h -= eg * 0.12; p.setXYZ(i, x, Math.max(0.0, h), z);
    const n = fbm(x * 0.35, 9, z * 0.35, 3); c.copy(g1).lerp(n > 0 ? g2 : g3, Math.min(1, Math.abs(n) * 2.2)); c.lerp(dirt, (1 - flat) * 0.18); const rim = Math.max(0, Math.min(1, (rr - (e - 1.5)) / 1.3)); c.lerp(dirt, rim * rim * 0.42).multiplyScalar(1 - rim * 0.08); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); const uv = geo.attributes.uv; const tile = (Rm * 2) / 2.8; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * tile, uv.getY(i) * tile); geo.computeVertexNormals();
  const top = new THREE.Mesh(geo, M.terrain); top.receiveShadow = true; root.add(top);
  const depth = GROWTH.cliffDepth[tier - 1] ?? GROWTH.cliffDepth[0], under = GROWTH.underDepth[tier - 1] ?? GROWTH.underDepth[0];
  const cliff = new THREE.CylinderGeometry(1, 0.82, depth, 256, 26, true); { const q = cliff.attributes.position; for (let i = 0; i < q.count; i++) { const x = q.getX(i), y = q.getY(i), z = q.getZ(i); const a = Math.atan2(z, x); const k = (1 + fbm(Math.cos(a) * 3, y * 0.9, Math.sin(a) * 3, 4) * 0.08 * (0.4 + (1.3 - y) * 0.3)) * edge(a); q.setXYZ(i, x * k, y, z * k); } cliff.computeVertexNormals(); const u2 = cliff.attributes.uv; for (let i = 0; i < u2.count; i++) u2.setXY(i, u2.getX(i) * 24 * (R / GROWTH.baseRadius), u2.getY(i) * 2.4 * (depth / 2.6)); }
  const cl = new THREE.Mesh(cliff, M.rock); cl.position.y = -depth / 2; cl.castShadow = cl.receiveShadow = true; root.add(cl);
  const cone = new THREE.ConeGeometry(0.82, under, 160, 30, true); { const q = cone.attributes.position; for (let i = 0; i < q.count; i++) { const x = q.getX(i), y = q.getY(i), z = q.getZ(i); const a = Math.atan2(z, x); const d = (1 + fbm(x * 0.4 * R, y * 0.5, z * 0.4 * R, 4) * 0.35) * edge(a); q.setXYZ(i, x * d, y, z * d); } cone.rotateX(Math.PI); cone.computeVertexNormals(); }
  const un = new THREE.Mesh(cone, M.rock); un.position.y = -depth - under / 2; un.castShadow = true; root.add(un);
  const lipCurve = new THREE.CatmullRomCurve3(Array.from({ length: 240 }, (_, i) => { const a = (i / 240) * Math.PI * 2; const e = edge(a) - 0.02; return new THREE.Vector3(Math.cos(a) * e, -0.04, Math.sin(a) * e); }), true);
  const lipG = new THREE.TubeGeometry(lipCurve, 480, 0.09, 12, true); { const cc = new Float32Array(lipG.attributes.position.count * 3); for (let i = 0; i < cc.length; i += 3) { cc[i] = 0.55; cc[i + 1] = 0.6; cc[i + 2] = 0.42; } lipG.setAttribute('color', new THREE.BufferAttribute(cc, 3)); }
  const lip = new THREE.Mesh(lipG, M.terrain); root.add(lip);
  function sampleH(x: number, z: number) { return Math.max(0, height(x, z, flatAt(x, z))); }
  const inside = (x: number, z: number, margin: number) => Math.hypot(x, z) < edge(Math.atan2(z, x)) - margin;
  const Rr = rng('tufts' + o.seed); const dm = new THREE.Object3D(); const tmpCol = new THREE.Color();
  // grass tufts with wind sway, wildflowers, boulders and shore rocks
  const blade = (() => { const parts: MergePart[] = []; for (let i = 0; i < 9; i++) { const pl = new THREE.PlaneGeometry(0.016, 0.2 + (i % 3) * 0.05, 1, 2); const q = pl.attributes.position; for (let k = 0; k < q.count; k++) { const yy = q.getY(k) + 0.11; q.setX(k, q.getX(k) * (1 - yy / 0.22)); q.setZ(k, yy * yy * 0.6); q.setY(k, yy); } parts.push({ g: pl, mtx: mtx((i % 3 - 1) * 0.03, 0, (Math.floor(i / 3) - 1) * 0.03, 0, (i / 9) * Math.PI * 2 + i, (i % 4 - 1.5) * 0.14), col: new THREE.Color(0x6f7d4f).lerp(new THREE.Color(0xaab27c), (i * 37 % 9) / 9) }); } return merge(parts); })();
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }); M.grass = grassMat; grassMat.userData.base = new THREE.Color(1, 1, 1); windify(grassMat, 'grass');
  const N = Math.min(24000, Math.round(o.grass * Math.pow(ratio, 0.8))); const tufts = new THREE.InstancedMesh(blade, grassMat, N); let k = 0, guard = 0;
  while (k < N && guard++ < N * 8) { const a = Rr() * Math.PI * 2, r = Math.sqrt(Rr()) * (Rm - 0.4); const x = Math.cos(a) * r, z = Math.sin(a) * r; if (!inside(x, z, 0.4) || flats.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < (f.r - 0.2) ** 2)) continue; dm.position.set(x, sampleH(x, z), z); const gs = 0.45 + Rr() * 0.55; dm.scale.set(gs * 1.6, gs * (0.6 + Rr() * 0.5), gs * 1.6); dm.rotation.set((Rr() - 0.5) * 0.25, Rr() * 6, (Rr() - 0.5) * 0.25); dm.updateMatrix(); tufts.setMatrixAt(k, dm.matrix); tufts.setColorAt(k, tmpCol.setHSL(0.2 + Rr() * 0.05, 0.25 + Rr() * 0.15, 0.62 + Rr() * 0.25)); k++; }
  tufts.count = k; tufts.receiveShadow = true; tufts.userData.noAO = true; const grassMax = k; const grassBase = o.grass; root.add(tufts);
  const NF = Math.round(600 * ratio); const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.035, 1), new THREE.MeshStandardMaterial({ roughness: 0.7 }), NF); const fc = [0xf2ead8, 0xe8c27a, 0xc9a0b8, 0xf4f0e6]; k = 0; guard = 0;
  while (k < NF && guard++ < NF * 8) { const a = Rr() * Math.PI * 2, r = Math.sqrt(Rr()) * (Rm - 0.6); const x = Math.cos(a) * r, z = Math.sin(a) * r; if (!inside(x, z, 0.6) || flats.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < f.r * f.r)) continue; dm.position.set(x, sampleH(x, z) + 0.14, z); dm.rotation.set(0, 0, 0); dm.scale.setScalar(0.8 + Rr()); dm.updateMatrix(); fl.setMatrixAt(k, dm.matrix); fl.setColorAt(k, tmpCol.set(fc[k % 4])); k++; }
  fl.count = k; fl.userData.noAO = true; root.add(fl);
  const rockG = displace(displace(new THREE.IcosahedronGeometry(0.3, 5), 0.1, 2.2, 4), 0.035, 9, 11); const NR = Math.round(26 * ratio); const rocks = new THREE.InstancedMesh(rockG, M.rock, NR + 120); k = 0; guard = 0;
  while (k < NR && guard++ < NR * 12) { const a = Rr() * Math.PI * 2, r = 4 + Math.sqrt(Rr()) * (Rm - 4.2); const x = Math.cos(a) * r, z = Math.sin(a) * r; if (!inside(x, z, 0.6) || flats.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < (f.r + 0.3) ** 2)) continue; const sc = 0.4 + Rr() * 1.1; dm.position.set(x, sampleH(x, z) - 0.06 * sc, z); dm.rotation.set((Rr() - 0.5) * 0.4, Rr() * 6, (Rr() - 0.5) * 0.4); dm.scale.set(sc * (0.8 + Rr() * 0.6), sc * (0.3 + Rr() * 0.25), sc * (0.7 + Rr() * 0.5)); dm.updateMatrix(); rocks.setMatrixAt(k++, dm.matrix); }
  const shoreN = tier > 1 ? Math.round((Math.PI * 2 * R) / 1.6) : 0; for (let i = 0; i < shoreN && k < NR + 120; i++) { const a = (i / shoreN) * Math.PI * 2 + (Rr() - 0.5) * 0.06; const e = edge(a) - 0.15 - Rr() * 0.5; const x = Math.cos(a) * e, z = Math.sin(a) * e; if (flats.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < f.r * f.r)) continue; const sc = 0.22 + Rr() * 0.4; dm.position.set(x, sampleH(x, z) - 0.02, z); dm.rotation.set((Rr() - 0.5) * 0.5, Rr() * 6, (Rr() - 0.5) * 0.5); dm.scale.set(sc * 1.3, sc * 0.55, sc); dm.updateMatrix(); rocks.setMatrixAt(k++, dm.matrix); }
  rocks.count = k; rocks.castShadow = rocks.receiveShadow = true; root.add(rocks);
  // cobbled lanes along the occupied rings
  o.lanes.forEach((l) => { const g = new THREE.RingGeometry(l.r - GROWTH.lane.width / 2, l.r + GROWTH.lane.width / 2, Math.max(8, Math.ceil((l.a1 - l.a0) * l.r * 3)), 1, -l.a1, l.a1 - l.a0); g.rotateX(-Math.PI / 2); const q = g.attributes.position; const uv2 = g.attributes.uv; for (let i = 0; i < q.count; i++) { q.setY(i, sampleH(q.getX(i), q.getZ(i)) + 0.045); uv2.setXY(i, q.getX(i) * 0.6, q.getZ(i) * 0.6); } g.computeVertexNormals(); const m = new THREE.Mesh(g, M.path); m.receiveShadow = true; root.add(m); });
  // piers: planks over the void, posts, a lantern at the end
  o.docks.forEach((d) => { const g = new THREE.Group(); g.position.set(d.x, 0.1, d.z); g.rotation.y = d.yaw; const D = GROWTH.docks; for (let i = 0; i < D.planks; i++) { const pl = B(D.width, 0.06, 0.27, M.timber, (Rr() - 0.5) * 0.03, 0, i * 0.285, 0.5); pl.rotation.y = (Rr() - 0.5) * 0.03; g.add(pl); } const len = D.planks * 0.285;
    [-1, 1].forEach((s) => { g.add(B(0.07, 0.07, len, M.beam, s * D.width * 0.5, -0.07, len / 2 - 0.15)); for (let i = 0; i <= Math.floor(D.planks / D.postEvery); i++) { const z = i * D.postEvery * 0.285 + 0.1; g.add(C(0.045, 0.05, 1.6, M.beam, 10, s * D.width * 0.5, -0.7, z)); if (i % 2 === 0) g.add(C(0.02, 0.02, 0.46, M.beam, 6, s * D.width * 0.5, 0.27, z)); } });
    const lp = C(0.035, 0.045, 0.9, M.ink, 10, D.width * 0.5, 0.45, len - 0.2); g.add(lp); const gl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), M.lamp); gl.position.set(D.width * 0.5, 0.95, len - 0.2); g.add(gl); const cap = C(0.0, 0.11, 0.1, M.ink, 12, D.width * 0.5, 1.07, len - 0.2); g.add(cap); root.add(g); });
  return {
    top, heightAt: sampleH,
    setGrass(baseCount: number) { tufts.count = Math.min(grassMax, Math.round(grassMax * (baseCount / Math.max(1, grassBase)))); },
    dispose() { parent.remove(root); root.traverse((n) => { const m = n as THREE.Mesh; if (m.geometry && n !== tufts) m.geometry.dispose(); }); tufts.geometry.dispose(); tufts.dispose(); fl.dispose(); rocks.dispose(); grassMat.dispose(); },
  };
}
