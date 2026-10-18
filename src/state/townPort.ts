/** Module-level handle to the live 3D town, shared by store actions. Null until the scene boots (and on the server). */
import type { SectionId } from '../lib/data/types';
import type { PickId, TownApi } from '../scene/types';

export type TownPort = TownApi;
export type { SpaceInfo as TownSpaceInfo } from '../scene/types';

let current: TownPort | null = null;
export const getTown = (): TownPort | null => current;
export const setTown = (t: TownPort | null): void => { current = t; };

/** Narrow seam: ids arrive as strings from seed keys and DOM events; the scene wants its SectionId union. */
export const asSection = (id: string) => id as SectionId;
export const asPick = (id: string | null) => id as PickId | null;
