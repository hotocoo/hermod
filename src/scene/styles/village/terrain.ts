/**
 * Village ground: the heightfield (flattened under buildings and lanes, carved for ponds, harbour lagoon and stream, hills, terraced hill),
 * a vertex-blended PBR splat top surface (grass, meadow, path, sand, rock, mud as texture arrays), cliffs, underside and wind-swayed grass tufts.
 * `makeVillageHeight` is pure of three (noise only) so the plan and the mesh agree and tests can sample it.
 */
import * as THREE from 'three';
import { GROWTH } from '@/config/scene';
import { fbm } from '../../noise';
import { rng } from '../../rng';
import { windify } from '../../render/wind';
import { applyTerrainSplat, layerMeans } from '../../render/terrainShader';
import { macroGround } from './macro';
import { clamp, polyDist } from '../../site/geo';
import { HAMLETS, PLAZA, type V2 } from './config';
import { edgeAt, type VillagePlan, type VWater } from './plan';
import type { TerrainTextureSet } from './tex';

const TAU = Math.PI * 2;
export const SEA_Y = 0.0;
export const WATER_BED = -0.3;
interface Flat { x: number; z: number; r: number }
const smooth = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

function flatField(flats: readonly Flat[]) {
  const CELL = 4; const grid = new Map<number, Flat[]>(); const key = (i: number, j: number) => i * 4096 + j;
  flats.forEach((f) => { const reach = f.r + 1.6; for (let i = Math.floor((f.x - reach) / CELL); i <= Math.floor((f.x + reach) / CELL); i++) for (let j = Math.floor((f.z - reach) / CELL); j <= Math.floor((f.z + reach) / CELL); j++) { const k = key(i, j); const a = grid.get(k); if (a) a.push(f); else grid.set(k, [f]); } });
  return (x: number, z: number): number => { let flat = 1; const l = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!l) return 1; for (const f of l) { const dx = x - f.x, dz = z - f.z; const lim = f.r + 1.6; if (dx * dx + dz * dz > lim * lim) continue; const d = Math.sqrt(dx * dx + dz * dz); flat = Math.min(flat, smooth((d - f.r) / 1.6)); } return flat; };
}
/** Flat zones for a plan: plots, plaza, signpost, cottages, hamlets, areas and a bead chain along every path. */
export function planFlats(plan: VillagePlan): Flat[] {
  const out: Flat[] = [{ x: 0, z: 0, r: PLAZA.r + 0.3 }, { x: plan.sign.x, z: plan.sign.z, r: 1.6 }];
  plan.plotList.forEach((p) => out.push({ x: p.x, z: p.z, r: 3.1 }));
  plan.cottages.forEach((c) => out.push({ x: c.x, z: c.z, r: 1.3 }));
  plan.areas.forEach((a) => { if (a.kind !== 'orchard' && a.kind !== 'meadow') out.push({ x: a.x, z: a.z, r: a.r + 0.2 }); });
  HAMLETS.forEach((h) => { if (plan.placements.some((p) => p.kind === h.kind && p.x === h.x && p.z === h.z)) out.push({ x: h.x, z: h.z, r: Math.max(h.w, h.d) / 2 + 0.6 }); });
  for (const e of plan.edges) {
    if (e.kind === 'plaza' || e.kind === 'bridge') continue;
    for (let i = 0; i < e.pts.length; i += 2) out.push({ x: e.pts[i].x, z: e.pts[i].z, r: e.w / 2 + 0.35 });
    const l = e.pts[e.pts.length - 1]; out.push({ x: l.x, z: l.z, r: e.w / 2 + 0.35 });
  }
  return out;
}
function insideDist(p: V2, poly: readonly V2[]): number {
  // signed: positive inside
  let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c; }
  const d = polyDist(p, poly, true); return c ? d : -d;
}
const bbox = (poly: readonly V2[], pad: number) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad }; };

