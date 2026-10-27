import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dropMips } from '../site/landmarks/assets';

/** Mip chain of a square compressed texture, top level `size` px down to 1 px. */
const chain = (size: number) => { const out: { data: Uint8Array; width: number; height: number }[] = []; for (let s = size; s >= 1; s >>= 1) out.push({ data: new Uint8Array(1), width: s, height: s }); return out; };
const TOP = 1024;

const meshWith = (t: THREE.Texture) => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: t, normalMap: t }));
const tex = (size: number) => { const t = new THREE.CompressedTexture(chain(size) as never, size, size); return t; };

describe('dropMips', () => {
  it('halves resolution per dropped level and updates the image size', () => {
    const t = tex(TOP); dropMips(meshWith(t), 2);
    expect(t.mipmaps[0].width).toBe(TOP / 4);
    expect((t.image as { width: number }).width).toBe(TOP / 4);
  });
  it('drops a texture shared by two slots only once', () => {
    const t = tex(TOP); const g = new THREE.Group(); g.add(meshWith(t), meshWith(t)); dropMips(g, 1);
    expect(t.mipmaps[0].width).toBe(TOP / 2);
  });
  it('always keeps one level and leaves textures alone at 0', () => {
    const tiny = tex(2); dropMips(meshWith(tiny), 5); expect(tiny.mipmaps).toHaveLength(1);
    const t = tex(TOP); dropMips(meshWith(t), 0); expect(t.mipmaps[0].width).toBe(TOP);
  });
});
