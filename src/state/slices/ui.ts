import type { StateCreator } from 'zustand';
import type { AppStore, UiSlice } from '../types';

/** Resolvers of the open prompt and confirm dialogs, kept outside the store (functions are not state). */
let promptDone: ((v: Record<string, string> | null) => void) | null = null;
let confirmDone: ((ok: boolean) => void) | null = null;
let dialogId = 0;

export const createUiSlice: StateCreator<AppStore, [], [], UiSlice> = (set) => ({
  modal: null, prompt: null, confirm: null, listView: false,

  openModal: (modal) => set({ modal, drawer: null }),
  closeModal: () => set({ modal: null }),

  ask: (spec) => new Promise((resolve) => {
    promptDone?.(null);
    promptDone = resolve;
    set({ prompt: { ...spec, id: ++dialogId } });
  }),
  settlePrompt: (values) => { const done = promptDone; promptDone = null; set({ prompt: null }); done?.(values); },

  confirmAction: (spec) => new Promise((resolve) => {
    confirmDone?.(false);
    confirmDone = resolve;
    set({ confirm: { ...spec, id: ++dialogId } });
  }),
  settleConfirm: (ok) => { const done = confirmDone; confirmDone = null; set({ confirm: null }); done?.(ok); },

  setListView: (listView) => set({ listView }),
});
