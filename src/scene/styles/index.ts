/** MapStyle registry. A new style is one folder src/scene/styles/<id>/index.ts exporting a MapStyle plus one line here (and its id in pref.ts MAP_STYLE_IDS). */
import { sanctuary } from './sanctuary';
import { village } from './village';
import { DEFAULT_MAP_STYLE, type MapStyleChoice } from './pref';
import type { MapStyle } from './types';

export const MAP_STYLES: Readonly<Record<MapStyleChoice, MapStyle>> = { village, sanctuary };
export const getMapStyle = (id: MapStyleChoice | string | null | undefined): MapStyle => MAP_STYLES[(id as MapStyleChoice) in MAP_STYLES ? (id as MapStyleChoice) : DEFAULT_MAP_STYLE];
export type { MapStyle, StyleCtx, StyleSite, StyleGrowth, PlotAnchor, AnchorId, CameraPresets } from './types';
