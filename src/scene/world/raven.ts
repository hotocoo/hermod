import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isMesh } from '../util';
import { fbm } from '../noise';
import type { Mats } from '../types';
import type { Textures } from './textures';
import { B, C } from './architecture';
import { tex } from './textures';


const KEEP = new Set(['position', 'normal', 'uv']);
/** Geometry copy (non-indexed, position/normal/uv only) with `m` baked in; winding is flipped when `m` mirrors. */
function bakeGeo(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone(); for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.applyMatrix4(m);
  if (m.determinant() < 0) for (const a of Object.values(g.attributes) as THREE.BufferAttribute[]) { const d = a.array as Float32Array, n = a.itemSize; for (let t = 0; t < a.count; t += 3) for (let k = 0; k < n; k++) { const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k, v = d[i1]; d[i1] = d[i2]; d[i2] = v; } }
  return g;
}
/** Collapse rigid `meshes` (all under `parent`) into one mesh per material, added to `parent`. A raven was ~110 draw calls; the rigid parts are now a handful. */
function mergeRigid(parent: THREE.Object3D, meshes: THREE.Mesh[]) {
  parent.updateWorldMatrix(true, true); const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert(); const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const me of meshes) { me.updateWorldMatrix(true, false); const g = bakeGeo(me.geometry, new THREE.Matrix4().multiplyMatrices(inv, me.matrixWorld)); const l = by.get(me.material as THREE.Material); if (l) l.push(g); else by.set(me.material as THREE.Material, [g]); me.removeFromParent(); }
  by.forEach((geos, mat) => { const out = mergeGeometries(geos, false); geos.forEach((g) => g.dispose()); if (out) parent.add(new THREE.Mesh(out, mat)); });
}

