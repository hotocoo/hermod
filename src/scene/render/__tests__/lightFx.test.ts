import { describe, expect, it } from 'vitest';
import { LIGHT_FX, LIGHT_TIERS, QUALITY, type QualityTier } from '@/config/scene';
import * as THREE from 'three';
import { applyShadowTier, iesTexture, installRectChunk, installShadowChunks } from '../lightFx';

describe('lightFx', () => {
  it('bakes the lantern web: peak at the axis, falls off outward, black outside the cone', () => {
    const t = iesTexture('lantern'); const n = LIGHT_FX.ies.lantern.size; const d = t.image.data as Uint8Array;
    const at = (x: number, y: number) => d[(y * n + x) * 4];
    const c = n >> 1; expect(at(c, c)).toBeGreaterThan(240);
    expect(at(c + n / 4, c)).toBeLessThan(at(c, c)); expect(at(c + n / 2 - 1, c)).toBeLessThan(at(c + n / 4, c)); expect(at(0, 0)).toBe(0);
  });
  it('patches the BASIC shadow chunk with PCSS once', () => {
    expect(installShadowChunks()).toBe(true); expect(installShadowChunks()).toBe(true);
  });
  it('adds the cull and far field LOD to the rect area shading once, ahead of the LTC integrals', () => {
    expect(installRectChunk()).toBe(true); expect(installRectChunk()).toBe(true);
    const c = THREE.ShaderChunk.lights_physical_pars_fragment; const fn = c.slice(c.indexOf('void RE_Direct_RectArea_Physical'));
    expect(fn.split('d2r >').length).toBe(3); // cull and far field, once each
    const cull = fn.indexOf(`d2r > ${(LIGHT_FX.rect.cullRange ** 2).toFixed(3)}`); const far = fn.indexOf(`d2r > ${(LIGHT_FX.rect.farRange ** 2).toFixed(3)}`);
    expect(cull).toBeGreaterThan(-1); expect(far).toBeGreaterThan(cull); expect(far).toBeLessThan(fn.indexOf('LTC_Evaluate'));
  });
  it('culls a pane only where its point source irradiance is negligible', () => {
    const R = LIGHT_FX.rect; expect(R.cullRange).toBeGreaterThan(R.farRange);
    const bigPane = 0.5; // world units squared (2 m x 4 m x ... a shop window is well under this)
    const e = (R.gain * bigPane) / (Math.PI * R.cullRange ** 2); // L A / (pi d^2) with L = gain at full winIntensity
    expect(e).toBeLessThan(0.005);
  });
  it('PCSS early-outs: every blocker tap blocked is umbra, and the search disc is wider than the largest penumbra on every PCSS tier', () => {
    expect(installShadowChunks()).toBe(true);
    const c = THREE.ShaderChunk.shadowmap_pars_fragment; expect(c).toContain('nb >= float( nbT )'); expect(c).toContain('shadow = 0.0; // every search tap blocked');
    for (const t of Object.keys(LIGHT_TIERS) as QualityTier[]) if (LIGHT_TIERS[t].pcss) expect(QUALITY[t].shadowRadius * LIGHT_FX.pcss.search, t).toBeGreaterThanOrEqual(LIGHT_FX.pcss.maxUv);
  });
  it('keeps PCSS, the rect pool and the round 1 froxel grid on ultra: at least what high has', () => {
    expect(LIGHT_TIERS.ultra.pcss).toBe(true); expect(LIGHT_TIERS.ultra.rectLights).toBeGreaterThanOrEqual(LIGHT_TIERS.high.rectLights);
    expect(LIGHT_FX.froxel.grid[0] * LIGHT_FX.froxel.grid[1] * LIGHT_FX.froxel.grid[2]).toBeGreaterThanOrEqual(160 * 90 * 64);
  });
  it('caps features per tier: nothing below high, froxel only on ultra', () => {
    expect(LIGHT_TIERS.low.rectLights + LIGHT_TIERS.medium.rectLights).toBe(0);
    expect(LIGHT_TIERS.high.froxel).toBe(false); expect(LIGHT_TIERS.ultra.froxel).toBe(true); expect(LIGHT_TIERS.high.rectLights).toBeGreaterThan(0); expect(LIGHT_TIERS.ultra.rectLights).toBeGreaterThanOrEqual(LIGHT_TIERS.high.rectLights);
  });
});

describe('applyShadowTier', () => {
  /** Minimal renderer: only the shadow map state the function touches. */
  const fakeRenderer = (type: THREE.ShadowMapType) => ({ shadowMap: { type, needsUpdate: false } }) as unknown as THREE.WebGLRenderer;
  const build = () => {
    const scene = new THREE.Scene(); const basic = new THREE.MeshBasicMaterial(); const std = new THREE.MeshStandardMaterial(); const a = new THREE.MeshLambertMaterial(); const b = new THREE.MeshPhongMaterial();
    const decal = new THREE.InstancedMesh(new THREE.PlaneGeometry(), basic, 4); const lit = new THREE.Mesh(new THREE.BoxGeometry(), [a, b]); const hidden = new THREE.Group(); hidden.visible = false; hidden.add(new THREE.Mesh(new THREE.BoxGeometry(), std));
    const sun = new THREE.DirectionalLight(); sun.castShadow = true; sun.shadow.map = new THREE.WebGLRenderTarget(4, 4); scene.add(decal, lit, hidden, sun);
    return { scene, mats: [basic, std, a, b], sun };
  };
  it('moves high to medium and back: every material in the scene (instanced decal, material arrays, hidden groups) is flagged and shadow maps are rebuilt', () => {
    const { scene, mats, sun } = build(); const r = fakeRenderer(THREE.PCFShadowMap);
    const v0 = mats.map((m) => m.version); applyShadowTier(r, scene, 'high'); // PCF -> BASIC (PCSS)
    expect(r.shadowMap.type).toBe(THREE.BasicShadowMap); expect(sun.shadow.map).toBeNull(); expect(r.shadowMap.needsUpdate).toBe(true);
    mats.forEach((m, i) => expect(m.version, m.type).toBeGreaterThan(v0[i]));
    sun.shadow.map = new THREE.WebGLRenderTarget(4, 4); const v1 = mats.map((m) => m.version); applyShadowTier(r, scene, 'medium'); // BASIC -> PCF
    expect(r.shadowMap.type).toBe(THREE.PCFShadowMap); expect(sun.shadow.map).toBeNull(); mats.forEach((m, i) => expect(m.version, m.type).toBeGreaterThan(v1[i]));
  });
  it('does nothing when the shadow type is already right (high to ultra both use PCSS)', () => {
    const { scene, mats, sun } = build(); const r = fakeRenderer(THREE.BasicShadowMap); const v = mats.map((m) => m.version);
    applyShadowTier(r, scene, 'ultra'); expect(sun.shadow.map).not.toBeNull(); mats.forEach((m, i) => expect(m.version).toBe(v[i])); expect(r.shadowMap.needsUpdate).toBe(false);
  });
});
