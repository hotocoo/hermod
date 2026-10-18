import type { DeskView } from '../deskTypes';
import { isTerminal } from '../deskTypes';

const FALLBACK_QUEUE = { id: '', name: 'General' };
const MAX_CUBBIES = 24;

/** Rows for the Counting House pigeonhole wall: one cubby per queue with its open-ticket count (what the viewer may see). */
export function deskPaintRows(desk: DeskView | undefined): { who: string; text: string }[] {
  if (!desk) return [];
  const queues = desk.config.queues.length ? desk.config.queues.map((q) => ({ id: q.queue_id, name: q.name })) : [FALLBACK_QUEUE];
  const open = (q: string) => desk.tickets.filter((t) => !t.merged_into && !isTerminal(t.status) && (t.queue === q || (!q && !t.queue))).length;
  return queues.slice(0, MAX_CUBBIES).map((q) => ({ who: q.name, text: String(open(q.id)) }));
}
