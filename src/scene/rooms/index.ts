import { commons } from './commons';
import { countingHouse } from './countingHouse';
import { gamesHall } from './gamesHall';
import { gallery } from './gallery';
import { loom } from './loom';
import { workshop } from './workshop';

/** Room makers keyed by INTERIOR_MAKERS names (config/scene.ts). */
export const ROOM_MAKERS = { commons, countingHouse, gallery, gamesHall, workshop, loom } as const;
