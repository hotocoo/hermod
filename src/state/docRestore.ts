import type { EventBody } from '../lib/bridge';
import type { DocBlock } from './dataTypes';

type Kind = 'h' | 'p' | 'q' | 't';
const body = (b: DocBlock) => ({ k: b.k as Kind, text: b.text, done: b.k === 't' ? (b.done ?? false) : undefined });

/**
 * The doc.block events that turn `current` into `target` (V-026). Restoring is new edits on top of the log, never a rewrite:
 * blocks missing from the target are deleted, changed ones updated, vanished ones inserted again under their old id.
 * shortcut: the order of blocks that survive is not restored, only their content; upgrade when the core gets a move op.
 */
export function restoreOps(docId: string, current: DocBlock[], target: DocBlock[]): EventBody[] {
  const have = new Map(current.map((b) => [b.id, b]));
  const want = new Set(target.map((b) => b.id));
  const ops: EventBody[] = current.filter((b) => b.id && !want.has(b.id)).map((b) => ({ t: 'doc.block', doc_id: docId, op: 'delete', block_id: b.id as string }));
  let prev: string | undefined;
  for (const t of target) {
    if (!t.id) continue;
    const cur = have.get(t.id);
    if (!cur) ops.push({ t: 'doc.block', doc_id: docId, op: 'insert', block_id: t.id, block: body(t), after: prev });
    else if (cur.k !== t.k || cur.text !== t.text || (cur.done ?? false) !== (t.done ?? false)) ops.push({ t: 'doc.block', doc_id: docId, op: 'update', block_id: t.id, block: body(t) });
    prev = t.id;
  }
  return ops;
}
