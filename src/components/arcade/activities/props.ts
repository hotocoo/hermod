import type { Seed } from '@/lib/data/types';
import type { ArcadeView } from '@/state/arcadeTypes';

export interface ActivityProps { view: ArcadeView | null; space: string; me: string; seed: Seed | null }
