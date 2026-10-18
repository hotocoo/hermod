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

export const useAppStore = create<AppStore>()((...a) => ({
  ...createCoreSlice(...a),
  ...createSessionSlice(...a),
  ...createNavSlice(...a),
  ...createSceneSlice(...a),
  ...createSkySlice(...a),
  ...createChatSlice(...a),
  ...createCallSlice(...a),
  ...createMediaSlice(...a),
  ...createWorkSlice(...a),
  ...createRavenSlice(...a),
  ...createOverlaySlice(...a),
  ...createUiSlice(...a),
  ...createDeskSlice(...a),
  ...createMessagingSlice(...a),
}));

export type AppStoreApi = typeof useAppStore;
