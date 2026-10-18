import { describe, expect, it } from 'vitest';
import { MAP_STYLES, getMapStyle } from './index';
import { DEFAULT_MAP_STYLE, MAP_STYLE_IDS, resolveMapStyle } from './pref';

describe('map style registry', () => {
  it('has one style per id, each with its own id, label and builder', () => {
    expect(Object.keys(MAP_STYLES).sort()).toEqual([...MAP_STYLE_IDS].sort());
    for (const id of MAP_STYLE_IDS) { const s = MAP_STYLES[id]; expect(s.id).toBe(id); expect(s.label.length).toBeGreaterThan(0); expect(typeof s.buildSite).toBe('function'); }
  });
  it('falls back to the default style for unknown ids and prefers local over space default', () => {
    expect(getMapStyle('nope').id).toBe(DEFAULT_MAP_STYLE);
    expect(getMapStyle(null).id).toBe(DEFAULT_MAP_STYLE);
    expect(resolveMapStyle('sanctuary', null)).toBe('sanctuary');
    expect(resolveMapStyle('sanctuary', 'village')).toBe('village');
    expect(resolveMapStyle('bogus', null)).toBe(DEFAULT_MAP_STYLE);
  });
});
