import type { StateCreator } from 'zustand';
import { TIMING } from '../../config/app';
import { MEDIA } from '../../config/media';
import { useMediaRt } from '../mediaRt';
import { getBridge } from '../../lib/bridge';
import { activeCall, mediaBridgeFrom, saveRecording, toMediaError } from '../../lib/media';
import { COPY } from '../../config/copy';
import { appendEvent } from '../act';
import { curSpace, meId, roomMeeting } from '../selectors';
import { timer } from '../timers';
import type { AppStore, CallSlice } from '../types';

export const createCallSlice: StateCreator<AppStore, [], [], CallSlice> = (set, get) => {
  const room = (body: Parameters<typeof appendEvent>[2]) => appendEvent(get, get().call?.space ?? get().space, body);

  /** Stops the running recording and saves it through the system dialog. The file is also kept in the blob store. */
  const storeRecording = async () => {
    const session = activeCall(); if (!session) return;
    try {
      const rec = await session.stopRecording();
      const bridge = getBridge();
      const blob = await saveRecording(mediaBridgeFrom(bridge), rec, 'hearth-recording');
      // Only the desktop shell has a save dialog; elsewhere the recording stays in the blob store.
      const where = bridge.kind === 'tauri' ? await bridge.blobSaveAs(blob.hash, blob.name) : null;
      get().showToast(where ? COPY.recordingSaved : COPY.recordingKept);
    } catch (e) { get().showToast(toMediaError(e).message, undefined, 'error'); }
  };
  /** Runs a device change; on failure reverts the flag and says why (a cancelled screen picker is silent). */
  const device = async (flag: 'cam' | 'share', on: boolean, run: () => Promise<void> | undefined) => {
    try { await run(); } catch (e) {
      get().setCall({ [flag]: !on });
      const err = toMediaError(e);
      if (!(flag === 'share' && err.code === 'permission-denied')) get().showToast(err.message, undefined, 'error');
      return false;
    }
    return true;
  };

  const SIG = MEDIA.call.signal; const REACTIONS: readonly string[] = SIG.reactions;
  /** Ephemeral room signal to everyone in the space; peers filter by room. Droppable by design. */
  const signal = (p: { hand?: boolean; react?: string }) => {
    const c = get().call; if (!c) return;
    void getBridge().sendEphemeral(c.space, SIG.kind, { room: c.room, ...p }).catch(() => { /* a dropped signal is harmless */ });
  };
  const drop = <T,>(m: Record<string, T>, id: string) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id));
  const setHand = (who: string, on: boolean) => useMediaRt.setState((x) => ({ hands: on ? { ...x.hands, [who]: true } : drop(x.hands, who) }));
  const showReaction = (who: string, r: string) => {
    useMediaRt.setState((x) => ({ reactions: { ...x.reactions, [who]: r } }));
    timer.after(`react:${who}`, SIG.reactionMs, () => useMediaRt.setState((x) => ({ reactions: drop(x.reactions, who) })));
  };

  return {
    call: null, speaking: null, stageBig: false, now: 0, noteDraft: '',

    join: async (sp, roomId = '') => {
      if (get().call) await get().leave();
      if (!(await appendEvent(get, sp, { t: 'room.join', room: roomId }))) return;
      set({
        call: { space: sp, room: roomId, at: Date.now(), muted: false, cam: false, share: false },
        space: sp, ...(roomId ? {} : { section: 'hearth' as const, overview: false }),
      });
    },
    joinRoom: () => get().join(get().space),

    makeMeeting: async () => {
      const s = get(); if (!s.call) return;
      const v = await s.ask({
        title: COPY.ui.stateMsgs.meeting.title, kicker: curSpace(s).name, submit: COPY.ui.stateMsgs.meeting.submit,
        fields: [
          { key: 'topic', label: COPY.ui.stateMsgs.common.topic, placeholder: COPY.ui.stateMsgs.meeting.topicPh, required: true },
          { key: 'agenda', label: COPY.ui.stateMsgs.meeting.agendaLabel, placeholder: COPY.ui.stateMsgs.meeting.agendaPh, multiline: true },
        ],
      });
      if (!v) return;
      const who = meId(s);
      const agenda = v.agenda.split('\n').map((t) => t.trim()).filter(Boolean).map((text) => ({ text, who }));
      if (await room({ t: 'meeting.start', topic: v.topic.trim(), agenda })) get().showToast(COPY.meetingStarted);
    },

    leave: async () => {
      const s = get(); const call = s.call; if (!call) return;
      if (activeCall()?.isRecording) await storeRecording();
      const meeting = !!s.seed && !!roomMeeting(s.seed, call.space);
      if (meeting) await room({ t: 'meeting.end' });
      if (useMediaRt.getState().hands[meId(s) ?? '']) signal({ hand: false });
      await room({ t: 'room.leave', room: get().call?.room ?? '' });
      useMediaRt.setState({ hands: {}, reactions: {} });
      set({ call: null, speaking: null });
      s.showToast(meeting ? COPY.meetingSaved : COPY.leftHearth);
    },

    setCall: (patch) => set((s) => (s.call ? { call: { ...s.call, ...patch } } : {})),
    toggleMute: async () => {
      const on = !get().call?.muted; get().setCall({ muted: on });
      activeCall()?.setMuted(on);
      await room({ t: 'room.state', room: get().call?.room ?? '', muted: on });
    },
    toggleCam: async () => {
      const on = !get().call?.cam; get().setCall({ cam: on });
      if (!(await device('cam', on, () => activeCall()?.setCamera(on)))) return;
      await room({ t: 'room.state', room: get().call?.room ?? '', cam: on });
    },
    toggleShare: async () => {
      const on = !get().call?.share; get().setCall({ share: on });
      if (!(await device('share', on, () => activeCall()?.setScreenShare(on)))) return;
      await room({ t: 'room.state', room: get().call?.room ?? '', share: on });
    },
    toggleRecord: async () => {
      const session = activeCall(); if (!session) return;
      if (session.isRecording) { await storeRecording(); return; }
      try { await session.startRecording(); } catch (e) { get().showToast(toMediaError(e).message, undefined, 'error'); }
    },
    toggleHand: async () => {
      const me = meId(get()); if (!me || !get().call) return;
      const on = !useMediaRt.getState().hands[me];
      setHand(me, on); signal({ hand: on });
    },
    callReact: async (r) => {
      const me = meId(get()); if (!me || !get().call || !REACTIONS.includes(r)) return;
      showReaction(me, r); signal({ react: r });
    },
    noteHearthSignal: (from, space, p) => {
      const c = get().call; if (!c || c.space !== space || from === meId(get()) || (p.room ?? '') !== c.room) return;
      if (typeof p.hand === 'boolean') setHand(from, p.hand);
      if (typeof p.react === 'string' && REACTIONS.includes(p.react)) showReaction(from, p.react);
    },
    toggleStage: () => set((s) => ({ stageBig: !s.stageBig })),

    toggleAgendaItem: async (i) => { await room({ t: 'agenda.toggle', idx: i }); },

    setNoteDraft: (noteDraft) => set({ noteDraft }),
    addNote: async () => {
      const text = get().noteDraft.trim(); if (!text) return;
      set({ noteDraft: '' });
      if (!(await room({ t: 'note.add', text }))) set({ noteDraft: text });
    },

    tickNow: () => set({ now: Date.now() }),
    setSpeaking: (speaking) => set({ speaking }),
    returnToCall: () => { const c = get().call; if (c) set({ space: c.space, section: 'hearth', overview: false }); },
    backToCall: () => {
      const s = get(); const c = s.call;
      if (!c) return;
      if (c.space !== s.space) {
        set({ space: c.space, section: 'hearth' });
        timer.after('backToCall', TIMING.openRookDelayMs, () => get().enterBuilding('hearth'));
      } else s.enterBuilding('hearth');
    },
  };
};
