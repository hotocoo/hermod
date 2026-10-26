/** Small pure formatting and motion helpers shared by state and view model. */
import { LIMITS } from '../config/app';

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
export const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** mm:ss from milliseconds (call and meeting timers). */
export const dur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
/** m:ss from seconds (video length, chapters). */
export const fmtSec = (sec: number) => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`;
/** hh:mm with half-hour precision for calendar events (30 or 00). */
export const fmtHalfHour = (h: number) => `${pad(Math.floor(h))}:${h % 1 ? '30' : '00'}`;
/** True for a real calendar day written `YYYY-MM-DD` (rejects `2030-02-30`, `2030-99-99`). */
export const isIsoDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const num = (n: number) => n.toLocaleString('en');
/** "1 card", "3 cards"; pass `many` for irregular plurals. */
export const count = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
export const firstName = (name: string) => name.split(' ')[0];
/** W-006 override: 'system' follows the OS, 'reduce' and 'full' force it. Set by the sky slice. */
let motionOverride: 'system' | 'reduce' | 'full' = 'system';
export const setMotionOverride = (o: 'system' | 'reduce' | 'full'): void => { motionOverride = o; };
export const reduced = () =>
  motionOverride === 'reduce'
    || (motionOverride !== 'full' && typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const EASE = 'cubic-bezier(.22,1,.36,1)';
/** CSS animation shorthand staggered by index; 'none' under reduced motion. */
export function anim(i: number, kind = 'hm-rise', ms = 460, stepMs = 28): string {
  if (reduced()) return 'none';
  return `${kind} ${ms}ms ${EASE} ${Math.min(i, LIMITS.animStagger) * stepMs}ms both`;
}
/** Staggered entrance used by the pages (media, docs, calendar, profile). */
export const aniPage = (i: number) => `hm-rise 460ms ${EASE} ${Math.min(i, LIMITS.animStagger) * 40}ms both`;
export const aniDoor = (i: number) => `hm-rise 420ms ${EASE} ${320 + i * 70}ms both`;
export const aniOnce = (kind: string, ms: number) => `${kind} ${ms}ms ${EASE} both`;
