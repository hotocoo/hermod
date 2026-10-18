import type { CallSession } from './call';

/** The call this window is in (at most one). Lets `useLevels()` and other views read it without prop drilling. */
let current: CallSession | null = null;
const listeners = new Set<() => void>();

export const activeCall = (): CallSession | null => current;

export function setActiveCall(c: CallSession | null): void {
  if (current === c) return;
  current = c;
  for (const l of [...listeners]) l();
}

export function subscribeActiveCall(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
