/** Sends this device's presence beacon (online or away) to every space: on an interval, and at once when idle state flips. Returns cleanup. */
import { PRESENCE } from '../config/app';
import { getBridge } from '../lib/bridge';
import { isIdle } from './presence';
import { isHomeSpace } from './selectors';
import { timer } from './timers';
import type { StoreLike } from './types';

const TIMER = 'presence';

export function startPresence(store: StoreLike): () => void {
  const get = store.getState;
  let lastInput = Date.now(); let lastSent = 0; let sentAway: boolean | null = null;
  const tick = () => {
    const s = get(); const now = Date.now();
    s.sweepPresence();
    if (!s.privacy.presence) { sentAway = null; return; }
    const away = isIdle(lastInput, now, PRESENCE.idleMs);
    if (away === sentAway && now - lastSent < PRESENCE.everyMs) return;
    // Home is local only and has no topic; a node reported off has nothing to send through (status may still be unknown at boot: send then)
    if (s.node && !s.node.running) return;
    sentAway = away; lastSent = now;
    s.spaces.filter((sp) => !isHomeSpace(sp)).forEach((sp) => { void getBridge().sendEphemeral(sp.id, 'presence', { away }).catch(() => { /* a dropped beacon is repeated next interval */ }); });
  };
  const onInput = () => { lastInput = Date.now(); if (sentAway) tick(); };
  PRESENCE.inputEvents.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
  timer.every(TIMER, PRESENCE.checkMs, tick);
  tick();
  return () => { timer.clear(TIMER); PRESENCE.inputEvents.forEach((e) => window.removeEventListener(e, onInput)); };
}
