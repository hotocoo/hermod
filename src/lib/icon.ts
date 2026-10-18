import { createElement, type ReactElement } from 'react';
import { ICONS, type IconName } from '../config/icons';

/** 24x24 stroke icon element, or null for an unknown name. */
export function icon(name: string, size = 18, strokeWidth = 1.6): ReactElement | null {
  const d = (ICONS as Record<string, string>)[name];
  if (!d) return null;
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block', flex: 'none' },
  }, createElement('path', { d }));
}

export type IconSet = Record<IconName, ReactElement | null>;
export function iconSet(size: number, strokeWidth: number, only?: readonly IconName[]): IconSet {
  const names = (only ?? Object.keys(ICONS)) as IconName[];
  return Object.fromEntries(names.map((n) => [n, icon(n, size, strokeWidth)])) as IconSet;
}
