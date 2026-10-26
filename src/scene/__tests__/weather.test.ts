import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// weather.ts paints its snowflake texture onto a canvas at creation; node has no canvas, so stub one.
(globalThis as { document?: unknown }).document = {
  createElement: () => ({
    width: 0, height: 0, style: {},
    getContext: () => ({ createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined, fillStyle: '' }),
  }),
};
const { createWeather } = await import('../weather');

const frame = { k: 0.5, archiK: 0, outside: true };
const full = { rk: 1, sk: 0, fk: 0, ok: 0, sunK: 1, wind: 0.3 };
const storm = { rk: 0, sk: 0, fk: 0, ok: 1, sunK: 0.2, wind: 0.6 };

function setup(reduced: boolean) {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);
  const onFlash = vi.fn();
  const w = createWeather({ scene, world, reduced, onFlash });
  const rain = world.children.find((c) => c instanceof THREE.LineSegments) as THREE.LineSegments;
  return { w, rain, onFlash };
}

describe('weather under reduced motion (T-017)', () => {
  it('falls rain when motion is allowed', () => {
    const { w, rain } = setup(false);
    w.setWeather('rain');
    const before = Float32Array.from(rain.geometry.attributes.position.array as Float32Array);
    for (let i = 0; i < 10; i++) w.update(0.05, i * 0.05, full, frame);
    expect(Float32Array.from(rain.geometry.attributes.position.array as Float32Array)).not.toEqual(before);
  });

  it('freezes rain when motion is reduced', () => {
    const { w, rain } = setup(true);
    w.setWeather('rain');
    const before = Float32Array.from(rain.geometry.attributes.position.array as Float32Array);
    for (let i = 0; i < 10; i++) w.update(0.05, i * 0.05, full, frame);
    expect(rain.geometry.attributes.position.array).toEqual(before);
  });

  it('never lights a storm when motion is reduced, but does when allowed', () => {
    const hemi = new THREE.HemisphereLight();
    const reduced = setup(true);
    reduced.w.setWeather('storm');
    for (let i = 0; i < 200; i++) { reduced.w.update(0.05, i * 0.05, storm, frame); reduced.w.lightning(0.05, hemi); }
    expect(reduced.onFlash).not.toHaveBeenCalled();

    const fullMotion = setup(false);
    fullMotion.w.setWeather('storm');
    for (let i = 0; i < 200; i++) { fullMotion.w.update(0.05, i * 0.05, storm, frame); fullMotion.w.lightning(0.05, hemi); }
    expect(fullMotion.onFlash).toHaveBeenCalled();
  });
});