/** Procedural raven: sculpted body, feather cards, spread-able wings and a letter in its beak. */
export function createRaven(M: Mats, T: Textures) {
  const barbTex = tex((x, s) => { x.fillStyle = '#808080'; x.fillRect(0, 0, s, s); x.strokeStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 260; i++) { const y0 = (i / 260) * s; x.lineWidth = 1; x.beginPath(); x.moveTo(s / 2, y0); x.lineTo(s * 0.02, y0 - s * 0.08); x.moveTo(s / 2, y0); x.lineTo(s * 0.98, y0 - s * 0.08); x.stroke(); } x.fillStyle = 'rgba(255,255,255,.6)'; x.fillRect(s / 2 - 2, 0, 4, s); }, 256); barbTex.colorSpace = THREE.NoColorSpace;
  const plumage = new THREE.MeshPhysicalMaterial({ color: 0x141317, roughness: 0.42, metalness: 0.05, iridescence: 0.55, iridescenceIOR: 1.6, iridescenceThicknessRange: [250, 480], sheen: 0.4, sheenColor: new THREE.Color(0x30304a), sheenRoughness: 0.5, bumpMap: barbTex, bumpScale: 0.6 });
  const plumageSoft = plumage.clone(); plumageSoft.bumpMap = T.plasterB; plumageSoft.bumpScale = 0.35;
  const keratin = new THREE.MeshPhysicalMaterial({ color: 0x0d0c0e, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, clearcoat: 1 });
  function featherGeo(len: number, wid: number, curl: number) { const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(wid * 0.9, len * 0.12, wid * 1.0, len * 0.55, wid * 0.35, len * 0.97); s.quadraticCurveTo(0, len * 1.02, -wid * 0.25, len * 0.95); s.bezierCurveTo(-wid * 0.7, len * 0.6, -wid * 0.55, len * 0.15, 0, 0); const g = new THREE.ExtrudeGeometry(s, { depth: 0.0025, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 18 }); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / len; p.setZ(i, p.getZ(i) + Math.sin(y * Math.PI * 0.9) * curl * len - Math.abs(p.getX(i)) * 0.25); } g.computeVertexNormals(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / (wid * 2) + 0.5, p.getY(i) / len); return g; }
  function sculpt<G extends THREE.BufferGeometry>(geo: G, fn: (v: THREE.Vector3) => void): G { const p = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i), p.getZ(i)); fn(v); p.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals(); return geo; }
  const ravenParts = (() => {
    const body = sculpt(new THREE.SphereGeometry(1, 96, 64), (v) => { const z = v.z; const taper = z < 0 ? 1 - Math.pow(-z, 1.6) * 0.55 : 1 - Math.pow(z, 2.2) * 0.25; v.x *= 0.085 * taper; v.y *= 0.092 * taper * (v.y > 0 ? 0.92 : 1.08); v.z *= 0.2; v.y += -Math.pow(Math.max(0, z), 2) * 0.01; v.x += fbm(v.x * 40, v.y * 40, v.z * 40, 2) * 0.004; v.y += fbm(v.x * 40 + 3, v.y * 40, v.z * 40, 2) * 0.004; });
    const head = sculpt(new THREE.SphereGeometry(1, 80, 56), (v) => { v.x *= 0.05; v.y *= 0.052 * (v.y > 0 ? 0.92 : 1); v.z *= v.z > 0 ? 0.066 : 0.058; if (v.z > 0 && v.y > 0) v.y -= v.z * 0.12; });
    const neck = sculpt(new THREE.CylinderGeometry(1, 1, 1, 48, 12, true), (v) => { const t = v.y + 0.5; const r = 0.058 - t * 0.012 + Math.sin(t * Math.PI) * 0.006; v.x *= r; v.z *= r * 1.05; v.y *= 0.09; });
    const upper = sculpt(new THREE.ConeGeometry(1, 1, 48, 16), (v) => { const t = v.y + 0.5; v.x *= 0.018; v.z *= 0.026; v.y *= 0.115; const tt = 1 - t; v.z += tt * tt * 0.0; v.z -= Math.pow(1 - tt, 2) * 0.03 * 0; v.z += -Math.pow(t, 2.2) * 0.022; });
    upper.rotateX(Math.PI / 2);
    const lower = sculpt(new THREE.ConeGeometry(1, 1, 40, 12), (v) => { v.x *= 0.015; v.z *= 0.012; v.y *= 0.09; }); lower.rotateX(Math.PI / 2);
    const hackle = featherGeo(0.05, 0.008, 0.25), covert = featherGeo(0.07, 0.022, 0.12), secondary = featherGeo(0.14, 0.026, 0.1), primary = featherGeo(0.2, 0.022, 0.12), tailF = featherGeo(0.22, 0.03, 0.06), toe = sculpt(new THREE.CylinderGeometry(1, 1, 1, 14, 6), (v) => { const t = v.y + 0.5; const r = 0.005 * (1 - t * 0.4); v.x *= r; v.z *= r; v.y *= 0.04; }), claw = sculpt(new THREE.ConeGeometry(1, 1, 12, 4), (v) => { v.x *= 0.0035; v.z *= 0.0035; v.y *= 0.016; v.z += Math.pow(v.y / 0.016 + 0.5, 2) * 0.004; });
    return { body, head, neck, upper, lower, hackle, covert, secondary, primary, tailF, toe, claw };
  })();
  function raven(): THREE.Group { const P = ravenParts; const g = new THREE.Group(); const b = new THREE.Group(); g.add(b); b.rotation.x = -0.5;
    const body = new THREE.Mesh(P.body, plumageSoft); b.add(body);
    const neckG = new THREE.Group(); neckG.position.set(0, 0.05, 0.15); neckG.rotation.x = 0.55; b.add(neckG); const neck = new THREE.Mesh(P.neck, plumageSoft); neck.position.y = 0.04; neckG.add(neck);
    const headG = new THREE.Group(); headG.position.set(0, 0.095, 0.02); headG.rotation.x = -0.05; neckG.add(headG); const head = new THREE.Mesh(P.head, plumageSoft); headG.add(head);
    const up = new THREE.Mesh(P.upper, keratin); up.position.set(0, 0.006, 0.105); headG.add(up); const lo = new THREE.Mesh(P.lower, keratin); lo.position.set(0, -0.012, 0.095); lo.rotation.x = -0.06; headG.add(lo);
    for (let i = 0; i < 9; i++) { const n = new THREE.Mesh(P.hackle, plumage); const a = (i - 4) * 0.16; n.position.set(Math.sin(a) * 0.012, 0.012, 0.075); n.rotation.set(2.2, a * 0.6, 0); n.scale.setScalar(0.55); headG.add(n); }
    [-1, 1].forEach((s) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 24, 16), eyeMat); e.position.set(s * 0.038, 0.016, 0.03); headG.add(e); });
    for (let i = 0; i < 16; i++) { const f = new THREE.Mesh(P.hackle, plumage); const a = (i / 16) * Math.PI - Math.PI / 2; f.position.set(Math.sin(a) * 0.04, -0.03 - Math.random() * 0.01, -0.005 + Math.cos(a) * 0.02); f.rotation.set(-2.3, a * 0.4, 0); f.scale.setScalar(0.7); headG.add(f); }
    const wings = [-1, 1].map((s) => { const pv = new THREE.Group(); pv.position.set(s * 0.075, 0.035, 0.06); b.add(pv); const fe: { m: THREE.Mesh; geo: THREE.BufferGeometry; base: THREE.Euler; spread: THREE.Euler }[] = []; const rigid: THREE.Mesh[] = [];
      for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(P.covert, plumage); m.position.set(0, -i * 0.004, -i * 0.018); m.rotation.set(-Math.PI / 2 - 0.08, 0, -s * (0.1 + i * 0.02)); m.scale.set(s, 1, 1); pv.add(m); rigid.push(m); }
      for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(P.secondary, plumage); const base = new THREE.Euler(-Math.PI / 2 - 0.05 - i * 0.012, 0, -s * (0.04 + i * 0.012)); m.position.set(s * 0.004, -0.012 - i * 0.002, -0.02 - i * 0.012); m.rotation.copy(base); m.scale.set(s, 1, 1); pv.add(m); fe.push({ m, geo: P.secondary, base, spread: new THREE.Euler(-Math.PI / 2 + 0.25 - i * 0.04, 0, -s * (1.0 - i * 0.07)) }); }
      for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(P.primary, plumage); const base = new THREE.Euler(-Math.PI / 2 - 0.03 - i * 0.008, 0, -s * (0.02 + i * 0.01)); m.position.set(s * (0.006 + i * 0.0015), -0.016 - i * 0.002, -0.07 - i * 0.008); m.rotation.copy(base); m.scale.set(s, 1, 1); pv.add(m); fe.push({ m, geo: P.primary, base, spread: new THREE.Euler(-Math.PI / 2 + 0.4 - i * 0.07, 0, -s * (1.45 - i * 0.08)) }); }
      return { pv, s, fe, rigid }; });
    const tail = new THREE.Group(); tail.position.set(0, 0.0, -0.16); tail.rotation.x = -0.2; b.add(tail); for (let i = 0; i < 12; i++) { const a = (i - 5.5) * 0.045; const m = new THREE.Mesh(P.tailF, plumage); m.position.set(Math.sin(a) * 0.02, -Math.abs(i - 5.5) * 0.0015, 0); m.rotation.set(-Math.PI / 2 - 0.05, 0, a); tail.add(m); }
    const legs = new THREE.Group(); b.add(legs); [-1, 1].forEach((s) => { const lg = new THREE.Group(); lg.position.set(s * 0.028, -0.07, 0.02); lg.rotation.x = 0.5; const tar = C(0.0055, 0.0065, 0.085, keratin, 16, 0, -0.045, 0); lg.add(tar); const foot = new THREE.Group(); foot.position.y = -0.09; [-0.35, 0, 0.35].forEach((a) => { const t1 = new THREE.Mesh(P.toe, keratin); t1.rotation.set(Math.PI / 2 - 0.5, a, 0); t1.position.set(Math.sin(a) * 0.02, 0, Math.cos(a) * 0.02); foot.add(t1); const cl = new THREE.Mesh(P.claw, keratin); cl.position.set(Math.sin(a) * 0.042, -0.004, Math.cos(a) * 0.042); cl.rotation.set(Math.PI / 2 + 0.3, a, 0); foot.add(cl); }); const back = new THREE.Mesh(P.toe, keratin); back.rotation.set(-Math.PI / 2 + 0.4, 0, 0); back.position.set(0, 0, -0.018); foot.add(back); foot.rotation.x = -0.5; lg.add(foot); legs.add(lg); });
    const letter = (() => { const lg = new THREE.Group(); const env = B(0.075, 0.003, 0.05, M.trim, 0, 0, 0); lg.add(env); const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.003, 24), new THREE.MeshPhysicalMaterial({ color: 0x8a2a1e, roughness: 0.4, clearcoat: 0.5 })); seal.position.y = 0.003; lg.add(seal); lg.position.set(0, -0.02, 0.13); lg.rotation.x = 0.2; return lg; })(); headG.add(letter);
    // Draw calls: rigid parts merge per material, wing feathers become instanced meshes driven by setSpread.
    g.updateMatrixWorld(true);
    mergeRigid(headG, headG.children.filter(isMesh)); mergeRigid(tail, tail.children.filter(isMesh));
    { const lm: THREE.Mesh[] = []; legs.traverse((o) => { if (isMesh(o)) lm.push(o); }); mergeRigid(legs, lm); legs.children.filter((c) => !isMesh(c)).forEach((c) => legs.remove(c)); }
    const euler = new THREE.Euler(), quat = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), mat4 = new THREE.Matrix4();
    const wingInst = wings.map((w) => {
      mergeRigid(w.pv, w.rigid); const mir = new THREE.Matrix4().makeScale(w.s, 1, 1);
      return [...new Set(w.fe.map((f) => f.geo))].map((geo) => { const list = w.fe.filter((f) => f.geo === geo); const im = new THREE.InstancedMesh(bakeGeo(geo, mir), plumage, list.length); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; list.forEach((f) => f.m.removeFromParent()); w.pv.add(im); return { im, list }; });
    });
    function setSpread(k: number) { wingInst.forEach((groups) => groups.forEach(({ im, list }) => { list.forEach((f, n) => { euler.set(f.base.x + (f.spread.x - f.base.x) * k, f.base.y + (f.spread.y - f.base.y) * k, f.base.z + (f.spread.z - f.base.z) * k); mat4.compose(f.m.position, quat.setFromEuler(euler), one); im.setMatrixAt(n, mat4); }); im.instanceMatrix.needsUpdate = true; })); }
    setSpread(0);
    g.traverse((o) => { if (isMesh(o)) { o.castShadow = true; o.receiveShadow = true; } });
    g.userData = { wings, letter, legs, head: headG, body: b, neck: neckG, tail, setSpread };
    return g; }
  return { raven };
}
