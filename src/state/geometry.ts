import { LAYOUT } from '../config/app';

/** Standard and wide (docs, calendar, meeting, theater) panel widths for a viewport width. */
export const panelWidth = (vw: number) => Math.round(Math.min(LAYOUT.panelMaxPx, Math.max(LAYOUT.panelMinPx, vw * LAYOUT.panelFrac)));
export const widePanelWidth = (vw: number) => Math.round(Math.min(LAYOUT.widePanelMaxPx, vw * LAYOUT.widePanelFrac));
