import * as THREE from 'three';
import { fbm } from '../noise';
import { CLIFF, COL, FIXED, RIVER, TERRAIN, DETAIL, type SiteQuality } from './config';
import { along, polyDist, polyLen, smooth, spline, clamp } from './geo';
import { edgeAt, type SitePlan } from './plan';
import { makeHeight, type HeightFn } from './height';
import type { SiteMaterials } from './materials';
import { TEMENOS } from './config';
import { inPoly } from './geo';

export interface TerrainResult { top: THREE.Mesh; rim: THREE.Mesh; water: THREE.Mesh | null; heightAt: HeightFn; dispose(): void }

const C = { g1: new THREE.Color(COL.grass), g2: new THREE.Color(COL.grass2), g3: new THREE.Color(COL.grass3), dirt: new THREE.Color(COL.dirt), rim: new THREE.Color(COL.rim), sand: new THREE.Color(COL.sand), dust: new THREE.Color(0xc9bb94) };

/** Island top (terraces, hill, riverbed, bowl), cliff and underside, river water. Heights come from makeHeight(plan). */
export function buildTerrain(plan: SitePlan, M: SiteMaterials, quality: SiteQuality, height: HeightFn = makeHeight(plan)): TerrainResult {
  const Rm = Math.max(...plan.edge) + 0.6; const step = DETAIL[quality].terrainStep; const n = Math.ceil((Rm * 2) / step);
  const geo = new THREE.PlaneGeometry(Rm * 2, Rm * 2, n, n); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position; const col = new Float32Array(p.count * 3); const uv = geo.attributes.uv; const c = new THREE.Color();
  const S = FIXED.stadium;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i); const r = Math.hypot(x, z); const e = edgeAt(plan.edge, x, z) - 0.02; if (r > e) { x *= e / r; z *= e / r; }
    const h = height(x, z); p.setXYZ(i, x, h, z); uv.setXY(i, x * 0.35, z * 0.35);
    const nz = fbm(x * 0.35, 9, z * 0.35, 3); c.copy(C.g1).lerp(nz > 0 ? C.g2 : C.g3, Math.min(1, Math.abs(nz) * 2.2));
    const inside = inPoly({ x, z }, TEMENOS.poly); if (inside) c.lerp(C.dust, 0.9); else if (polyDist({ x, z }, TEMENOS.poly, true) < 2) c.lerp(C.dust, 0.25);
    if (h < 0.0) c.lerp(C.dirt, smooth(-h * 2.5)); if (h > 1.2) c.lerp(C.g3, smooth((h - 1.2) / 1.5) * 0.5);
    if (plan.tier >= S.tier && Math.abs(x - S.x) < S.wid / 2 + 0.05 && Math.abs(z - S.z) < S.len / 2 + 0.05) c.copy(C.sand);
    const rim = smooth((Math.hypot(x, z) - (e - 1.4)) / 1.4); c.lerp(C.dirt, rim * 0.4).multiplyScalar(1 - rim * 0.08);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  // layer weights for the shared splat shader (render/terrainShader.ts): grass, meadow, path/dust, sand, rock, mud
  { const n1 = n + 1; const w0 = new Float32Array(p.count * 4), w1 = new Float32Array(p.count * 2); const stepW = (2 * Rm) / n;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = p.getY(i); const hx = p.getY(Math.min(p.count - 1, i + 1)), hz = p.getY(Math.min(p.count - 1, i + n1)); const slope = Math.min(1, Math.hypot(hx - h, hz - h) / stepW * 1.2);
      const r = Math.hypot(x, z); const e = edgeAt(plan.edge, x, z) - 0.02; const rim = smooth((r - (e - 1.8)) / 1.6);
      const dust = inPoly({ x, z }, TEMENOS.poly) ? 0.9 : polyDist({ x, z }, TEMENOS.poly, true) < 2 ? 0.25 : 0;
      const stadium = plan.tier >= S.tier && Math.abs(x - S.x) < S.wid / 2 + 0.05 && Math.abs(z - S.z) < S.len / 2 + 0.05 ? 1 : 0;
      const nz = fbm(x * 0.3 + 5, 9, z * 0.3 + 5, 3);
      const path = dust, sand = stadium, mud = h < 0 ? smooth(-h * 2.5) * 0.9 : 0; let rock = Math.max(0, Math.min(1, Math.max((slope - 0.55) * 3.2, rim * rim * 0.5, h > 1.2 ? smooth((h - 1.2) / 1.5) * 0.35 : 0)));
      let meadow = Math.max(0, Math.min(1, nz * 2.2 + 0.1)) * 0.6; let g = 1; const keep = 1 - Math.max(path, mud * 0.8, sand);
      g *= keep; meadow *= keep; rock *= 1 - path * 0.6; g *= 1 - rock * 0.85; meadow *= 1 - rock * 0.85; g *= 1 - meadow * 0.9;
      const sum = g + meadow + path + sand + rock + mud || 1; w0[i * 4] = g / sum; w0[i * 4 + 1] = meadow / sum; w0[i * 4 + 2] = path / sum; w0[i * 4 + 3] = sand / sum; w1[i * 2] = rock / sum; w1[i * 2 + 1] = mud / sum;
    }
    geo.setAttribute('aW0', new THREE.BufferAttribute(w0, 4)); geo.setAttribute('aW1', new THREE.BufferAttribute(w1, 2)); }
  const top = new THREE.Mesh(geo, M.terrain); top.receiveShadow = true;

  // cliff + underside as one lathe-like skin around the coast (open at the top)
  const N = plan.edge.length; const depth = CLIFF.depth[plan.tier - 1] ?? 3, under = CLIFF.under[plan.tier - 1] ?? 8;
  const rings: readonly (readonly [number, number])[] = [[1.0, 0], [0.995, -0.2], [0.97, -depth * 0.5], [0.9, -depth], [0.75, -depth - under * 0.3], [0.45, -depth - under * 0.65], [0.0, -depth - under]];
  const rp: number[] = [], rc: number[] = [], ri: number[] = [];
  rings.forEach(([k, yy], r0) => {
    for (let j = 0; j < N; j++) {
      const a = -Math.PI + (j / N) * Math.PI * 2; const e = plan.edge[j] - 0.02; const w = fbm(Math.cos(a) * 3 + r0, r0 * 0.7, Math.sin(a) * 3, 3);
      const rr = k === 0 ? 0 : e * k * (1 + w * 0.12 * (r0 > 1 ? 1 : 0.3));
      rp.push(Math.cos(a) * rr, yy + (r0 > 0 && k > 0 ? w * 0.25 : 0), Math.sin(a) * rr);
      c.copy(C.rim).lerp(C.dirt, r0 === 0 ? 0.5 : 0.1 * r0).multiplyScalar(0.78 + w * 0.3 - r0 * 0.03); rc.push(c.r, c.g, c.b);
    }
  });
  for (let k = 0; k < rings.length - 1; k++) for (let j = 0; j < N; j++) { const a = k * N + j, b = k * N + ((j + 1) % N), d = (k + 1) * N + j, e2 = (k + 1) * N + ((j + 1) % N); ri.push(a, d, b, b, d, e2); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3)); rg.setIndex(ri); rg.computeVertexNormals();
  const uvs = new Float32Array((rp.length / 3) * 2); for (let i = 0; i < rp.length / 3; i++) { uvs[i * 2] = (i % N) / 6; uvs[i * 2 + 1] = rp[i * 3 + 1] * 0.3; } rg.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const rim = new THREE.Mesh(rg, M.rock); rim.castShadow = true;

  // rivers: ribbons trimmed at the coast, with a short fall over the edge
  let water: THREE.Mesh | null = null; const wp: number[] = []; const wi: number[] = []; const wy = -0.06;
  for (const rv of plan.rivers) {
    const all = spline(rv.pts, 8); const inside = (p: { x: number; z: number }) => Math.hypot(p.x, p.z) < edgeAt(plan.edge, p.x, p.z) - 0.15; const i0 = all.findIndex(inside); if (i0 < 0) continue; let i1 = i0; while (i1 + 1 < all.length && inside(all[i1 + 1])) i1++;
    const line = all.slice(i0, i1 + 1); if (line.length < 2) continue; const len = polyLen(line); const seg = Math.max(2, Math.ceil(len / 0.35)); const base = wp.length / 3;
    for (let i = 0; i <= seg; i++) { const a = along(line, (i / seg) * len); const nx = Math.cos(a.yaw), nz = -Math.sin(a.yaw); const hw = (rv.w / 2) * (0.92 + 0.08 * Math.sin(i * 0.9)); wp.push(a.x - nx * hw, wy, a.z - nz * hw, a.x + nx * hw, wy, a.z + nz * hw); }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; wi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (const end of [0, seg]) {
      const e = base + end * 2; const fx = (wp[e * 3] + wp[(e + 1) * 3]) / 2, fz = (wp[e * 3 + 2] + wp[(e + 1) * 3 + 2]) / 2; const o = wp.length / 3; const L = Math.hypot(fx, fz) || 1; const dx = fx / L, dz = fz / L;
      wp.push(wp[e * 3], wy, wp[e * 3 + 2], wp[(e + 1) * 3], wy, wp[(e + 1) * 3 + 2], wp[e * 3] + dx * 0.25, wy - 1.5, wp[e * 3 + 2] + dz * 0.25, wp[(e + 1) * 3] + dx * 0.25, wy - 1.5, wp[(e + 1) * 3 + 2] + dz * 0.25);
      wi.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  }
  if (wp.length) {
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals();
    const uvw = new Float32Array((wp.length / 3) * 2); for (let i = 0; i < wp.length / 3; i++) { uvw[i * 2] = wp[i * 3] * 0.5; uvw[i * 2 + 1] = wp[i * 3 + 2] * 0.5; } wg.setAttribute('uv', new THREE.BufferAttribute(uvw, 2));
    water = new THREE.Mesh(wg, M.water); water.renderOrder = 2;
  }
  void RIVER; void clamp; void TERRAIN;
  return { top, rim, water, heightAt: height, dispose: () => { geo.dispose(); rg.dispose(); water?.geometry.dispose(); } };
}
