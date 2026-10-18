import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PathTracingSceneGenerator } from 'three-gpu-pathtracer';
import { buildTraceScene, resetMergeGroups } from '../traceScene';

/** A scene of `n` distinct boxes, each with its own material, like the village trace set. */
function sceneOf(n: number, size: number): THREE.Scene {
  const s = new THREE.Scene();
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / n, 0.6, 0.5) })); m.position.set(i, 0, 0); s.add(m); }
  s.updateMatrixWorld(true); return s;
}
const gen = () => { const g = new PathTracingSceneGenerator(); g.generateBVH = false; return g; };

describe('path tracer rebuild', () => {
  it('first build: one group per mesh, every triangle mapped to its own material index', () => {
    const g = gen(); g.setObjects(sceneOf(5, 1)); const r = g.generate();
    expect(g.geometry.groups).toHaveLength(5); expect(r.materials).toHaveLength(5);
    const idx = g.geometry.attributes.materialIndex.array as Uint8Array; expect(new Set(idx).size).toBe(5);
  });

  it('library canary: a rebuild without reset keeps the previous build\'s groups (drop resetMergeGroups when this fails)', () => {
    const g = gen(); g.setObjects(sceneOf(5, 1)); g.generate(); g.setObjects(sceneOf(5, 1)); g.generate();
    expect(g.geometry.groups.length).toBe(10);
  });

  it('resetMergeGroups: a rebuild with new meshes carries exactly its own groups, whatever the build count', () => {
    const g = gen(); const pt = { _generator: g };
    for (let build = 0; build < 4; build++) {
      resetMergeGroups(pt); g.setObjects(sceneOf(5 + build, 1 + build * 0.1)); const r = g.generate();
      expect(g.geometry.groups).toHaveLength(5 + build); expect(r.materials).toHaveLength(5 + build);
      const idx = g.geometry.attributes.materialIndex.array as Uint8Array; expect(new Set(idx).size).toBe(5 + build);
      // every group's triangles carry the material index of its own mesh: group i -> material i (generation order is uuid sorted, groups follow it)
      g.geometry.groups.forEach((grp, i) => { const ix = g.geometry.index!; for (const k of [grp.start, grp.start + grp.count - 1]) expect(idx[ix.getX(k)]).toBe(i); });
    }
  });

  it('resetMergeGroups tolerates a library without the private field', () => { expect(() => resetMergeGroups({})).not.toThrow(); });

  it('multi-material mesh: every triangle traces with its own material, wherever the mesh sorts', () => {
    const colors: number[] = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0x888888];
    for (let run = 0; run < 12; run++) { // uuids are random per run, which is what made the old failure intermittent
      const s = new THREE.Scene(); const want = new Map<number, number>(); // box centre x -> colour
      for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: colors[i] })); m.position.set(i * 3, 0, 0); s.add(m); want.set(i * 3, colors[i]); }
      const two = new THREE.BoxGeometry(1, 1, 1); two.clearGroups(); two.addGroup(0, 18, 0); two.addGroup(18, 18, 1); // lower half of the index range red-ish, upper half green-ish: x = 20 box, y split by index range not position
      const mm = new THREE.Mesh(two, [new THREE.MeshStandardMaterial({ color: colors[5] }), new THREE.MeshStandardMaterial({ color: colors[6] })]); mm.position.set(20, 0, 0); s.add(mm);
      s.updateMatrixWorld(true); const ts = buildTraceScene(s);
      const g = gen(); g.setObjects(ts.scene); const r = g.generate(); const idx = g.geometry.attributes.materialIndex.array as Uint8Array; const ix = g.geometry.index!; const pos = g.geometry.attributes.position;
      expect(g.geometry.groups).toHaveLength(r.materials.length);
      for (let t = 0; t < ix.count / 3; t++) {
        const v = ix.getX(t * 3); const cx = Math.round(pos.getX(v) / 3) * 3; const mat = r.materials[idx[v]] as THREE.MeshStandardMaterial;
        if (cx === 21 || cx === 18 || cx === 20 || cx === 19) { expect([colors[5], colors[6]]).toContain(mat.color.getHex()); } else expect(mat.color.getHex()).toBe(want.get(cx));
      }
      // the two groups of the array-material box carry both of its colours
      const used = new Set<number>(); for (let t = 0; t < ix.count / 3; t++) { const v = ix.getX(t * 3); if (pos.getX(v) > 19) used.add((r.materials[idx[v]] as THREE.MeshStandardMaterial).color.getHex()); }
      expect([...used].sort()).toEqual([colors[5], colors[6]].sort());
    }
  });
});
