import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { installShaderGuards } from '../shaderGuards';

describe('shaderGuards', () => {
  it('replaces the unguarded normal normalizes in the shared chunks', () => {
    installShaderGuards();
    const C = THREE.ShaderChunk as Record<string, string>;
    expect(C.common).toContain('vec3 hermodSafeNormal');
    expect(C.normal_fragment_maps).toContain('hermodSafeNormal( tbn * mapN, nonPerturbedNormal )');
    expect(C.normal_fragment_maps).not.toContain('normalize( tbn * mapN )');
    expect(C.normal_fragment_begin).toContain('hermodSafeNormal( vNormal');
    expect(C.normal_fragment_begin).not.toContain('normalize( vNormal )');
  });
  it('is idempotent', () => {
    installShaderGuards(); installShaderGuards();
    expect((THREE.ShaderChunk.common.match(/vec3 hermodSafeNormal/g) ?? []).length).toBe(1);
  });
});
