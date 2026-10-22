/** The write path: every user action that changes shared data is one EventBody sent through the Bridge, then re-read from the core. */
import { errorMessage, getBridge, type EventBody } from '../lib/bridge';
import { getTown } from './townPort';
import type { GetStore } from './types';

/** Collision-safe client-side id for events (`m-3f9a...`); the core only requires uniqueness inside a space. */
export const uid = (prefix: string): string => `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** A raven carries a sent message off the commons (FEATURES R-006); only when ravens are on and the island is in view. */
function flySent(get: GetStore): void {
  const s = get();
  if (s.ravens && !s.archi && !s.photo) getTown()?.flyOut('chat');
}

/** Appends one event to a Space and refreshes the snapshot. Resolves false (after a toast) on failure. A posted message flies a raven off. */
export async function appendEvent(get: GetStore, spaceId: string, body: EventBody): Promise<boolean> {
  try {
    await getBridge().eventAppend(spaceId, body);
    await get().refresh();
    if (body.t === 'message.post') flySent(get);
    return true;
  } catch (e) {
    get().showToast(errorMessage(e), undefined, 'error');
    return false;
  }
}

/** Runs a bridge call; on failure shows the message as a toast and resolves undefined. */
export async function guarded<T>(get: GetStore, fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch (e) { get().showToast(errorMessage(e), undefined, 'error'); return undefined; }
}
