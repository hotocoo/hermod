import { useSyncExternalStore } from 'react';

/** One shared 1 s clock for every SLA countdown: a single interval runs while at least one badge is mounted. */
const listeners = new Set<() => void>();
let timerId: ReturnType<typeof setInterval> | null = null;
let current = Date.now();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (timerId == null) {
    current = Date.now();
    timerId = setInterval(() => { current = Date.now(); listeners.forEach((l) => l()); }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timerId != null) { clearInterval(timerId); timerId = null; }
  };
}

/** Current time in ms, ticking once per second for all subscribers together. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
