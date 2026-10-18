import { describe, expect, it } from 'vitest';
import { LIGHT_FX, LIGHT_TIERS, WEATHER_TARGETS } from '@/config/scene';
import { allFinite, FOG_GLSL, fogSigma, froxelAtlas, sliceDepth } from '../froxelFog';

const F = LIGHT_FX.froxel; const day = { night: 0, fog: 0, rain: 0, inside: false };

describe('froxel extinction', () => {
  it('is the base haze on a clear day and zero inside a room', () => {
    expect(fogSigma(day)).toBeCloseTo(F.base, 8); expect(fogSigma({ ...day, fog: 1, rain: 1, night: 1, inside: true })).toBe(0);
  });
  it('adds night mist, fog weather and rain linearly', () => {
    expect(fogSigma({ ...day, night: 1 })).toBeCloseTo(F.base + F.night, 8);
    expect(fogSigma({ ...day, fog: 0.5 })).toBeCloseTo(F.base + F.fog * 0.5, 8);
    expect(fogSigma({ ...day, rain: 1 })).toBeCloseTo(F.base + F.rain, 8);
  });
  it('rises with every weather input and keeps fog weather denser than rain and night', () => {
    expect(fogSigma({ ...day, fog: 1 })).toBeGreaterThan(fogSigma({ ...day, rain: 1 })); expect(fogSigma({ ...day, fog: 1 })).toBeGreaterThan(fogSigma({ ...day, night: 1 }));
    expect(fogSigma({ ...day, fog: 1 })).toBeGreaterThan(fogSigma(day));
  });
  it('leaves the island visible in every weather at night: transmittance over the island width stays above 5 percent at the layer peak', () => {
    for (const [kind, [rain, , fog]] of Object.entries(WEATHER_TARGETS)) { // the weather kinds are exclusive targets: fog and rain only co-occur at these mixes
      const worst = fogSigma({ night: 1, fog, rain, inside: false }) * 1.45; // the shader's noise lifts sigma by up to 1.45
      expect(Math.exp(-worst * 30), kind).toBeGreaterThan(0.05);
    }
  });
  it('is the only fog on ultra: only that tier builds the volume', () => {
    expect(Object.entries(LIGHT_TIERS).filter(([, t]) => t.froxel).map(([k]) => k)).toEqual(['ultra']);
  });
});

describe('froxel grid', () => {
  it('spaces slice depths exponentially from near to far', () => {
    const [, , gz] = F.grid; expect(sliceDepth(0)).toBeCloseTo(F.near, 6); expect(sliceDepth(gz)).toBeCloseTo(F.far, 4);
    for (let s = 1; s <= gz; s++) expect(sliceDepth(s)).toBeGreaterThan(sliceDepth(s - 1));
    expect(sliceDepth(2) / sliceDepth(1)).toBeCloseTo(sliceDepth(gz) / sliceDepth(gz - 1), 6);
  });
  it('tiles every slice into an atlas that fits a 4096 texture', () => {
    const [gx, gy, gz] = F.grid; expect(froxelAtlas.tilesX * froxelAtlas.tilesY).toBeGreaterThanOrEqual(gz);
    expect(froxelAtlas.width).toBe(gx * froxelAtlas.tilesX); expect(froxelAtlas.height).toBe(gy * froxelAtlas.tilesY);
    expect(Math.max(froxelAtlas.width, froxelAtlas.height)).toBeLessThanOrEqual(4096);
  });
});

describe('froxel NaN guard', () => {
  it('tests the exponent bits, not isnan (dropped under fast math on Metal)', () => {
    for (const k of ['scatter', 'integrate', 'composite'] as const) { expect(FOG_GLSL[k], k).toContain('floatBitsToUint(x) & 0x7F800000u'); expect(FOG_GLSL[k], k).not.toContain('isnan'); }
  });
  it('never blends a bad history texel, never writes a bad scatter or accumulation texel, never composites a bad accumulation texel', () => {
    expect(FOG_GLSL.scatter).toContain('if (!bad4(h)) cur = mix(cur, h, uHist)'); expect(FOG_GLSL.scatter).toContain('gl_FragColor = bad4(cur) ? vec4(0.0) : cur');
    expect(FOG_GLSL.integrate).toContain('bad4(o) ? vec4(0.0, 0.0, 0.0, 1.0) : o'); expect(FOG_GLSL.composite).toContain('if (bad4(a)) { gl_FragColor = col; return; }');
  });
  it('allFinite rejects NaN and Inf anywhere in any list', () => {
    expect(allFinite([1, 2, 3], new Float32Array([0, -1e30]))).toBe(true); expect(allFinite([1, NaN])).toBe(false); expect(allFinite([1], [Infinity])).toBe(false); expect(allFinite([-Infinity])).toBe(false); expect(allFinite()).toBe(true);
  });
});
