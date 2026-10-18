import * as THREE from 'three';
import { COL, NIGHT, TREES } from './config';
import type { HeightFn } from './height';
import { Parts, tint } from './kit';
import type { SiteMaterials } from './materials';
import type { SitePlan, SiteTree } from './plan';

const blob = (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
function treeGeo(kind: SiteTree['kind']): THREE.BufferGeometry {
  const P = new Parts(); const T = TREES;
  if (kind === 'olive') {
    const t = T.olive; P.cyl(0, 0, 0, 0.1, 0.06, t.h * 0.6, 7, COL.trunk).add(new THREE.CylinderGeometry(0.04, 0.05, 0.4, 5), 0.08, t.h * 0.55, 0, COL.trunk, 0, 1, 1, 1, 0.7);
    for (const [x, y, z, r, k] of [[0, t.h * 0.85, 0, t.crown, 1], [0.3, t.h * 0.7, 0.1, t.crown * 0.7, 0.9], [-0.28, t.h * 0.75, -0.1, t.crown * 0.65, 1.08], [0.05, t.h * 1.05, 0.12, t.crown * 0.55, 1.12]] as const) P.add(blob(r), x, y, z, tint(COL.olive, k), 0, 1, 0.72, 1);
  } else if (kind === 'plane') {
    const t = T.plane; P.cyl(0, 0, 0, 0.14, 0.09, t.h * 0.55, 8, COL.trunk);
    for (const [x, y, z, r, k] of [[0, t.h * 0.85, 0, t.crown, 1], [0.5, t.h * 0.7, 0.2, t.crown * 0.72, 0.9], [-0.45, t.h * 0.75, -0.2, t.crown * 0.7, 1.1], [0.0, t.h * 1.1, 0, t.crown * 0.6, 1.15]] as const) P.add(blob(r), x, y, z, tint(COL.plane, k), 0, 1, 0.85, 1);
  } else {
    const t = T.cypress; P.cyl(0, 0, 0, 0.05, 0.04, 0.3, 5, COL.trunk).add(new THREE.ConeGeometry(t.crown, t.h, 8, 1), 0, 0.3 + t.h / 2, 0, COL.cypress, 0, 1, 1, 1, 0, (y) => 0.8 + Math.min(1, y / t.h) * 0.3);
  }
  const g = P.build()!; return g;
}

export interface TreeSet { meshes: THREE.InstancedMesh[]; dispose(): void }
export function buildTrees(plan: SitePlan, M: SiteMaterials, h: HeightFn, density: number): TreeSet {
  const meshes: THREE.InstancedMesh[] = []; const dm = new THREE.Object3D();
  for (const kind of ['olive', 'plane', 'cypress'] as const) {
    const list = plan.trees.filter((t) => t.kind === kind); if (!list.length) continue;
    const keep = kind === 'olive' || kind === 'plane' ? list.filter((_, i) => (i % 100) / 100 < density) : list;
    const mesh = new THREE.InstancedMesh(treeGeo(kind), M.vcol, keep.length); mesh.castShadow = true; mesh.receiveShadow = true;
    keep.forEach((t, i) => { dm.position.set(t.x, h(t.x, t.z) - 0.03, t.z); dm.rotation.set(0, t.yaw, 0); dm.scale.setScalar(t.s); dm.updateMatrix(); mesh.setMatrixAt(i, dm.matrix); });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); meshes.push(mesh);
  }
  return { meshes, dispose: () => meshes.forEach((m) => { m.geometry.dispose(); m.dispose(); }) };
}

/** Flames (torches, altar fires, hearth brazier): one instanced teardrop, flickered per frame without allocation. */
export interface Flames { mesh: THREE.InstancedMesh; lights: THREE.PointLight[]; update(dt: number): void; setNight(n: number): void; dispose(): void }
export function buildFlames(spots: readonly { x: number; y: number; z: number; s: number }[], M: SiteMaterials, lightSpots: readonly { x: number; y: number; z: number; i: number }[]): Flames {
  const g = new THREE.LatheGeometry([[0, 0], [0.05, 0.02], [0.085, 0.08], [0.095, 0.15], [0.07, 0.23], [0.035, 0.31], [0, 0.4]].map(([x, y]) => new THREE.Vector2(x, y)), 10); // teardrop flame body
  const mesh = new THREE.InstancedMesh(g, M.flame, Math.max(1, spots.length)); mesh.frustumCulled = false; mesh.castShadow = false;
  const dm = new THREE.Object3D(); let t = 0; let night = 0;
  const lights = lightSpots.map((l) => { const pl = new THREE.PointLight(COL.flame, 0, NIGHT.lightDist, 1.6); pl.position.set(l.x, l.y, l.z); return pl; });
  const apply = () => {
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]; const f = 1 + Math.sin(t * 9 + i * 1.7) * 0.15 + Math.sin(t * 17 + i * 3.1) * 0.08;
      dm.position.set(s.x, s.y, s.z); dm.rotation.set(0, t * 2 + i, Math.sin(t * 6 + i) * 0.08); dm.scale.set(s.s * (0.7 + night * 0.4) * f, s.s * (0.55 + night * 0.65) * f, s.s * (0.7 + night * 0.4) * f); dm.updateMatrix(); mesh.setMatrixAt(i, dm.matrix);
    }
    mesh.count = spots.length; mesh.instanceMatrix.needsUpdate = true;
    lights.forEach((l, i) => { l.intensity = night * NIGHT.lightIntensity * lightSpots[i].i * (1 + Math.sin(t * 11 + i * 2) * NIGHT.flicker * 0.5); });
  };
  apply();
  return { mesh, lights, update(dt) { t += dt; apply(); }, setNight(n) { night = n; apply(); }, dispose() { g.dispose(); mesh.dispose(); lights.forEach((l) => l.dispose()); } };
}