/** Radius of the island underside (cone below the cliff) at angle `a` and depth fraction `sn` (0 = cliff foot, 1 = apex); `edge` is the coast radius at `a`. Shared with the waterfall so the sheet follows the rock. */
export function undersideRadius(a: number, sn: number, edge: number, depth: number, under: number, R: number): number {
  const wt = smooth(sn / 0.35); const r0 = 0.82 * (1 - sn); const y0 = sn * under - under / 2;
  const kb = 1 + fbm(Math.cos(a) * 3, -depth * 0.45, Math.sin(a) * 3, 4) * 0.08 * (0.4 + (1.3 + depth / 2) * 0.3);
  const bulk = 1 + fbm(r0 * Math.cos(a) * 0.4 * R, y0 * 0.5, r0 * Math.sin(a) * 0.4 * R, 4) * 0.35;
  return r0 * edge * (kb * (1 - wt) + bulk * wt);
}

export type HeightFn = (x: number, z: number) => number;
export function makeVillageHeight(plan: VillagePlan): HeightFn {
  const flatAt = flatField(planFlats(plan)); const Rn = rng('vh' + plan.seed); const ox = Rn() * 40, oz = Rn() * 40;
  const waters = plan.waters.map((w) => ({ w, poly: w.poly, bb: bbox(w.poly, 1.2) })); const stream = plan.stream; const hills = plan.hills;
  return (x, z) => {
    const flat = flatAt(x, z);
    let h = (fbm(x * 0.18 + ox, 0, z * 0.18 + oz, 4) * 0.55 + fbm(x * 0.9, 3, z * 0.9, 2) * 0.05) * flat + 0.02;
    for (const hl of hills) { const d = Math.hypot(x - hl.x, z - hl.z) / hl.r; if (d < 1) { let b = hl.h * (1 - d * d) * (1 - d * d) * flat; if (hl.id === 'terraced-hill') { const t = b / 0.55; b = (Math.floor(t) + smooth((t - Math.floor(t) - 0.25) * 2.2)) * 0.55; } h += b; } }
    for (const { poly, bb } of waters) { if (x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1) continue; const d = insideDist({ x, z }, poly); if (d > -0.4) { const s = smooth((d + 0.1) / 1.0); h -= (h - WATER_BED) * s; } }
    if (stream && stream.pts.length > 1) { const d = polyDist({ x, z }, stream.pts); const hw = stream.w / 2; if (d < hw + 0.7) h -= (h - (SEA_Y - 0.12)) * (1 - smooth((d - hw * 0.6) / (hw * 0.4 + 0.7))); }
    return Math.max(WATER_BED, h);
  };
}

export interface VillageTerrain {
  group: THREE.Group; top: THREE.Mesh; heightAt: HeightFn;
  /** Swap the procedural tuft for an authored clump (geometry y-up, ~0.3 tall). */
  useGrass(geo: THREE.BufferGeometry, mat: THREE.Material): void;
  setGrass(base: number): void; setSeason(season: number): void; update(t: number): void; dispose(): void;
}
export interface TerrainOpts { grass: number; /** 0..3, default from the plan */ season?: number; grassGeometry?: THREE.BufferGeometry; grassMaterial?: THREE.Material }

const SEASON_GRASS = [[0.95, 1.05, 0.8], [1, 0.97, 0.78], [1.15, 0.85, 0.5], [0.92, 0.92, 0.9]] as const;

function splatMaterial(tex: TerrainTextureSet): THREE.MeshStandardMaterial {
  return applyTerrainSplat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }), { albedo: tex.splat.albedo, normal: tex.splat.normal, orm: tex.splat.orm, tile: tex.tile }, { key: 'village-splat-macro', normalStrength: 0.55, blendBand: 0.3 });
}
const pbrMat = (t: { albedo: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture }, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ map: t.albedo, normalMap: t.normal, aoMap: t.orm, roughnessMap: t.orm, metalnessMap: t.orm, ...extra });

