import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// The stub room makers ignore the kit, and the real one needs a full material set.
vi.mock('../rooms/kit', () => ({ createRoomKit: () => ({}) }));

// weather.ts paints its snowflake texture onto a canvas at creation; node has no canvas, so stub one.
(globalThis as { document?: unknown }).document = {
  createElement: () => ({
    width: 0, height: 0, style: {},
    getContext: () => ({ createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined, fillStyle: '' }),
  }),
};
const { createWeather } = await import('../weather');
const { createSkyBodies } = await import('../sky');
const { createInteriors } = await import('../interiors');

describe('scene teardown', () => {
  it('sky bodies leave the scene and free their geometry', () => {
    const scene = new THREE.Scene(); const sky = createSkyBodies(scene, true);
    const geos = scene.children.map((c) => (c as THREE.Mesh).geometry); const spies = geos.map((g) => vi.spyOn(g, 'dispose'));
    expect(scene.children.length).toBeGreaterThan(0);
    sky.dispose();
    expect(scene.children).toHaveLength(0);
    spies.forEach((s) => expect(s).toHaveBeenCalled());
  });

  it('weather removes its particles, clouds and bolt and frees their geometry', () => {
    const scene = new THREE.Scene(); const world = new THREE.Group(); scene.add(world);
    const w = createWeather({ scene, world, reduced: true });
    const geos = world.children.filter((c) => (c as THREE.Mesh).geometry).map((c) => vi.spyOn((c as THREE.Mesh).geometry, 'dispose'));
    w.dispose();
    expect(world.children).toHaveLength(0);
    expect(scene.children).toEqual([world]);
    geos.forEach((s) => expect(s).toHaveBeenCalled());
  });

  it('interiors free every cached room, and a room that lands after disposal is freed at once', async () => {
    const geo = new THREE.BoxGeometry(); const lateGeo = new THREE.BoxGeometry();
    const room = (g: THREE.BufferGeometry) => { const r = new THREE.Group() as unknown as THREE.Group & { userData: Record<string, unknown> }; r.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial())); r.userData = { cam: new THREE.Vector3(), look: new THREE.Vector3() }; return r; };
    const calls: THREE.BufferGeometry[] = [geo, lateGeo];
    const IN = createInteriors({} as never, {} as never, { commons: () => room(calls.shift()!) as never, gallery: () => room(calls.shift()!) as never });
    const gone = vi.spyOn(geo, 'dispose'); const late = vi.spyOn(lateGeo, 'dispose');
    IN.get('chat'); IN.dispose();
    expect(IN.has('chat')).toBe(false);
    expect(gone).toHaveBeenCalled();
    IN.get('feed');
    expect(late).toHaveBeenCalled();
    expect(IN.has('feed')).toBe(false);
  });
});
