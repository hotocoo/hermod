import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '@/config/scene';
import type { Rng } from '../rng';
import type { Mats } from '../types';
import { B, C, lathe } from './architecture';

const keep = new Set(['position', 'normal', 'uv']);
type Piece = [mesh: THREE.Mesh, colour: THREE.ColorRepresentation, bone: number, parent?: THREE.Object3D];
/** Bake pieces (with their transforms, and their parent bone's pose) into one vertex-coloured geometry rigidly skinned to `bone`. */
function bake(parts: Piece[]): THREE.BufferGeometry {
  const m4 = new THREE.Matrix4();
  const geos = parts.map(([m, col, bone, parent]) => {
    m.updateMatrix(); parent?.updateMatrix(); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!keep.has(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count; if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.applyMatrix4(parent ? m4.multiplyMatrices(parent.matrix, m.matrix) : m.matrix); const c = new THREE.Color(col); const rgb = new Float32Array(n * 3); const si = new Uint16Array(n * 4); const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; si[i * 4] = bone; sw[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3)); g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); return g;
  });
  const out = mergeGeometries(geos, false)!; geos.forEach((g) => g.dispose()); return out;
}

/** Standing and seated villagers; limbs are exposed in userData for animation. One rigidly skinned, vertex-coloured mesh per figure (bones: body, 2 legs, 2 arms) on a shared material: 1 draw call instead of 11. */
export function createFigures(M: Mats) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  function person(R: Rng, i: number) { const g = new THREE.Group(); const cloth = i === 0 ? PALETTE.meTunic : PALETTE.cloth[Math.floor(R() * PALETTE.cloth.length)]; const pants = PALETTE.pants[Math.floor(R() * 3)]; const s = 0.55 + R() * 0.08;
    const skin = M.skin.color; const dummy = M.skin;
    const torso = lathe([[0.0, 0], [0.13, 0.0], [0.15, 0.08], [0.14, 0.2], [0.16, 0.3], [0.12, 0.36], [0.05, 0.4], [0, 0.4]], dummy, 32); torso.position.y = 0.44;
    const neck = C(0.035, 0.04, 0.06, dummy, 16, 0, 0.87, 0); const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 32, 24), dummy); head.scale.set(0.92, 1.08, 0.98); head.position.y = 0.98;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.09, 32, 16, 0, Math.PI * 2, 0, Math.PI * (0.45 + R() * 0.15)), dummy); const hairCol = PALETTE.hair[Math.floor(R() * 4)]; hair.position.y = 0.995; hair.rotation.x = -0.2;
    const body = new THREE.Bone(); const pieces: Piece[] = [[torso, cloth, 0], [neck, skin, 0], [head, skin, 0], [hair, hairCol, 0]];
    const legs = [-1, 1].map((sd) => { const pv = new THREE.Bone(); pv.position.set(sd * 0.065, 0.46, 0); const l = lathe([[0.055, 0], [0.05, -0.2], [0.04, -0.4], [0.045, -0.44], [0, -0.44]], dummy, 20); const shoe = B(0.08, 0.04, 0.14, dummy, 0, -0.44, 0.025); const k = 1 + (sd + 1) / 2; pieces.push([l, pants, k, pv], [shoe, M.ink.color, k, pv]); return pv; });
    const arms = [-1, 1].map((sd) => { const pv = new THREE.Bone(); pv.position.set(sd * 0.17, 0.78, 0); pv.rotation.z = sd * 0.08; const a = lathe([[0.04, 0], [0.035, -0.18], [0.03, -0.32], [0, -0.34]], dummy, 16); const hand = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), dummy); hand.position.y = -0.35; const k = 3 + (sd + 1) / 2; pieces.push([a, cloth, k, pv], [hand, skin, k, pv]); return pv; });
    const bones = [body, ...legs, ...arms]; bones.forEach((b) => g.add(b));
    const sm = new THREE.SkinnedMesh(bake(pieces), mat); sm.castShadow = sm.receiveShadow = true; g.add(sm); g.updateMatrixWorld(true); sm.bind(new THREE.Skeleton(bones));
    g.scale.setScalar(s); g.userData.legs = legs; g.userData.arms = arms; return g; }
  function seated(R: Rng, i: number) { const g = person(R, i); g.userData.legs.forEach((l: THREE.Object3D) => { l.rotation.x = -1.45; l.position.y = 0.42; }); g.position.y = -0.18; return g; }
  return { person, seated };
}
