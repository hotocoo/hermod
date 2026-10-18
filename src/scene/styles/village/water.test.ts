import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PLOT_IDS } from './config';
import { edgeAt, generateVillagePlan } from './plan';
import { fallbackTextureSet } from './tex';
import { buildVillageWater } from './water';

const plan = generateVillagePlan({ seed: 'ashgrove', tier: 5, levels: Object.fromEntries(PLOT_IDS.map((s) => [s, 3])), houses: Array.from({ length: 70 }, (_, i) => ({ user_id: 'u' + i, plot_index: i })) });
const tex = fallbackTextureSet(8);
const vw = buildVillageWater(plan, () => 0, tex);
const verts = (name: string) => { const m = vw.group.getObjectByName(name) as THREE.Mesh; const p = m.geometry.attributes.position; return Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i)); };

describe('village harbour fall', () => {
  it('has the channel polygon stop on the island, so no foam rectangle hangs over the rim', () => {
    for (const v of verts('water:inlet')) expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(edgeAt(plan.edge, v.x / Math.hypot(v.x, v.z), v.z / Math.hypot(v.x, v.z)) - 0.04 + 1e-6);
  });
  it('is as wide as the channel it spills from (half width 0.65 at the rim) and starts inland of the lip', () => {
    const { mouth, dir } = plan.inlet!; const nx = -dir.z, nz = dir.x; const f = verts('water:fall');
    const lateral = f.map((v) => Math.abs((v.x - mouth.x) * nx + (v.z - mouth.z) * nz)); expect(Math.max(...lateral)).toBeLessThan(1.0);
    const top = f[0]; expect(Math.hypot(top.x, top.z)).toBeLessThan(Math.hypot(mouth.x, mouth.z)); // first row sits on the channel surface before the rim
    expect(Math.max(...f.map((v) => v.y))).toBeLessThan(0.1); // nothing floats above the water level
  });
});
