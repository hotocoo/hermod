/** Global keyboard: palette, navigation shortcuts, Escape ladder, and the town's p / m toggles. */
import { KEYS } from '../config/app';
import { paletteResults } from './palette';
import type { AppStore, StoreLike } from './types';

export interface KeyLike {
  key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean;
  target?: EventTarget | null; preventDefault(): void;
}
const isTyping = (e: KeyLike) => /INPUT|TEXTAREA/.test((e.target as HTMLElement | null)?.tagName ?? '');

/** Shared shortcuts (palette, alt+number sections, alt+arrow spaces, mute, '/'). `s` is the state before the key. */
function coreKey(store: StoreLike, s: AppStore, e: KeyLike): void {
  const mod = !!(e.metaKey || e.ctrlKey);
  if (mod && e.key.toLowerCase() === KEYS.palette) { e.preventDefault(); s.togglePalette(); return; }
  if (e.key === 'Escape') {
    if (s.prompt || s.confirm) return;
    if (s.modal) { s.closeModal(); return; }
    if (s.palette) s.closePalette(); else if (s.thread) s.closeThread();
    return;
  }
  const seed = s.seed; if (!seed) return;
  if (s.palette) {
    const res = paletteResults(s, seed);
    if (e.key === 'ArrowDown') { e.preventDefault(); s.setPi(Math.min(res.length - 1, s.pi + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); s.setPi(Math.max(0, s.pi - 1)); }
    if (e.key === 'Enter' && res[s.pi]) { e.preventDefault(); s.runResult(s.pi); }
    return;
  }
  if (e.altKey && /^[1-9]$/.test(e.key)) {
    const sec = s.spaces.find((x) => x.id === s.space)?.sections[Number(e.key) - 1];
    if (sec) { e.preventDefault(); s.goSection(sec); }
    return;
  }
  if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const i = s.spaces.findIndex((x) => x.id === s.space);
    s.goSpace(s.spaces[(i + (e.key === 'ArrowDown' ? 1 : -1) + s.spaces.length) % s.spaces.length].id);
    return;
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === KEYS.mute && s.call) { e.preventDefault(); s.toggleMute(); return; }
  if (!isTyping(e) && e.key === KEYS.search) { e.preventDefault(); s.openPalette(); }
  if (!isTyping(e) && e.key === '?') { e.preventDefault(); s.openModal({ kind: 'shortcuts' }); }
}

/** Town-level keys: Escape ladder and the photo (p) / archipelago (m) toggles. */
function townKey(s: AppStore, e: KeyLike): void {
  if (s.modal || s.prompt || s.confirm) return;
  if (e.key === 'Escape' && s.door && !s.inside) { s.backFromDoor(); return; }
  if (e.key === 'Escape') {
    if (s.story) { s.closeStory(); return; }
    if (s.profile) { s.closeProfile(); return; }
    if (s.drawer) { s.closeDrawer(); return; }
    if (s.photo) { s.togglePhoto(); return; }
    if (s.archi) { s.toggleArchi(); return; }
    if (s.inside && !s.palette && !s.thread) s.exit();
    return;
  }
  if (isTyping(e) || s.palette || s.inside || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === KEYS.photo) { e.preventDefault(); s.togglePhoto(); } else if (k === KEYS.archi) { e.preventDefault(); s.toggleArchi(); }
}

/** One keydown listener running both handlers against the pre-key state. Returns cleanup. */
export function attachKeyboard(store: StoreLike): () => void {
  const onKey = (e: KeyboardEvent) => {
    const s = store.getState();
    if (!s.ready) return;
    coreKey(store, s, e);
    townKey(s, e);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
