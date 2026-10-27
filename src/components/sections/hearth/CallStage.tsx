'use client';
import { COPY } from '@/config/copy';
import { TILE_COLS } from '@/config/ui';
import { useMediaRt } from '@/state/mediaRt';
import { ringOf } from '@/state/vm/css';
import { useViewModel } from '@/state/useViewModel';
import { Agenda } from './Agenda';
import { Notes } from './Notes';
import { Tile } from './Tile';
import s from './hearth.module.css';

/** In-call stage: tile grid, controls and (for meetings) the agenda + notes side panel. */
export function CallStage() {
  const vm = useViewModel();
  const recordingBy = useMediaRt((x) => x.recordingBy);
  const hands = useMediaRt((x) => x.hands);
  if (!vm.ready || !vm.call) return null;
  const hand = !!hands[vm.meId];
  const recording = !!vm.meId && recordingBy.includes(vm.meId);
  const { call } = vm;
  const round = (bd: string, bg: string, fg: string) => ({ borderColor: bd, background: bg, color: fg });
  return (
    <div className={s.call}>
      <div className={s.stage}>
        <div className={s.head}>
          <div className={s.headMain}>
            <div className={s.callKicker}>{call.kicker}</div>
            <h2 className={s.callTitle}>{call.title}</h2>
          </div>
          <div className={s.clock}><div className={s.elapsed}>{call.elapsed}</div>{recordingBy.length > 0 && <span className={s.rec} role="status">{COPY.ui.panel.sections.callRec}</span>}{COPY.ui.panel.sections.callSpeaking(call.speakingName)}</div>
        </div>
        <div className={s.tiles} data-stage={vm.stageBig ? 'big' : 'small'} style={{ gridTemplateColumns: vm.stageBig ? TILE_COLS.one : vm.tileCols }}>
          {vm.tiles.map((t) => <Tile key={t.id} t={t} micOff={vm.icS.micOff} />)}
        </div>
        <div role="status" aria-live="polite" className={s.sr}>{COPY.ui.panel.sections.callInRoom(vm.tiles.map((t) => t.name).join(', '))}</div>
        <div className={s.controls}>
          <button type="button" className={s.ctl} onClick={vm.toggleMute} aria-label={call.micLabel} title={COPY.ui.panel.sections.callMicTitle(call.micLabel)} style={round(call.micBd, call.micBg, call.micFg)}>{call.micIcon}</button>
          <button type="button" className={s.ctl} onClick={vm.toggleCam} aria-label={call.camLabel} title={call.camLabel} style={round(call.camBd, call.camBg, call.camFg)}>{call.camIcon}</button>
          <button type="button" className={s.ctl} onClick={vm.toggleShare} aria-label={call.shareLabel} title={call.shareLabel} style={round(call.shareBd, 'transparent', call.shareFg)}>{vm.icL.share}</button>
          <button type="button" className={s.ctl} onClick={vm.toggleHand} aria-pressed={hand} aria-label={hand ? COPY.lowerHand : COPY.raiseHand} title={hand ? COPY.lowerHand : COPY.raiseHand} style={round(ringOf(hand), 'transparent', 'inherit')}>✋</button>
          {vm.reactions.map((r) => <button key={r} type="button" className={s.ctl} onClick={() => vm.react(r)} aria-label={COPY.reactLabel(r)}>{r}</button>)}
          <button type="button" className={s.pill} onClick={vm.toggleStage} aria-pressed={vm.stageBig}>{vm.stageBig ? COPY.stageSmall : COPY.stageBig}</button>
          <button type="button" className={s.pill} onClick={vm.toggleRecord}>{recording ? COPY.ui.panel.sections.callStopRecording : COPY.ui.panel.sections.callRecord}</button>
          {call.notMeeting && <button type="button" className={`${s.pill} ${s.meet}`} onClick={vm.makeMeeting}>{vm.ic.calendar} {COPY.ui.panel.sections.callMakeMeeting}</button>}
          <button type="button" className={`${s.pill} ${s.leave}`} onClick={vm.leave}>{vm.ic.leave} {COPY.ui.panel.sections.callLeave}</button>
        </div>
      </div>
      {call.meeting && (
        <aside className={s.side}>
          <Agenda items={vm.agenda} done={vm.agendaDone} total={vm.agendaTotal} />
          <div className={s.rule}></div>
          <Notes notes={vm.notes} elapsed={call.meetElapsed} draft={vm.noteDraft} onDraft={vm.onNoteDraft} onKey={vm.onNoteKey} />
        </aside>
      )}
    </div>
  );
}
