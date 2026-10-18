import { describe, expect, it } from 'vitest';
import { attach, capacity, createTree, depths, parentOf, pickParent, remove, subtree, viewerCount, type Tree, type TreeCaps } from '../tree';

const caps: TreeCaps = { maxDirect: 2, maxForward: 2, maxViewers: 7 };

function fill(n: number, c: TreeCaps = caps): Tree {
  let t = createTree('H');
  for (let i = 1; i <= n; i += 1) {
    const r = attach(t, c, `v${i}`);
    if (!r.ok) throw new Error(`v${i} refused`);
    t = r.tree;
  }
  return t;
}

describe('attach', () => {
  it('fills the host first, then the shallowest forwarders', () => {
    const t = fill(6);
    expect(parentOf(t, 'v1')).toBe('H');
    expect(parentOf(t, 'v2')).toBe('H');
    expect(parentOf(t, 'v3')).toBe('v1');
    expect(parentOf(t, 'v4')).toBe('v2'); // fewest children among depth 1
    expect(parentOf(t, 'v5')).toBe('v1');
    expect(parentOf(t, 'v6')).toBe('v2');
  });

  it('never exceeds child limits', () => {
    const t = fill(7);
    for (const n of t.nodes.values()) expect(n.children.length).toBeLessThanOrEqual(n.id === 'H' ? caps.maxDirect : caps.maxForward);
  });

  it('enforces the hard viewer cap and exposes capacity', () => {
    const t = fill(7);
    expect(capacity(t, caps)).toMatchObject({ viewers: 7, max: 7, free: 0, full: true });
    expect(attach(t, caps, 'late')).toEqual({ ok: false, reason: 'full' });
  });

  it('refuses when slots run out before the cap', () => {
    const tight: TreeCaps = { maxDirect: 1, maxForward: 0, maxViewers: 10 };
    const t = fill(1, tight);
    expect(attach(t, tight, 'v2')).toEqual({ ok: false, reason: 'full' });
  });

  it('refuses the host as a viewer', () => expect(attach(createTree('H'), caps, 'H').ok).toBe(false));

  it('honours exclude (failed parent) and moves a known viewer without double counting', () => {
    const t = fill(4);
    expect(parentOf(t, 'v3')).toBe('v1');
    const r = attach(t, caps, 'v3', ['v1']);
    expect(r.ok && r.parent).toBe('v2');
    if (r.ok) {
      expect(r.from).toBe('v1');
      expect(viewerCount(r.tree)).toBe(4);
      expect(r.tree.nodes.get('v1')?.children).not.toContain('v3');
    }
  });

  it('is pure', () => {
    const t = fill(3);
    const before = JSON.stringify([...t.nodes]);
    attach(t, caps, 'x');
    expect(JSON.stringify([...t.nodes])).toBe(before);
  });
});

describe('pickParent', () => {
  it('never picks inside the child own subtree (no cycles)', () => {
    const t = fill(5);
    const own = subtree(t, 'v1');
    const p = pickParent(t, caps, 'v1');
    expect(p && own.has(p)).toBeFalsy();
  });
});

describe('remove', () => {
  it('reattaches orphans with their subtrees and keeps every node connected', () => {
    const t = fill(7);
    const r = remove(t, caps, 'v1');
    expect(r.from).toBe('H');
    expect(r.dropped).toEqual([]);
    expect(viewerCount(r.tree)).toBe(6);
    const d = depths(r.tree);
    expect([...r.tree.nodes.keys()].every((id) => d.has(id))).toBe(true);
    for (const mv of r.moves) expect(parentOf(r.tree, mv.child)).toBe(mv.parent);
  });

  it('drops orphans that cannot be placed, with their subtree', () => {
    const tight: TreeCaps = { maxDirect: 1, maxForward: 1, maxViewers: 10 };
    let t = createTree('H');
    for (const id of ['a', 'b', 'c']) { const r = attach(t, tight, id); if (!r.ok) throw new Error('x'); t = r.tree; } // chain H-a-b-c
    const r = remove(t, tight, 'a');
    expect(r.moves).toEqual([{ child: 'b', parent: 'H' }]); // host slot freed by a
    expect(viewerCount(r.tree)).toBe(2);
    expect(r.dropped).toEqual([]);
  });

  it('removing an unknown id or the host is a no-op', () => {
    const t = fill(2);
    expect(remove(t, caps, 'nope').tree).toBe(t);
    expect(remove(t, caps, 'H').tree).toBe(t);
  });
});
