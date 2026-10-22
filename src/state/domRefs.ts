/** DOM nodes the view registers (ref callbacks live here so the view model stays serialisable). */
import { TIMING } from '../config/app';
import { reduced } from '../lib/format';

const refs: { mount: HTMLElement | null; overlay: HTMLElement | null; msgs: HTMLElement | null; live: HTMLElement | null } =
  { mount: null, overlay: null, msgs: null, live: null };

export const getMount = () => refs.mount;
export const getOverlay = () => refs.overlay;
export const mountRef = (el: HTMLElement | null) => { refs.mount = el; };
export const overlayRef = (el: HTMLElement | null) => { refs.overlay = el; };
export const msgRef = (el: HTMLElement | null) => {
  refs.msgs = el;
  if (el) setTimeout(() => el.scrollTo({ top: el.scrollHeight }), TIMING.msgInitialScrollMs);
};
export const getMsgs = () => refs.msgs;
export const liveRef = (el: HTMLElement | null) => { refs.live = el; if (el) el.scrollTop = el.scrollHeight; };
export const palRef = (el: HTMLElement | null) => { if (el) setTimeout(() => el.focus(), TIMING.paletteFocusMs); };

export function scrollMessages(smooth: boolean): void {
  refs.msgs?.scrollTo({ top: refs.msgs.scrollHeight, behavior: smooth && !reduced() ? 'smooth' : 'auto' });
}
export function scrollLiveToEnd(): void {
  if (refs.live) refs.live.scrollTop = 1e6;
}
