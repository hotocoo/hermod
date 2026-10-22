import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { HERE_PERCH_Z, RAVEN } from '@/config/scene';
import { createRavens } from '../ravens';
import { spring } from '../spring';
import type { Plots } from '../types';
import type { World } from '../world';

const FRAME = 1 / 30;
const SEARCH = { x: 2, z: -3 };
const CHAT = { x: -4, z: 1 };

/** Raven stand-in with just the userData the actor loop touches. */
const fakeRaven = () => { const g = new THREE.Group(); g.userData = { letter: { visible: false }, wings: [], legs: { visible: false }, baseScale: RAVEN.scale }; return g; };

function setup(reduced = false) {
  const island = new THREE.Group();
  const chat = { built: true, dying: false, g: new THREE.Group(), open: { x: 0 }, scale: { x: 1 }, pop: { v: 0 } };
  const plots = { chat } as unknown as Plots;
  const ring = vi.fn();
  const anchors: Record<string, { x: number; z: number }> = { search: SEARCH, chat: CHAT };
  const r = createRavens({ WK: { raven: fakeRaven } as unknown as World, island, plots, islandY: spring(0, [1, 1]), reduced, ring, anchor: (id) => anchors[id] });
  const run = (sec: number) => { for (let t = 0; t < sec; t += FRAME) r.update(FRAME); };
  return { r, island, ring, chat, run };
}

describe('ravens flyIn (R-001)', () => {
  it('flies a raven in, fires the callback only on arrival at the anchor, then sends it off', () => {
    const { r, ring, run } = setup(); const cb = vi.fn();
    expect(r.flyIn('search', cb)).toBe(true);
    expect(r.ravens).toHaveLength(1); expect(cb).not.toHaveBeenCalled();
    run(RAVEN.flyInSec / 2); expect(cb).not.toHaveBeenCalled();
    run(RAVEN.flyInSec); expect(cb).toHaveBeenCalledTimes(1);
    expect(ring).toHaveBeenCalledWith(SEARCH.x, SEARCH.z, expect.anything());
    expect(r.ravens.every((x) => x.phase === 'out')).toBe(true);
    run(10); expect(r.ravens).toHaveLength(0);
  });

  it('plays no flight under reduced motion, but the letter still arrives', () => {
    const { r, run } = setup(true); const cb = vi.fn();
    expect(r.flyIn('search', cb)).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1); run(1); expect(r.ravens).toHaveLength(0);
  });

  it('keeps flights bounded by RAVEN.maxFlying and still delivers every callback', () => {
    const { r } = setup(); const cb = vi.fn(); const n = RAVEN.maxFlying + 3;
    for (let i = 0; i < n; i++) r.flyIn('search', cb);
    expect(r.ravens).toHaveLength(RAVEN.maxFlying);
    expect(cb).toHaveBeenCalledTimes(n - RAVEN.maxFlying);
  });
});

describe('ravens flyOut (R-006)', () => {
  it('lifts a raven off the building with the letter and removes it after the flight', () => {
    const { r, island, ring, run } = setup();
    expect(r.flyOut('chat')).toBe(true);
    expect(r.ravens).toHaveLength(1); expect(r.ravens[0].phase).toBe('out'); expect(r.ravens[0].g.userData.letter.visible).toBe(true);
    expect(ring).toHaveBeenCalledWith(CHAT.x, CHAT.z, expect.anything());
    run(RAVEN.flyOutSec + 1); expect(r.ravens).toHaveLength(0); expect(island.children).toHaveLength(0);
  });

  it('plays nothing under reduced motion or without an anchor', () => {
    expect(setup(true).r.flyOut('chat')).toBe(false);
    expect(setup().r.flyOut('nowhere')).toBe(false);
  });
});

describe('perched ravens (R-002)', () => {
  const settle = (run: (s: number) => void) => run(8);
  const live = (r: ReturnType<typeof setup>['r']) => r.perched.filter((x) => !x.leaving);

  it('perches one raven per unread on distinct roof slots, capped at RAVEN.maxHere', () => {
    const { r, run } = setup();
    r.setWant(2); settle(run);
    expect(live(r)).toHaveLength(2); expect(new Set(live(r).map((x) => x.slot)).size).toBe(2);
    r.setWant(RAVEN.maxHere + 5); settle(run);
    expect(live(r)).toHaveLength(RAVEN.maxHere); expect(RAVEN.maxHere).toBe(HERE_PERCH_Z.length);
  });

  it('sends ravens off as the unread count drops, one per unread remaining', () => {
    const { r, run } = setup();
    r.setWant(3); settle(run); expect(live(r)).toHaveLength(3);
    r.setWant(1); settle(run);
    expect(live(r)).toHaveLength(1); expect(r.perched).toHaveLength(1);
    r.setWant(0); settle(run); expect(r.perched).toHaveLength(0);
  });
});
