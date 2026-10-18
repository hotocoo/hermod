import type { Seed } from '../lib/data/types';
import { coll } from './dataTypes';
import { personOf, meId } from './selectors';
import type { AppStore, Profile } from './types';

/** The edited profile, or the one the core holds for the signed-in user. */
export function effectiveProfile(s: Pick<AppStore, 'prof' | 'me'>): Profile {
  return s.prof ?? { name: s.me?.name ?? '', role: '', bio: s.me?.bio ?? '' };
}

/** Real counts from the projections: posts, videos, snapshots and saved items by the signed-in user. */
export function profileStats(s: AppStore, seed: Seed) {
  const me = meId(s);
  const posts = Object.entries(coll(seed, 'feed')).filter(([k]) => k !== 'home').flatMap(([, v]) => v).filter((p) => p.by === me);
  const snaps = Object.values(coll(seed, 'skein')).flatMap((k) => k.snaps).filter((x) => x.by === me);
  const saved = Object.values(coll(seed, 'feed')).flat().filter((p) => p.saved);
  return {
    posts: posts.filter((p) => p.kind === 'photo' || p.kind === 'note'), videos: posts.filter((p) => p.kind === 'video'), snaps, saved,
    spaces: seed.spaces.length, name: personOf(seed, me).name,
  };
}
