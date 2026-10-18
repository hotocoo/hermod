import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createPuffs } from '../puffs';

const puff = (x: number, o: number) => { const m = new THREE.Object3D(); m.position.set(x, 1, 2); m.scale.setScalar(0.5); m.userData.o = o; return { m }; };

describe('createPuffs', () => {
  it('writes every puff into one instanced mesh with its opacity in instanceColor', () => {
    const p = createPuffs(new THREE.IcosahedronGeometry(1, 1), 4);
    p.sync([puff(1, 0.25)], [puff(2, 0.5)]);
    expect(p.mesh.count).toBe(2);
    const c = new THREE.Color(); p.mesh.getColorAt(1, c); expect(c.r).toBeCloseTo(0.5, 5);
    const m = new THREE.Matrix4(); p.mesh.getMatrixAt(0, m); expect(m.elements[12]).toBeCloseTo(1, 5);
  });
  it('caps at max and drops to zero when the lists empty', () => {
    const p = createPuffs(new THREE.IcosahedronGeometry(1, 1), 2);
    p.sync([puff(0, 1), puff(1, 1), puff(2, 1)]); expect(p.mesh.count).toBe(2);
    p.sync([], []); expect(p.mesh.count).toBe(0);
  });
});
