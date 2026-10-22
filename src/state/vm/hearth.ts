import { SYSTEM_ID } from '../../config/app';
import { COPY } from '../../config/copy';
import { MEDIA } from '../../config/media';
import { TILE_COLS } from '../../config/ui';
import { anim, dur, firstName } from '../../lib/format';
import { coll } from '../dataTypes';
import { meId, personOf, roomCount, roomOf, roomPeople, speakingId, inCallHere } from '../selectors';
import type { InputEvt, KeyEvt } from '../types';
import type { Ctx } from './context';
import { ACCENT, ACCENT_100, ACCENT_700, ACCENT_800, DIVIDER, TEXT, ringOf, mixAccent, mixText } from './css';

export function hearthVm(x: Ctx) {
  const { s, seed, I } = x; const me = meId(s); const P = (id: string) => personOf(seed, id);
  const call = s.call; const room = roomOf(seed, s.space); const inCall = inCallHere(s);
  const people = roomPeople(s, seed); const speaking = speakingId(s);
  const tilesAll = people.map((p, i) => {
    const mine = p === me;
    const cam = mine ? !!(call && call.cam) : !!(room && room.cams[p]);
    const muted = mine ? !!(call && call.muted) : !!room?.muted?.[p];
    const share = mine ? !!(call && call.share) : !!room?.share?.[p];
    const spk = p === speaking;
    return {
      id: p, name: mine ? 'You' : P(p).name, first: mine ? 'You' : firstName(P(p).name), initials: P(p).i, av: P(p).av ?? '', isMe: mine, cam, share, noCam: !cam && !share, speaking: spk, muted,
      ring: spk ? ACCENT : 'transparent',
      glow: spk ? `0 0 0 1px ${ACCENT}, 0 0 32px ${mixAccent(35)}` : `0 0 0 1px ${DIVIDER}`,
      scale: spk ? '1.04' : '1', anim: anim(i, 'hm-scale'),
      label: share ? `screen · ${mine ? 'you' : firstName(P(p).name).toLowerCase()}` : cam ? `camera · ${mine ? 'you' : firstName(P(p).name).toLowerCase()}` : '',
    };
  });
  // A shared screen is the spotlight: it leads the grid and spans the full row.
  const tiles = [...tilesAll.filter((t) => t.share), ...tilesAll.filter((t) => !t.share)];
  const faces = room ? room.inRoom.map((p) => ({ initials: P(p).i, av: P(p).av ?? '', name: P(p).name, first: p === me ? 'You' : firstName(P(p).name), speaking: p === speaking, ring: ringOf(p === speaking) })) : [];
  const count = roomCount(room);
  const full = count >= MEDIA.call.maxParticipants;
  const hearth = room ? {
    name: room.name, topic: room.topic, count, full, fullLine: full ? COPY.hearthFull(MEDIA.call.maxParticipants) : '', empty: count === 0, notEmpty: count > 0,
    line: count === 0 ? 'Nobody’s here yet. Pull up a chair and the room will light up.' : (count === 1 ? 'One person by the fire.' : `${count} people by the fire. Drop in, no invite needed.`),
    extra: room.extra ? `+${room.extra}` : '', hasExtra: !!room.extra, faces,
  } : null;

  const cRoom = call ? roomOf(seed, call.space) : null;
  const meeting = cRoom?.meeting ?? null;
  const callV = call ? (() => {
    const cSpace = s.spaces.find((sx) => sx.id === call.space);
    const title = meeting ? meeting.topic : (cRoom?.name ?? '');
    const sw = (on: boolean) => ({ bg: on ? ACCENT_100 : 'transparent', bd: on ? ACCENT : DIVIDER, fg: on ? ACCENT_800 : TEXT });
    return {
      space: cSpace?.name ?? '', room: cRoom?.name ?? '', elapsed: dur(s.now - call.at), meetElapsed: meeting ? dur(s.now - meeting.at) : '00:00',
      muted: call.muted, cam: call.cam, share: call.share, meeting: !!meeting, notMeeting: !meeting,
      title, kicker: meeting ? 'Meeting' : 'Drop-in room',
      micIcon: call.muted ? I('micOff', 20, 1.6) : I('mic', 20, 1.6), camIcon: call.cam ? I('video', 20, 1.6) : I('videoOff', 20, 1.6),
      micBg: sw(call.muted).bg, micBd: sw(call.muted).bd, micFg: sw(call.muted).fg,
      camBg: sw(!call.cam).bg, camBd: sw(!call.cam).bd, camFg: sw(!call.cam).fg,
      shareBd: ringOf(call.share), shareFg: call.share ? ACCENT_700 : TEXT,
      micLabel: call.muted ? 'Unmute' : 'Mute', camLabel: call.cam ? 'Camera off' : 'Camera on', shareLabel: call.share ? 'Stop sharing' : 'Share screen',
      speakingName: speaking ? (speaking === me ? 'You' : firstName(P(speaking).name)) : '', away: call.space !== s.space || s.section !== 'hearth',
    };
  })() : null;

  const agendaRaw = meeting ? coll(seed, 'agenda') : [];
  const agenda = agendaRaw.map((a, i) => ({
    text: a.text, who: firstName(P(a.who).name), done: a.done, cur: a.cur && !a.done, n: i + 1,
    mark: a.done ? I('check', 12, 2.4) : null, bd: a.done || a.cur ? ACCENT : DIVIDER, bg: a.done ? ACCENT : 'transparent',
    fg: a.done ? mixText(50) : TEXT, strike: a.done ? 'line-through' : 'none', onToggle: () => { void s.toggleAgendaItem(i); },
  }));
  const notes = (meeting?.notes ?? []).map((n) => ({
    text: n.text, t: n.t, name: n.by === SYSTEM_ID ? P(SYSTEM_ID).name : firstName(P(n.by).name), isSystem: n.by === SYSTEM_ID, anim: anim(0, 'hm-rise'),
  }));
  const meetingView = inCall && !!meeting && s.section === 'hearth';
  const spot = tiles.find((t) => t.share) ?? tiles.find((t) => t.speaking) ?? tiles[0] ?? null;

  return {
    hasRoom: !!room, hearth, inCall, notInCall: !inCall, joinRoom: () => { void s.joinRoom(); }, tiles, tileCount: tiles.length,
    tileCols: tiles.length <= 1 ? TILE_COLS.one : (tiles.length <= 4 ? TILE_COLS.two : TILE_COLS.three),
    call: callV, hasCall: !!callV, callAway: !!(callV && callV.away), returnToCall: s.returnToCall,
    toggleMute: () => { void s.toggleMute(); }, toggleCam: () => { void s.toggleCam(); }, toggleShare: () => { void s.toggleShare(); }, toggleRecord: () => { void s.toggleRecord(); },
    toggleHand: () => { void s.toggleHand(); }, react: (r: string) => { void s.callReact(r); }, reactions: MEDIA.call.signal.reactions,
    makeMeeting: () => { void s.makeMeeting(); }, leave: () => { void s.leave(); },
    stageBig: s.stageBig, stageSmall: !s.stageBig, toggleStage: s.toggleStage,
    agenda, notes, hasNotes: notes.length > 0, noteDraft: s.noteDraft, onNoteDraft: (e: InputEvt) => s.setNoteDraft(e.target.value),
    onNoteKey: (e: KeyEvt) => { if (e.key === 'Enter') { e.preventDefault(); void s.addNote(); } }, addNote: () => { void s.addNote(); },
    agendaDone: agendaRaw.filter((a) => a.done).length, agendaTotal: agendaRaw.length,
    // consumed by the layout block
    spot, hasSpot: !!spot, strip: tiles.filter((t) => t !== spot), stripCount: Math.max(0, tiles.length - 1), isMeetingView: meetingView,
  };
}
