/**
 * Village water: pond, harbour lagoon and mill pond as organic polygon surfaces with a shore fade and foam band (vertex alpha and colour),
 * the stream as a ribbon. One MeshPhysicalMaterial (lit by the same stack as everything else); `update(t)` scrolls the flow normal map.
 * Water sits at SEA_Y; terrain.ts carves the beds below it.
 */
import * as THREE from 'three';
import { GROWTH } from '@/config/scene';
import { fbm } from '../../noise';
import type { V2 } from './config';
import { edgeAt, type VillagePlan } from './plan';
import { SEA_Y, undersideRadius, type HeightFn } from './terrain';
import { gpuOnly, type TerrainTextureSet } from './tex';

/**
 * The harbour fall: strands of water that stretch as they accelerate, thin dark-teal gaps between them (the rock shows through), foam streaks, a white lip and a soft
 * churn at the end. uv.x runs -1..1 across the sheet and uv.y 0..3 down it. Plain MeshStandardMaterial (sun, sky, fog and night dimming through `color`); the water
 * shader of waterFx is not applied (town.ts skips ':fall'): its Gerstner normals and shore foam are for flat surfaces and turned this sheet into a white slab.
 */
function fallMaterial(nrm: THREE.Texture, uT: { value: number }, uLip: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0, envMapIntensity: 0.3, transparent: true, vertexColors: true, normalMap: nrm, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFallT = uT; sh.uniforms.uLipY = uLip;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFallUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFallUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vFallUv; uniform float uFallT; uniform float uLipY;
float fH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(fH(i), fH(i + vec2(1.0, 0.0)), f.x), mix(fH(i + vec2(0.0, 1.0)), fH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float y = pow(vFallUv.y, 1.25); float x = vFallUv.x;
  float s1 = fN(vec2(x * 9.0, y * 1.1 - uFallT * 2.4)); float s2 = fN(vec2(x * 24.0 + 7.0, y * 0.6 - uFallT * 3.6)); float s3 = fN(vec2(x * 4.0 + 3.0, y * 2.3 - uFallT * 1.5));
  float s = s1 * 0.5 + s2 * 0.3 + s3 * 0.2; float thick = smoothstep(0.28, 0.72, s);
  float lipF = (1.0 - smoothstep(0.0, 0.17, abs(vFallUv.y - uLipY))) * (0.35 + 0.65 * smoothstep(0.3, 0.7, fN(vec2(x * 13.0, 2.0 - uFallT * 1.1)))); float lead = smoothstep(0.0, uLipY * 0.8, vFallUv.y);
  float foam = clamp(smoothstep(0.66, 0.9, s1 * 0.6 + s2 * 0.5) * 0.85 * lead + lipF * 0.6 + smoothstep(1.7, 2.6, vFallUv.y) * 0.45, 0.0, 1.0);
  vec3 body = mix(vec3(0.20, 0.46, 0.54), vec3(0.62, 0.82, 0.88), thick); body = mix(body, vec3(0.95, 0.98, 0.98), foam);
  diffuseColor.rgb *= body; diffuseColor.a *= clamp(mix(0.28, 0.92, thick) + foam * 0.5, 0.0, 1.0);
}`);
  };
  m.customProgramCacheKey = () => 'village-fall2'; return m;
}

const smooth01 = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const RINGS = [0, 0.5, 0.78, 0.93, 1.0, 1.1];
/** Half width of the falling sheet: the inlet channel (plan.ts) tapers to a half width of 0.65 at the rim, so the sheet is that plus a hair and spreads a little as it falls. */
const FALL_HALF = 0.7;
export interface VillageWater { group: THREE.Group; update(t: number, night: number): void; dispose(): void }
export function buildVillageWater(plan: VillagePlan, _h: HeightFn, tex: TerrainTextureSet): VillageWater {
  const group = new THREE.Group(); group.name = 'village:water';
  // a clone per use (own repeat and scroll); `let` because the KTX2 water normal replaces the placeholder after load (tex.onMaps)
  const cloneN = (rx: number, ry: number) => { const c = tex.waterNormal.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry); c.needsUpdate = true; return (c as THREE.CompressedTexture).isCompressedTexture ? gpuOnly(c as THREE.CompressedTexture) : c; };
  let nrm = cloneN(0.4, 0.4);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0, ior: 1.33, transparent: true, vertexColors: true, normalMap: nrm, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 0.35, specularIntensity: 0.5, depthWrite: false, side: THREE.DoubleSide, clearcoat: 0.3, clearcoatRoughness: 0.1 });
  const deep = new THREE.Color(0x1f5568), shallow = new THREE.Color(0x4f8f90), foam = new THREE.Color(0xf4f7f2); const c = new THREE.Color();
  const geos: THREE.BufferGeometry[] = [];
  for (const w of plan.waters) {
    const n = w.poly.length; const cx = w.poly.reduce((s, p) => s + p.x, 0) / n, cz = w.poly.reduce((s, p) => s + p.z, 0) / n;
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [], dep: number[] = [];
    const rings = RINGS.length; pos.push(cx, SEA_Y, cz); c.copy(deep); col.push(c.r, c.g, c.b, 0.94); uv.push(cx * 0.3, cz * 0.3); dep.push(2.4);
    for (let r = 1; r < rings; r++) for (let i = 0; i < n; i++) {
      const k = RINGS[r]; let x = cx + (w.poly[i].x - cx) * k, z = cz + (w.poly[i].z - cz) * k;
      if (w.id === 'inlet') { const q = Math.hypot(x, z) || 1; const lim = edgeAt(plan.edge, x / q, z / q) - 0.05; if (q > lim) { x *= lim / q; z *= lim / q; } } // the channel polygon runs past the rim (and the shore ring grows it further): hold it on the island, or its foam border hangs in the air as a flat rectangle where the fall starts
      const sh = (k - 0.5) / 0.6; // 0 deep .. 1 shore
      c.copy(deep).lerp(shallow, Math.max(0, Math.min(1, sh))).lerp(foam, Math.max(0, (k - 0.9) / 0.1) * 0.55); const a = k < 1.0 ? 0.94 : 0.94 * Math.max(0, 1 - (k - 1.0) / 0.1);
      pos.push(x, SEA_Y, z); col.push(c.r, c.g, c.b, a); uv.push(x * 0.3, z * 0.3); dep.push(Math.max(0, 1 - Math.max(0, k - 0.45) / 0.6) * 2.4);
    }
    for (let i = 0; i < n; i++) idx.push(0, 1 + ((i + 1) % n), 1 + i);
    for (let r = 1; r < rings - 1; r++) for (let i = 0; i < n; i++) { const a = 1 + (r - 1) * n + i, b = 1 + (r - 1) * n + ((i + 1) % n), d = a + n, e = b + n; idx.push(a, b, d, b, e, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1)); g.setIndex(idx); g.computeVertexNormals(); geos.push(g);
    const m = new THREE.Mesh(g, mat); m.name = 'water:' + w.id; m.renderOrder = 2; group.add(m);
  }
  if (plan.stream && plan.stream.pts.length > 1) {
    const pts: V2[] = plan.stream.pts; const hw = plan.stream.w / 2 + 0.12; const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [], sdep: number[] = []; let acc = 0;
    pts.forEach((q, i) => { if (i) acc += Math.hypot(q.x - pts[i - 1].x, q.z - pts[i - 1].z); const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; const nx = -dz / l, nz = dx / l; const y = SEA_Y + 0.02;
      [[-hw, 0], [-hw * 0.55, 1], [hw * 0.55, 1], [hw, 0]].forEach(([o, al], k) => { c.copy(k === 0 || k === 3 ? foam : shallow); pos.push(q.x + nx * o, y, q.z + nz * o); col.push(c.r, c.g, c.b, al * 0.9); uv.push(k < 2 ? 0 : 1, acc * 0.5); sdep.push(al * 0.35); }); });
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 3; k++) { const a = i * 4 + k; idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aDepth', new THREE.Float32BufferAttribute(sdep, 1)); g.setIndex(idx); g.computeVertexNormals(); geos.push(g);
    const m = new THREE.Mesh(g, mat); m.name = 'water:stream'; m.renderOrder = 2; group.add(m);
  }
  // harbour inlet spills over the island rim: a falling sheet (the island floats, there is no sea below)
  let fallMat: THREE.MeshStandardMaterial | null = null; const fallT = { value: 0 }; const fallLipY = { value: 0.2 }; let fnrm: THREE.Texture | null = null;
  let mist: { pts: THREE.Points; base: Float32Array; geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial; dir: V2 } | null = null;
  if (plan.inlet) {
    const { mouth, dir } = plan.inlet; const depth = GROWTH.cliffDepth[plan.tier - 1] ?? GROWTH.cliffDepth[0]; const H = depth + 1.6; const nx = -dir.z, nz = dir.x; const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []; const S = 10; const under = GROWTH.underDepth[plan.tier - 1] ?? GROWTH.underDepth[0];
    // radius of the terrain.ts cliff wall (taper 1 -> 0.82 over `depth`, same fbm bulge) at world height yw, so the sheet clings to the rock instead of hanging in air
    const wall = (a: number, yw: number): number => { const e = edgeAt(plan.edge, Math.cos(a), Math.sin(a)); if (yw < -depth) return undersideRadius(a, (-depth - yw) / under, e, depth, under, plan.R) + 0.1; const ly = Math.max(-depth, yw) + depth / 2; const taper = 0.82 + (0.18 * (ly + depth / 2)) / depth; return e * taper * (1 + fbm(Math.cos(a) * 3, ly * 0.9, Math.sin(a) * 3, 4) * 0.08 * (0.4 + (1.3 - ly) * 0.3)); };
    // the sheet starts on the channel surface (LEAD long, same width as the channel), rolls over a rounded lip of radius BEND that ends exactly at the rim and only then drops down the wall: no flat plate poking out past the rim
    const LEAD = 0.5, BEND = 0.25, NTOP = 12, NV = 48, V = NTOP + NV, ARC = (Math.PI * BEND) / 2, TOP = LEAD + ARC, YB = SEA_Y + 0.03 - BEND;
    const rows: { yw: number; off: number; v: number; al: number; s: number }[] = [];
    for (let k = 0; k <= NTOP; k++) { const a = (k / NTOP) * TOP; const al = a <= LEAD ? 0 : 0.9 * Math.pow((a - LEAD) / ARC, 1.2); // invisible lead-in: the channel surface itself runs to the lip, the sheet shows only from the bend
      if (a <= LEAD) rows.push({ yw: SEA_Y + 0.03, off: a - LEAD - BEND, v: 0, al, s: a }); else { const th = (a - LEAD) / BEND; rows.push({ yw: SEA_Y + 0.03 - BEND * (1 - Math.cos(th)), off: BEND * (Math.sin(th) - 1), v: 0, al, s: a }); } }
    for (let j = 1; j <= NV; j++) { const v = j / NV; rows.push({ yw: YB - v * (H - BEND), off: 0, v, al: -1, s: TOP + v * (H - BEND) }); }
    const total = TOP + H - BEND; const FALL_LIP_Y = ((LEAD + ARC / 2) / total) * 3; fallLipY.value = FALL_LIP_Y;
    for (let j = 0; j <= V; j++) for (let i = 0; i <= S; i++) {
      const r = rows[j]; const v = r.v; const u = i / S - 0.5; const w = FALL_HALF * (1 + Math.min(v * 3, 1) * 0.3); const px = mouth.x + nx * u * 2 * w, pz = mouth.z + nz * u * 2 * w; const a = Math.atan2(pz, px);
      const vert = j > NTOP ? 0.1 * Math.sin(v * 9 + u * 7) * v + Math.max(0, v - 0.86) * 1.2 : 0; // lifts off the wall at the very end
      const rr = wall(a, j > NTOP ? r.yw : SEA_Y) + 0.12 + r.off + vert;
      pos.push(Math.cos(a) * rr, r.yw, Math.sin(a) * rr); uv.push(u * 2, (r.s / total) * 3);
      const end = 1 - smooth01((v - 0.62) / 0.38); const side = 1 - smooth01((Math.abs(u) * 2 - 0.35) / 0.65); col.push(1, 1, 1, (r.al >= 0 ? r.al : (v < 0.04 ? 0.9 : 0.8 * (1 - v * 0.35)) * end) * side); // soft sides and a long fade-out at the end
    }
    for (let j = 0; j < V; j++) for (let i = 0; i < S; i++) { const a = j * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1; idx.push(a, c, b, b, c, d, a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals(); geos.push(g);
    fnrm = cloneN(1, 2);
    fallMat = fallMaterial(fnrm, fallT, fallLipY);
    const m = new THREE.Mesh(g, fallMat); m.name = 'water:fall'; m.renderOrder = 3; group.add(m);
    // spray: soft billboards rising and drifting from the lip and (mostly) from where the sheet dissolves
    const N = 90; const base = new Float32Array(N * 4); const a0 = Math.atan2(mouth.z, mouth.x);
    for (let k = 0; k < N; k++) { const lip = k < 18; const v = lip ? 0.01 : 0.86 + (k % 7) * 0.02; const yy = SEA_Y - v * H; const rr = wall(a0, yy) + 0.25 + (k % 5) * 0.08; const off = ((k * 0.37) % 1 - 0.5) * FALL_HALF * 1.7; base[k * 4] = Math.cos(a0) * rr + nx * off; base[k * 4 + 1] = yy; base[k * 4 + 2] = Math.sin(a0) * rr + nz * off; base[k * 4 + 3] = (k * 0.6180339) % 1; }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); mg.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(N), 1)); mg.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(N), 1)); geos.push(mg);
    const mm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTint: { value: new THREE.Color(0xf2f7f8) } },
      vertexShader: 'attribute float aA; attribute float aS; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aS * 40.0 / max(-mv.z, 0.5) * 34.0; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uTint; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.0, 1.0, d)); gl_FragColor = vec4(uTint, a * a * vA); }' });
    mist = { pts: new THREE.Points(mg, mm), base, geo: mg, mat: mm, dir: { x: dir.x, z: dir.z } }; mist.pts.name = 'water:mist'; mist.pts.renderOrder = 4; mist.pts.frustumCulled = false; group.add(mist.pts);
  }
  tex.onMaps.push((k) => { if (k !== 'water') return; nrm.dispose(); nrm = cloneN(0.4, 0.4); mat.normalMap = nrm; mat.needsUpdate = true; if (fnrm && fallMat) { fnrm.dispose(); fnrm = cloneN(1, 2); fallMat.normalMap = fnrm; fallMat.needsUpdate = true; } });
  return {
    group,
    update(t, night) { nrm.offset.set(t * 0.012, t * 0.007); mat.color.setScalar(1 - night * 0.55); if (fnrm && fallMat) { fallT.value = t; fnrm.offset.y = -t * 0.9; fallMat.color.setScalar(1 - night * 0.5); }
      if (mist) { const P = mist.geo.attributes.position as THREE.BufferAttribute, A = mist.geo.attributes.aA as THREE.BufferAttribute, Z = mist.geo.attributes.aS as THREE.BufferAttribute; const b = mist.base;
        for (let k = 0; k < P.count; k++) { const lip = k < 18; const ph = (t * (lip ? 0.35 : 0.2) + b[k * 4 + 3]) % 1; const sw = Math.sin(t * 1.3 + k) * 0.1; P.setXYZ(k, b[k * 4] + mist.dir.x * ph * (lip ? 0.6 : 1.4) + sw, b[k * 4 + 1] + ph * (lip ? 0.5 : 1.8), b[k * 4 + 2] + mist.dir.z * ph * (lip ? 0.6 : 1.4) + sw); A.setX(k, Math.sin(ph * Math.PI) * (lip ? 0.1 : 0.26) * (1 - night * 0.55)); Z.setX(k, (lip ? 0.3 : 0.55) + ph * 0.7); }
        P.needsUpdate = A.needsUpdate = Z.needsUpdate = true; } },
    dispose() { group.removeFromParent(); geos.forEach((g) => g.dispose()); mat.dispose(); nrm.dispose(); fallMat?.dispose(); fnrm?.dispose(); mist?.mat.dispose(); },
  };
}
