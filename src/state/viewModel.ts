/**
 * View model: reproduces the prototype's `vals()` (core) + `renderVals()`/`extras()`/`pages()` (town) as a pure
 * function of (state, seed, props). Every key is a template identifier; handlers are store actions of the same name.
 */
import { mountRef, overlayRef } from './domRefs';
import type { Seed } from '../lib/data/types';
import type { AppStore } from './types';
import { makeCtx, type VmProps } from './vm/context';
import { boardVm } from './vm/board';
import { chatVm } from './vm/chat';
import { doorVm } from './vm/doors';
import { feedVm } from './vm/feed';
import { hearthVm } from './vm/hearth';
import { hudVm } from './vm/hud';
import { layoutVm } from './vm/layout';
import { mediaVm } from './vm/media';
import { pagesVm } from './vm/pages';
import { paletteVm, toastVm } from './vm/palette';
import { shellVm } from './vm/shell';
import { skeinVm } from './vm/skein';
import { hasSection } from './selectors';
import { roomOf } from './selectors';

export type { VmProps } from './vm/context';

/** Shown until the seed has loaded. */
export const loadingViewModel = () => ({ ready: false as const, townLoading: true as const, mountRef, overlayRef });

export function selectViewModel(s: AppStore, seed: Seed, props: VmProps) {
  const x = makeCtx(s, seed, props);
  const chat = chatVm(x); const hearth = hearthVm(x); const feed = feedVm(x); const board = boardVm(x); const skein = skeinVm(x);
  const door = doorVm(x, { chat, hearth, feed, board, skein });
  const shell = shellVm(x, { chat, hearth, feed, board, skein });
  const isDark = s.theme === 'dark';
  const me = s.me;
  const ok = hasSection(x.sp, s.section);
  return {
    ready: true as const, ic: x.ic, icS: x.icS, icL: x.icL, isDark, isLight: !isDark,
    themeIcon: isDark ? x.I('sun', 18) : x.I('moon', 18), themeLabel: isDark ? 'Light' : 'Dark', toggleTheme: s.toggleTheme,
    me: { name: me?.name ?? '', initials: me?.initials ?? '', status: s.call ? `In ${roomOf(seed, s.call.space)?.name ?? ''}` : 'Around' },
    ...chat, ...hearth, ...feed, ...board, ...skein, ...paletteVm(x), ...toastVm(x), ...layoutVm(x, chat, hearth),
    mountRef, overlayRef,
    ...shell, ...hudVm(x, door), ...pagesVm(x, ok), ...mediaVm(x),
  };
}

export type ViewModel = ReturnType<typeof selectViewModel>;
