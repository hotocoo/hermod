import { describe, expect, it } from 'vitest';

type Tag = (name: string, mat: unknown, cat: string, id?: string) => Record<string, number | string> | null;
const load = async () => ((await import('../../../scripts/assets/material-tags.mjs')) as { tag: Tag }).tag;

describe('material tag pass', () => {
  it('gives bottle glass real transmission, IOR and volume', async () => {
    const tag = await load();
    expect(tag('Glass_Bottle', { pbrMetallicRoughness: { metallicFactor: 0 } }, 'decor')).toMatchObject({ transmission: 1, ior: 1.5, thickness: expect.any(Number) });
  });
  it('varnishes wood furniture but not fabric, and sheens fabric', async () => {
    const tag = await load();
    expect(tag('oak_wood', {}, 'table')).toMatchObject({ clearcoat: expect.any(Number) });
    const sofa = tag('wool_fabric', {}, 'seating'); expect(sofa).toMatchObject({ sheen: expect.any(Number) }); expect(sofa).not.toHaveProperty('clearcoat');
  });
  it('never overrides an authored glTF extension', async () => {
    const tag = await load();
    expect(tag('glass', { extensions: { KHR_materials_transmission: { transmissionFactor: 0.6 } } }, 'decor')).toBeNull();
  });
  it('flags relief stone for parallax and leaves pine alone', async () => {
    const tag = await load();
    expect(tag('rock_a', {}, 'nature')).toMatchObject({ pom: 1 });
    expect(tag('stonepine_bark', {}, 'nature')).toBeNull();
  });
});
