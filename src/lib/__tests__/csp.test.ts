import { describe, expect, it } from 'vitest';
import conf from '../../../src-tauri/tauri.conf.json';

const directive = (name: string): string[] =>
  (conf.app.security.csp.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === name) ?? []).slice(1);

describe('app CSP', () => {
  // GLTFLoader hands every texture embedded in a .glb to its loader as a blob: URL and fetches it: without this the packaged app draws the 3D town untextured.
  it('lets fetch read blob: URLs', () => {
    expect(directive('connect-src')).toContain('blob:');
  });
  it('lets the KTX2 transcoder run its wasm in blob workers', () => {
    expect(directive('script-src')).toContain("'wasm-unsafe-eval'");
    expect(directive('worker-src')).toContain('blob:');
  });
});
