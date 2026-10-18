/**
 * Pure live-stream distribution tree. The host owns one Tree; viewers forward to at most `maxForward` others.
 * All functions return new trees (inputs are never mutated).
 */

export interface TreeCaps { maxDirect: number; maxForward: number; maxViewers: number }

export interface TreeNode { id: string; /** '' while detached (parent lost, awaiting reassignment) */ parent: string; children: readonly string[] }

export interface Tree { host: string; nodes: ReadonlyMap<string, TreeNode> }

export const createTree = (host: string): Tree => ({ host, nodes: new Map([[host, { id: host, parent: '', children: [] }]]) });

const limit = (t: Tree, caps: TreeCaps, id: string): number => (id === t.host ? caps.maxDirect : caps.maxForward);

export const viewerCount = (t: Tree): number => t.nodes.size - 1;
export const parentOf = (t: Tree, id: string): string | undefined => t.nodes.get(id)?.parent || undefined;
export const has = (t: Tree, id: string): boolean => t.nodes.has(id);

/** `id` and everything below it. */
export function subtree(t: Tree, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of t.nodes.get(cur)?.children ?? []) stack.push(c);
  }
  return out;
}

/** Depth from the host (host = 0) of every node connected to the host. Detached subtrees are absent. */
export function depths(t: Tree): Map<string, number> {
  const out = new Map<string, number>([[t.host, 0]]);
  const queue = [t.host];
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i];
    for (const c of t.nodes.get(id)?.children ?? []) { out.set(c, (out.get(id) as number) + 1); queue.push(c); }
  }
  return out;
}

export interface Capacity { viewers: number; max: number; free: number; directFree: number; full: boolean }

export function capacity(t: Tree, caps: TreeCaps): Capacity {
  const viewers = viewerCount(t);
  const direct = t.nodes.get(t.host)?.children.length ?? 0;
  return { viewers, max: caps.maxViewers, free: Math.max(0, caps.maxViewers - viewers), directFree: Math.max(0, caps.maxDirect - direct), full: viewers >= caps.maxViewers };
}

/**
 * Best parent for `child`: connected to the host, below its child limit, not excluded, not inside child's own subtree
 * (no cycles). Shallowest wins (lowest latency), then fewest children, then id for determinism.
 */
export function pickParent(t: Tree, caps: TreeCaps, child: string, exclude: ReadonlySet<string> = new Set()): string | null {
  const d = depths(t);
  const own = t.nodes.has(child) ? subtree(t, child) : new Set([child]);
  let best: { id: string; depth: number; kids: number } | null = null;
  for (const [id, depth] of d) {
    if (own.has(id) || exclude.has(id)) continue;
    const kids = t.nodes.get(id)?.children.length ?? 0;
    if (kids >= limit(t, caps, id)) continue;
    if (!best || depth < best.depth || (depth === best.depth && (kids < best.kids || (kids === best.kids && id < best.id)))) best = { id, depth, kids };
  }
  return best?.id ?? null;
}

function withNodes(t: Tree, edit: (m: Map<string, TreeNode>) => void): Tree {
  const m = new Map(t.nodes);
  edit(m);
  return { host: t.host, nodes: m };
}

function unlink(m: Map<string, TreeNode>, id: string): void {
  const n = m.get(id);
  const p = n && m.get(n.parent);
  if (n && p) m.set(p.id, { ...p, children: p.children.filter((c) => c !== id) });
  if (n) m.set(id, { ...n, parent: '' });
}

export type AttachResult = { ok: true; tree: Tree; parent: string; /** previous parent when a known viewer moved */ from?: string } | { ok: false; reason: 'full' };

/** Adds a new viewer, or moves a known one (rejoin after a parent failure). */
export function attach(t: Tree, caps: TreeCaps, child: string, exclude: Iterable<string> = []): AttachResult {
  if (child === t.host) return { ok: false, reason: 'full' };
  const known = t.nodes.get(child);
  if (!known && viewerCount(t) >= caps.maxViewers) return { ok: false, reason: 'full' };
  const from = known?.parent || undefined;
  const base = known ? withNodes(t, (m) => unlink(m, child)) : t;
  const parent = pickParent(base, caps, child, new Set(exclude));
  if (!parent) return { ok: false, reason: 'full' };
  const tree = withNodes(base, (m) => {
    const p = m.get(parent) as TreeNode;
    m.set(parent, { ...p, children: [...p.children, child] });
    m.set(child, { id: child, parent, children: known?.children ?? [] });
  });
  return { ok: true, tree, parent, from };
}

export interface Reassignment { child: string; parent: string }
export interface RemoveResult { tree: Tree; /** parent the removed node hung from */ from?: string; moves: Reassignment[]; /** orphans that found no parent and were removed with their subtree */ dropped: string[] }

/** Removes a viewer (left or failed) and reattaches its children, with their subtrees, elsewhere. */
export function remove(t: Tree, caps: TreeCaps, id: string): RemoveResult {
  const n = t.nodes.get(id);
  if (!n || id === t.host) return { tree: t, moves: [], dropped: [] };
  const from = n.parent || undefined;
  let tree = withNodes(t, (m) => {
    unlink(m, id);
    for (const c of n.children) { const cn = m.get(c); if (cn) m.set(c, { ...cn, parent: '' }); }
    m.delete(id);
  });
  const moves: Reassignment[] = [];
  const dropped: string[] = [];
  for (const orphan of n.children) {
    const r = attach(tree, caps, orphan);
    if (r.ok) { tree = r.tree; moves.push({ child: orphan, parent: r.parent }); continue; }
    const gone = subtree(tree, orphan);
    tree = withNodes(tree, (m) => { for (const g of gone) m.delete(g); });
    dropped.push(...gone);
  }
  return { tree, from, moves, dropped };
}
