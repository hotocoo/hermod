import type { RoomLayout } from './layoutTypes';
import commons from '../layouts/commons.json';
import feed from '../layouts/feed.json';
import board from '../layouts/board.json';
import skein from '../layouts/skein.json';
import desk from '../layouts/desk.json';
import arcade from '../layouts/arcade.json';
import hearth from '../layouts/hearth.json';

const all = [commons, feed, board, skein, desk, arcade, hearth] as unknown as RoomLayout[];
/** Layout data by section id. Adding a room = adding a JSON file above; nothing else changes. */
export const LAYOUTS: Record<string, RoomLayout> = Object.fromEntries(all.map((l) => [l.section, l]));
