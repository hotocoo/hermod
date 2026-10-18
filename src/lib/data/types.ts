/** Domain types: the snapshot projection shapes (docs/ARCHITECTURE.md section 5). Collection payloads are typed in state/dataTypes. */
import type { Role } from '../bridge/types';
import type { SpaceGrowth } from '../../scene/types';

export interface Person { name: string; i: string; role: string }
export interface Space {
  id: string; name: string; mono: string; kind: string; tagline: string;
  members?: number; online?: number; sections: SectionId[];
  /** Channel opened first in this Space; also where DM-less defaults land. */
  defaultChannel?: string;
  /** Channel that receives meeting and weave summaries. */
  meetingChannel?: string;
  /** Space default map style set by an admin; a device override wins. */
  mapStyle?: string;
  /** Island growth, computed by the core from the log. */
  growth?: SpaceGrowth;
  /** The signed-in user's role in this Space (absent for Home). */
  role?: Role;
}
export type SectionId = 'chat' | 'hearth' | 'feed' | 'board' | 'skein' | 'desk' | 'arcade';
export interface Section { label: string; icon: string; blurb: string; place: string; kicker: string; plot: string; fresh: string }

export const COLLECTIONS = [
  'channels', 'messages', 'rooms', 'agenda', 'workboards', 'skein',
  'feed', 'media', 'pinboards', 'docs', 'events', 'letters', 'inbox', 'desk', 'arcade', 'messaging',
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

/** What `snapshot` returns (sections are UI copy and not part of it). */
export interface Snapshot {
  people: Record<string, Person>;
  spaces: Space[];
  collections: Record<CollectionName, unknown>;
}

export interface Seed extends Snapshot {
  sections: Record<SectionId, Section>;
}
