import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { LIGHT_FX, LIGHT_TIERS } from '@/config/scene';
import { paneRects, tonePanes } from '../windowLights';

/** A thin closed glass box, centred at (x, y, z), as window glass assets are authored. */
const pane = (w: number, h: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, 0.04).translate(x, y, z);

describe('paneRects', () => {
  it('reduces a thin glass box to one outward facing rect with the pane extents', () => {
    const r = paneRects(pane(1, 1.2, 0, 1, 2));
    expect(r).toHaveLength(1);
    expect(r[0].n.z).toBeGreaterThan(0.99); // faces away from the asset pivot (origin), not back at it
    expect(r[0].w).toBeCloseTo(1, 2); expect(r[0].h).toBeCloseTo(1.2, 2);
    expect(r[0].c.x).toBeCloseTo(0, 2); expect(r[0].c.y).toBeCloseTo(1, 2); expect(r[0].c.z).toBeCloseTo(2.02, 2);
  });
  it('faces the right way for a pane on the other side of the pivot', () => {
    const r = paneRects(pane(1, 1, 0, 1, -2)); expect(r).toHaveLength(1); expect(r[0].n.z).toBeLessThan(-0.99);
  });
  it('merges coplanar muntin panes closer than mergeDist into one window', () => {
    const r = paneRects(mergeGeometries([pane(0.4, 1, -0.225, 1, 2), pane(0.4, 1, 0.225, 1, 2)])!);
    expect(r).toHaveLength(1); expect(r[0].w).toBeCloseTo(0.85, 2); expect(r[0].h).toBeCloseTo(1, 2);
  });
  it('keeps panes farther apart than mergeDist separate, largest first', () => {
    const gap = LIGHT_FX.rect.mergeDist * 3;
    const r = paneRects(mergeGeometries([pane(0.5, 0.5, 0, 1, 2), pane(1, 1, gap, 1, 2)])!);
    expect(r).toHaveLength(2); expect(r[0].w * r[0].h).toBeGreaterThan(r[1].w * r[1].h);
  });
  it('drops panes under minArea and returns nothing for empty geometry', () => {
    const s = Math.sqrt(LIGHT_FX.rect.minArea) * 0.5;
    expect(paneRects(pane(s, s, 0, 1, 2))).toHaveLength(0);
    expect(paneRects(new THREE.BufferGeometry())).toEqual([]);
  });
});

describe('tonePanes', () => {
  const win = (name: string) => { const m = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 0.72, 0.38) }); m.name = name; return m; };
  const scene = (...ms: THREE.Material[]) => { const s = new THREE.Scene(); ms.forEach((m) => s.add(new THREE.Mesh(new THREE.BoxGeometry(), m))); return s; };
  it('scales window emissive colours by the gain, keeps the hue, and leaves other materials alone', () => {
    const w = win('cottage_0_windows'), other = win('stone'); const base = new WeakMap<THREE.Material, THREE.Color>();
    tonePanes(scene(w, other), 0.8, base); expect(w.emissive.r).toBeCloseTo(0.8, 6); expect(w.emissive.g).toBeCloseTo(0.576, 6); expect(w.emissive.b).toBeCloseTo(0.304, 6); expect(other.emissive.r).toBe(1);
  });
  it('never compounds and restores the authored colour at gain 1', () => {
    const w = win('win'); const s = scene(w); const base = new WeakMap<THREE.Material, THREE.Color>();
    tonePanes(s, 0.8, base); tonePanes(s, 0.8, base); expect(w.emissive.r).toBeCloseTo(0.8, 6); tonePanes(s, 1, base); expect(w.emissive.r).toBeCloseTo(1, 6); expect(w.emissive.g).toBeCloseTo(0.72, 6);
  });
  it('tones the high pane down (no AO or fog there) and ultra not at all', () => {
    expect(LIGHT_TIERS.ultra.paneGain).toBe(1); for (const t of ['low', 'medium', 'high'] as const) { expect(LIGHT_TIERS[t].paneGain).toBeLessThan(1); expect(LIGHT_TIERS[t].paneGain).toBeGreaterThan(0.5); }
  });
});
