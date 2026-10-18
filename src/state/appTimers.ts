/** Recurring app timers, started once the snapshot is loaded. Everything else is event-driven (bridge events, user actions). */
import { STORAGE_KEYS, TIMING } from '../config/app';
import { readFlag } from '../lib/storage';
import { deliverDeskNotices, slaSoonNotices } from './deskNotify';
import { timer } from './timers';
import type { StoreLike } from './types';

const NAMES = ['intro', 'onb', 'weather', 'clock', 'deskSla'] as const;
const DESK_SLA_CHECK_MS = 30_000;

/** Start the intro/onboarding timeouts and the weather and clock intervals. Returns cleanup. */
export function startTimers(store: StoreLike): () => void {
  const get = store.getState;
  const seen = readFlag(STORAGE_KEYS.welcomed);
  timer.after('intro', TIMING.introMs, () => store.setState({ intro: false }));
  if (!seen) timer.after('onb', TIMING.onboardingDelayMs, () => store.setState({ onb: 1 }));
  timer.every('weather', TIMING.weatherStepMs, () => get().stepWeather());
  timer.every('clock', TIMING.nowTickMs, () => { const s = get(); if (s.call || s.section === 'hearth' || s.section === 'board') s.tickNow(); });
  timer.every('deskSla', DESK_SLA_CHECK_MS, () => { const s = get(); if (s.seed) deliverDeskNotices(s, slaSoonNotices(s.seed, s.me?.user_id ?? '', Date.now())); });
  return () => { NAMES.forEach((n) => timer.clear(n)); };
}
