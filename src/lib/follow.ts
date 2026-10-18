/** Who the user follows (FEATURES F-005): device-local, never in the event log. */
import { readString, writeString } from './storage';

const KEY = 'hermodr.following';
const read = (): string[] => { try { return JSON.parse(readString(KEY) ?? '[]') as string[]; } catch { return []; } };

export const isFollowing = (userId: string): boolean => read().includes(userId);
export function toggleFollow(userId: string): void {
  const list = read();
  writeString(KEY, JSON.stringify(list.includes(userId) ? list.filter((x) => x !== userId) : [...list, userId]));
}
