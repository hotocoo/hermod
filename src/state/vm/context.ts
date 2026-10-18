import type { ReactElement } from 'react';
import { ICONS, type IconName } from '../../config/icons';
import type { Seed, Space } from '../../lib/data/types';
import { iconSet, type IconSet } from '../../lib/icon';
import { curSpace } from '../selectors';
import type { AppStore } from '../types';

/** Non-store inputs: the window size and an injectable clock for deterministic output. */
export interface VmProps { viewport: { w: number; h: number }; now?: number }

const ICON_L_NAMES: IconName[] = ['mic', 'micOff', 'video', 'videoOff', 'share', 'leave', 'rec', 'flame', 'line', 'chat', 'compass', 'board', 'search'];
interface Icons { ic: IconSet; icS: IconSet; icL: Partial<IconSet> }
let icons: Icons | null = null;
export function getIcons(): Icons {
  if (!icons) icons = { ic: iconSet(18, 1.6), icS: iconSet(14, 1.8), icL: iconSet(22, 1.5, ICON_L_NAMES) };
  return icons;
}
export const hasIcon = (n: string): n is IconName => n in ICONS;

export interface Ctx {
  s: AppStore; seed: Seed; props: VmProps; now: number; sp: Space;
  ic: IconSet; icS: IconSet; icL: Partial<IconSet>;
  /** Icon element by name (any size/stroke). */
  I: (name: string, size?: number, stroke?: number) => ReactElement | null;
}

import { icon } from '../../lib/icon';
export function makeCtx(s: AppStore, seed: Seed, props: VmProps): Ctx {
  const { ic, icS, icL } = getIcons();
  return { s, seed, props, now: props.now ?? Date.now(), sp: curSpace(s), ic, icS, icL, I: icon };
}
