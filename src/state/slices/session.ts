import type { StateCreator } from 'zustand';
import { HOME_KIND, STORAGE_KEYS } from '../../config/app';
import { COPY } from '../../config/copy';
import { errorMessage, getBridge, type IdentityInfo } from '../../lib/bridge';
import { LEGAL_VERSION } from '../../lib/legal';
import { readFlag, writeFlag, writeString } from '../../lib/storage';
import type { AppStore, SessionSlice } from '../types';

/** A fresh identity carries its short handle as its name; once the user saves a profile the name differs. */
export const needsProfile = (me: IdentityInfo): boolean => me.name === me.handle;

export const createSessionSlice: StateCreator<AppStore, [], [], SessionSlice> = (set, get) => {
  const bridge = getBridge;

  /** Next gate after Terms: profile, then create/join, then the app. */
  const proceed = async () => {
    const me = await bridge().identityGet();
    set({ me });
    if (needsProfile(me)) { set({ phase: 'profile' }); return; }
    await get().refresh();
    const spaces = get().spaces;
    const hasShared = spaces.some((x) => x.kind !== HOME_KIND);
    if (!hasShared && !readFlag(STORAGE_KEYS.spaced)) { set({ phase: 'welcome' }); return; }
    set({ phase: 'app' });
    // A link that arrived during the gates skips Welcome here, so offer it now.
    const code = get().pendingCode;
    if (code) get().openModal({ kind: 'join', code });
  };

  return {
    phase: 'boot', bootError: null, me: null, legal: null, node: null, syncPending: 0, blocked: {}, pendingCode: null,

    boot: async () => {
      try {
        const legal = await bridge().legalStatus();
        set({ legal });
        if (legal.accepted_version !== LEGAL_VERSION) { set({ phase: 'legal' }); return; }
        await proceed();
        const blocked = await bridge().blockList().catch(() => []);
        get().setBlocked(blocked.map((b) => b.user_id));
      } catch (e) { set({ phase: 'failed', bootError: errorMessage(e) }); }
    },

    acceptLegal: async (shareResources) => {
      try {
        set({ legal: await bridge().legalAccept(LEGAL_VERSION, shareResources) });
        await proceed();
      } catch (e) { get().showToast(errorMessage(e), undefined, 'error'); }
    },
    declineLegal: () => set({ phase: 'declined' }),

    saveProfile: async (name, bio) => {
      try {
        const me = await bridge().profileSet({ name: name.trim(), bio: bio.trim(), avatar: get().me?.avatar });
        set({ me });
        await get().refresh();
        return true;
      } catch (e) { get().showToast(errorMessage(e), undefined, 'error'); return false; }
    },

    createSpace: async (name, tagline, kind) => {
      try {
        const sp = await bridge().spaceCreate(name.trim(), tagline.trim(), kind);
        await get().refresh();
        writeFlag(STORAGE_KEYS.spaced); writeString(STORAGE_KEYS.lastSpace, sp.label);
        set({ space: sp.label, section: 'chat' });
        return true;
      } catch (e) { get().showToast(errorMessage(e), undefined, 'error'); return false; }
    },

    joinSpace: async (code) => {
      try {
        const sp = await bridge().inviteAccept(code.trim());
        await get().refresh();
        writeFlag(STORAGE_KEYS.spaced); writeString(STORAGE_KEYS.lastSpace, sp.label);
        set({ space: sp.label, section: 'chat', pendingCode: null });
        get().showToast(COPY.joined(sp.name));
        return true;
      } catch (e) { get().showToast(errorMessage(e), undefined, 'error'); return false; }
    },

    leaveSpace: async (id) => {
      try {
        await bridge().spaceLeave(id);
        await get().refresh();
        return true;
      } catch (e) { get().showToast(errorMessage(e), undefined, 'error'); return false; }
    },

    enterApp: () => { writeFlag(STORAGE_KEYS.spaced); set({ phase: 'app' }); },

    /** A `hermod://join/<code>` link arrived: open the join flow (immediately inside the app, after the gates otherwise). */
    onDeeplink: (code) => {
      set({ pendingCode: code });
      if (get().phase === 'app') get().openModal({ kind: 'join', code });
    },

    setNode: (node) => set({ node }),
    setSync: (syncPending) => set({ syncPending }),
    setBlocked: (ids) => set({ blocked: Object.fromEntries(ids.map((i) => [i, true as const])) }),
  };
};
