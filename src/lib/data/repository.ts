import { getBridge } from '../bridge';
import { SECTIONS } from '../../config/sections';
import type { Seed } from './types';

/** Single entry point for app data: a thin facade over Bridge.snapshot() that adds the UI-owned section copy. */
export interface Repository { load(): Promise<Seed> }

export const repository: Repository = {
  async load() {
    const snap = await getBridge().snapshot();
    return { ...snap, sections: SECTIONS };
  },
};
