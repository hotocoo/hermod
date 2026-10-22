/** The app store: zustand, assembled from per-concern slices. SSR-safe (no window access at import). */
import { create } from 'zustand';
import { createCallSlice } from './slices/call';
import { createChatSlice } from './slices/chat';
import { createCoreSlice } from './slices/core';
import { createDeskSlice } from './slices/desk';
import { createMediaSlice } from './slices/media';
import { createNavSlice } from './slices/nav';
import { createOverlaySlice } from './slices/overlay';
import { createRavenSlice } from './slices/ravens';
import { createSceneSlice } from './slices/scene';
import { createSessionSlice } from './slices/session';
import { createSkySlice } from './slices/sky';
import { createUiSlice } from './slices/ui';
import { createWorkSlice } from './slices/work';
import { createMessagingSlice } from './slices/messaging';
import type { AppStore } from './types';

/** Every slice, in merge order. Exported so a test can prove no two slices define the same key (a later spread would silently replace the earlier one). */
export const SLICES = [createCoreSlice, createSessionSlice, createNavSlice, createSceneSlice, createSkySlice, createChatSlice, createCallSlice, createMediaSlice, createWorkSlice, createRavenSlice, createOverlaySlice, createUiSlice, createDeskSlice, createMessagingSlice] as const;

export const useAppStore = create<AppStore>()((...a) => Object.assign({}, ...SLICES.map((make) => make(...a))) as AppStore);

export type AppStoreApi = typeof useAppStore;