export function buildVillageTerrain(plan: VillagePlan, tex: TerrainTextureSet, o: TerrainOpts): VillageTerrain {
  const root = new THREE.Group(); root.name = 'village:terrain'; const { tier, R } = plan; const heightAt = makeVillageHeight(plan);
  const edgeTheta = (a: number) => edgeAt(plan.edge, Math.cos(a), Math.sin(a));
  const Rm = Math.max(...plan.edge) + 0.4; const ratio = (R / GROWTH.baseRadius) ** 2;
  const segs = Math.min(300, Math.max(180, Math.round((180 * Rm) / GROWTH.baseRadius)));
  const geo = new THREE.PlaneGeometry(Rm * 2, Rm * 2, segs, segs); geo.rotateX(-Math.PI / 2); const p = geo.attributes.position; const n = p.count;
  const w0 = new Float32Array(n * 4), w1 = new Float32Array(n * 2); const hs = new Float32Array(n);
  // clip the grid to the coast, then sample heights
  for (let i = 0; i < n; i++) { let x = p.getX(i), z = p.getZ(i); const r = Math.hypot(x, z); const e = edgeTheta(Math.atan2(z, x)); if (r > e) { x *= e / r; z *= e / r; } const rr = Math.min(r, e); const eg = Math.max(0, (rr - (e - 0.6)) / 0.6);
    let h = heightAt(x, z) - eg * 0.12; h = Math.max(h, h < SEA_Y - 0.05 ? WATER_BED : 0); hs[i] = h; p.setXYZ(i, x, h, z); }
  const step = (2 * Rm) / segs;
  const nPath = plan.edges.filter((e) => e.kind !== 'plaza' && e.kind !== 'bridge');
  // spatial hash of path polylines for weights
  const CELL = 3; const cells = new Map<number, { pts: V2[]; hw: number; kind: string }[]>(); const ck = (i: number, j: number) => i * 4096 + j;
  for (const e of nPath) { const seen = new Set<number>(); for (const q of e.pts) for (let i = Math.floor((q.x - e.w - 1) / CELL); i <= Math.floor((q.x + e.w + 1) / CELL); i++) for (let j = Math.floor((q.z - e.w - 1) / CELL); j <= Math.floor((q.z + e.w + 1) / CELL); j++) { const k = ck(i, j); if (seen.has(k)) continue; seen.add(k); const l = cells.get(k); const it = { pts: e.pts, hw: e.w / 2, kind: e.kind }; if (l) l.push(it); else cells.set(k, [it]); } }
  const pathW = (x: number, z: number): number => { const l = cells.get(ck(Math.floor(x / CELL), Math.floor(z / CELL))); if (!l) return 0; let best = 0; for (const it of l) { const d = polyDist({ x, z }, it.pts) - it.hw; best = Math.max(best, 1 - smooth((d + 0.05) / 0.5)); } return best; };
  const pathD = (x: number, z: number): number => { const l = cells.get(ck(Math.floor(x / CELL), Math.floor(z / CELL))); let best = 9; if (l) for (const it of l) best = Math.min(best, polyDist({ x, z }, it.pts) - it.hw); return best; };
  const Rb = rng('vsplat' + plan.seed); const ob = Rb() * 50; const mo = Rb() * 90, mz = Rb() * 90; const colr = new Float32Array(n * 3);
  const squares = plan.areas.filter((a) => a.kind === 'market' || a.kind === 'fishmarket' || a.kind === 'festival');
  const meadows = plan.areas.filter((a) => a.kind === 'meadow' || a.kind === 'orchard' || a.kind === 'lawn');
  const beds = plan.areas.filter((a) => a.kind === 'allotment');
  const waters = plan.waters.map((w: VWater) => ({ poly: w.poly, bb: bbox(w.poly, 4) }));
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), z = p.getZ(i), h = hs[i]; const r = Math.hypot(x, z); const e = edgeTheta(Math.atan2(z, x));
    const hx = hs[Math.min(n - 1, i + 1)], hz = hs[Math.min(n - 1, i + segs + 1)]; const slope = Math.min(1, Math.hypot(hx - h, hz - h) / step * 1.2);
    let path = pathW(x, z); if (r < PLAZA.r + 0.4) path = 1; for (const s of squares) { const d = Math.hypot(x - s.x, z - s.z) - s.r; path = Math.max(path, 1 - smooth((d + 0.1) / 0.5)); }
    const rim = clamp((r - (e - 1.8)) / 1.6, 0, 1); let sand = 0; const angle = Math.atan2(z, x);
    for (const b of plan.beaches) { let a = angle; if (a < b.a0 - 0.2) a += TAU; if (a >= b.a0 - 0.2 && a <= b.a1 + 0.2) sand = Math.max(sand, smooth(Math.min(a - b.a0 + 0.2, b.a1 + 0.2 - a) / 0.3) * rim); }
    let mud = 0; let waterD = 9; for (const w of waters) { if (x < w.bb.x0 || x > w.bb.x1 || z < w.bb.z0 || z > w.bb.z1) continue; const d = insideDist({ x, z }, w.poly); waterD = Math.min(waterD, -d); if (d > -1.0) mud = Math.max(mud, (1 - smooth((d + 1.0) / 1.3)) * 0.75); }
    if (plan.stream) { const d = polyDist({ x, z }, plan.stream.pts); waterD = Math.min(waterD, d - plan.stream.w / 2); mud = Math.max(mud, 1 - smooth((d - plan.stream.w / 2) / 1.2)); }
    for (const b of beds) { const d = Math.hypot(x - b.x, z - b.z) - b.r * 0.9; mud = Math.max(mud, 1 - smooth(d / 0.5)); }
    const nz = fbm(x * 0.3 + ob, 9, z * 0.3 + ob, 3); let meadow = clamp(nz * 2.2 + 0.1, 0, 1) * 0.7; for (const m of meadows) { const d = Math.hypot(x - m.x, z - m.z) - m.r; meadow = Math.max(meadow, (1 - smooth(d / 0.8)) * 0.9); }
    let pd = pathD(x, z); if (r < PLAZA.r + 0.4) pd = -1; for (const s of squares) pd = Math.min(pd, Math.hypot(x - s.x, z - s.z) - s.r);
    const mc = macroGround({ x, z, ox: mo, oz: mz, h, slope, pathD: pd, waterD }); colr[i * 3] = mc.r; colr[i * 3 + 1] = mc.g; colr[i * 3 + 2] = mc.b;
    meadow = clamp(meadow + mc.dry * 0.55 + mc.flower * 0.45, 0, 0.95); path = Math.max(path, mc.worn * 0.5);
    const rock = clamp(Math.max((slope - 0.55) * 3.2, rim * rim * 0.55, h < -0.05 ? 0.35 : 0), 0, 1);
    let g = 1, m2 = meadow, sa = sand, ro = rock; const pa = path, mu = mud; const keep = 1 - Math.max(pa, mu * 0.8); g *= keep; m2 *= keep; sa *= keep; ro *= 1 - pa * 0.6;
    g *= 1 - sa * 0.9; m2 *= 1 - sa * 0.9; g *= 1 - ro * 0.85; m2 *= 1 - ro * 0.85; g *= 1 - m2 * 0.9;
    const s = g + m2 + pa + sa + ro + mu || 1; w0[i * 4] = g / s; w0[i * 4 + 1] = m2 / s; w0[i * 4 + 2] = pa / s; w0[i * 4 + 3] = sa / s; w1[i * 2] = ro / s; w1[i * 2 + 1] = mu / s;
  }
  geo.setAttribute('aW0', new THREE.BufferAttribute(w0, 4)); geo.setAttribute('aW1', new THREE.BufferAttribute(w1, 2)); geo.setAttribute('color', new THREE.BufferAttribute(colr, 3)); geo.computeVertexNormals();
  const topMat = splatMaterial(tex); topMat.vertexColors = true; tex.onSplat = (sp) => { const u = topMat.userData.splatUniforms as Record<string, { value: unknown }>; u.uSpA.value = sp.albedo; u.uSpN.value = sp.normal; u.uSpO.value = sp.orm; }; topMat.userData.splatMeans = layerMeans(tex.splat.albedo); const top = new THREE.Mesh(geo, topMat); top.name = 'village:top'; top.receiveShadow = true; root.add(top);

  const depth = GROWTH.cliffDepth[tier - 1] ?? GROWTH.cliffDepth[0], under = GROWTH.underDepth[tier - 1] ?? GROWTH.underDepth[0];
  const cliffMat = pbrMat(tex.cliff, { color: 0xffffff }); tex.onMaps.push((k) => { if (k !== 'cliff') return; const t = tex.cliff; cliffMat.map = t.albedo; cliffMat.normalMap = t.normal; cliffMat.aoMap = cliffMat.roughnessMap = cliffMat.metalnessMap = t.orm; cliffMat.needsUpdate = true; }); const cliff = new THREE.CylinderGeometry(1, 0.82, depth, 256, 26, true);
  { const q = cliff.attributes.position; for (let i = 0; i < q.count; i++) { const x = q.getX(i), y = q.getY(i), z = q.getZ(i); const a = Math.atan2(z, x); const k = (1 + fbm(Math.cos(a) * 3, y * 0.9, Math.sin(a) * 3, 4) * 0.08 * (0.4 + (1.3 - y) * 0.3)) * edgeTheta(a); q.setXYZ(i, x * k, y, z * k); } cliff.computeVertexNormals(); const u2 = cliff.attributes.uv; for (let i = 0; i < u2.count; i++) u2.setXY(i, u2.getX(i) * (TAU * R) / 3, u2.getY(i) * depth / 3); }
  const cl = new THREE.Mesh(cliff, cliffMat); cl.position.y = -depth / 2; cl.castShadow = cl.receiveShadow = true; root.add(cl);
  const cone = new THREE.ConeGeometry(0.82, under, 256, 30, true); cone.rotateX(Math.PI); // flip first: deforming by angle after the flip mirrored the rim and left a crack against the cliff
  { const q = cone.attributes.position; for (let i = 0; i < q.count; i++) { const x = q.getX(i), y = q.getY(i), z = q.getZ(i); const a = Math.atan2(z, x); const rr = undersideRadius(a, (under / 2 - y) / under, edgeTheta(a), depth, under, R); q.setXYZ(i, Math.cos(a) * rr, y, Math.sin(a) * rr); } cone.computeVertexNormals(); const u3 = cone.attributes.uv; for (let i = 0; i < u3.count; i++) u3.setXY(i, u3.getX(i) * (TAU * R) / 3, u3.getY(i) * under / 3); }
  const un = new THREE.Mesh(cone, cliffMat); un.position.y = -depth - under / 2 + 0.03; un.castShadow = true; root.add(un);

  // grass tufts on grass and meadow, kept off paths, water, squares and plot pads
  const blade = o.grassGeometry ?? tuftGeometry(); const season0 = o.season ?? plan.season;
  const grassMat = o.grassMaterial ?? (() => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }); windify(m, 'grass'); return m; })();
  const Rr = rng('vtufts' + plan.seed); const N = Math.min(24000, Math.round(o.grass * Math.pow(ratio, 0.8)));
  const tufts = new THREE.InstancedMesh(blade, grassMat, N); const dm = new THREE.Object3D(); let k = 0, guard = 0; const col = new THREE.Color(); const tCell = new Int32Array(N);
  const wAt = (x: number, z: number) => { const gx = clamp(Math.round((x + Rm) / step), 0, segs), gz = clamp(Math.round((z + Rm) / step), 0, segs); const i = gz * (segs + 1) + gx; return w0[i * 4] + w0[i * 4 + 1]; };
  while (k < N && guard++ < N * 8) { const a = Rr() * TAU, r = Math.sqrt(Rr()) * (Rm - 0.4); const x = Math.cos(a) * r, z = Math.sin(a) * r; if (r > edgeTheta(a) - 0.5) continue; if (plan.plotList.some((pl) => Math.abs(x - pl.x) < 2.2 && Math.abs(z - pl.z) < 2.2)) continue; /* plot pads (3x3 slab, any yaw) stay bare */ const wg = wAt(x, z); if (wg < 0.6 || Rr() > wg) continue; const y = heightAt(x, z); if (y < SEA_Y + 0.02) continue; tCell[k] = Math.round((z + Rm) / step) * (segs + 1) + Math.round((x + Rm) / step);
    dm.position.set(x, y, z); const gs = 0.45 + Rr() * 0.55; dm.scale.set(gs * 1.6, gs * (0.6 + Rr() * 0.5), gs * 1.6); dm.rotation.set((Rr() - 0.5) * 0.25, Rr() * 6, (Rr() - 0.5) * 0.25); dm.updateMatrix(); tufts.setMatrixAt(k, dm.matrix); k++; }
  tufts.count = k; tufts.receiveShadow = true; tufts.userData.noAO = true; const grassMax = k; const grassBase = o.grass; root.add(tufts);
  const setSeason = (s: number) => { const t = SEASON_GRASS[((s % 4) + 4) % 4]; const R2 = rng('vtint' + plan.seed); for (let i = 0; i < grassMax; i++) { const j = 0.94 + R2() * 0.12; const c3 = tCell[i] * 3; tufts.setColorAt(i, col.setRGB(t[0] * j * (1 + (colr[c3] - 1) * 0.5), t[1] * j * (1 + (colr[c3 + 1] - 1) * 0.5), t[2] * j * (1 + (colr[c3 + 2] - 1) * 0.5))); } if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true; };
  setSeason(season0);
  const mats = [topMat, cliffMat]; const extra: THREE.BufferGeometry[] = [];
  return {
    group: root, top, heightAt,
    useGrass(geo, mat) { const g = geo.clone().scale(0.62, 1, 0.62); tufts.geometry = g; tufts.material = mat; extra.push(g); },
    setGrass(base) { tufts.count = Math.min(grassMax, Math.round(grassMax * (base / Math.max(1, grassBase)))); }, setSeason, update() { /* static ground */ },
    dispose() { root.removeFromParent(); root.traverse((nd) => { const m = nd as THREE.Mesh; if (m.geometry && nd !== tufts) m.geometry.dispose(); }); tufts.dispose(); extra.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); if (!o.grassGeometry) blade.dispose(); if (!o.grassMaterial) (grassMat as THREE.Material).dispose(); },
  };
}

/** TEMPORARY tuft: nine tapered blades (replaced by the authored grass clump through opts.grassGeometry). */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], colr: number[] = [], idx: number[] = [];
  for (let b = 0; b < 9; b++) {
    const ang = (b / 9) * TAU + b, ox = ((b % 3) - 1) * 0.03, oz = (Math.floor(b / 3) - 1) * 0.03, hgt = 0.2 + (b % 3) * 0.05, lean = ((b % 4) - 1.5) * 0.14; const base = pos.length / 3;
    for (let j = 0; j <= 2; j++) { const t = j / 2; const wdt = 0.016 * (1 - t); const y = t * hgt; const bend = t * t * lean; for (const s of [-1, 1]) { const lx = s * wdt, lz = bend; pos.push(ox + lx * Math.cos(ang) + lz * Math.sin(ang), y, oz - lx * Math.sin(ang) + lz * Math.cos(ang)); const c = 0.55 + t * 0.45; colr.push(0.5 * c, 0.68 * c, 0.34 * c); } }
    for (let j = 0; j < 2; j++) { const a = base + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
