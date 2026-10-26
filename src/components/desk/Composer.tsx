'use client';
import { useState } from 'react';
import { errorMessage, type BlobRef } from '@/lib/bridge';
import { pickAndStore } from '@/lib/upload';
import type { DeskMacro } from '@/state/deskTypes';
import { useAppStore } from '@/state/store';
import { COPY } from '@/config/copy';
import { Atts } from './Conversation';
import s from './desk.module.css';
import { MacroMenu } from './MacroMenu';

interface Props {
  agent: boolean; closed: boolean; internal: boolean; macros: DeskMacro[];
  onInternal: (on: boolean) => void; onSend: (body: string, internal: boolean, att: BlobRef[]) => Promise<boolean>; onMacro: (m: DeskMacro) => void;
}

/** Reply box. Agents switch between a public reply and an internal note; guests can only reply publicly. */
export function Composer({ agent, closed, internal, macros, onInternal, onSend, onMacro }: Props) {
  const [text, setText] = useState('');
  const [att, setAtt] = useState<BlobRef[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useAppStore((st) => st.showToast);
  if (closed && !agent) return <div className={s.composer}><span className={s.hint}>{COPY.ui.desk.composer.closed}</span></div>;
  const note = agent && internal;
  const send = async () => {
    if ((!text.trim() && !att.length) || busy) return;
    setBusy(true);
    const sent = { text, att };
    // Clear only what was sent: a draft typed while the send was in flight must survive.
    if (await onSend(text, note, att)) { setText((cur) => (cur === sent.text ? '' : cur)); setAtt((cur) => (cur === sent.att ? [] : cur)); }
    setBusy(false);
  };
  const attach = async () => {
    try { const picked = await pickAndStore('*/*', true); setAtt((a) => [...a, ...picked.map((x) => x.blob)]); } catch (e) { toast(errorMessage(e), undefined, 'error'); }
  };
  return (
    <div className={s.composer} data-testid="composer">
      {agent && (
        <div className={s.composerRow} role="group" aria-label={COPY.ui.desk.composer.replyType}>
          <button type="button" className={s.modeBtn} aria-pressed={!internal} onClick={() => onInternal(false)} data-testid="mode-reply">{COPY.ui.desk.composer.reply}</button>
          <button type="button" className={s.modeBtn} aria-pressed={internal} onClick={() => onInternal(true)} data-testid="mode-internal">{COPY.ui.desk.internalNote}</button>
          <span className={s.grow} />
          <MacroMenu macros={macros} onPick={onMacro} />
        </div>
      )}
      <textarea id="desk-composer" className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label={note ? COPY.ui.desk.internalNote : COPY.ui.desk.composer.reply}
        placeholder={note ? COPY.ui.desk.composer.onlyTeam : COPY.ui.desk.composer.placeholder} data-testid="composer-input"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
      <Atts list={att} />
      <div className={s.composerRow}>
        <button type="button" className="btn btn-secondary" onClick={() => { void attach(); }}>{COPY.ui.desk.composer.attach}</button>
        <span className={s.hint}>{COPY.ui.desk.composer.sendHint}</span>
        <span className={s.grow} />
        <button type="button" className="btn btn-primary" disabled={busy || (!text.trim() && !att.length)} onClick={() => { void send(); }} data-testid="composer-send">{note ? COPY.ui.desk.composer.addNote : COPY.ui.desk.composer.sendReply}</button>
      </div>
    </div>
  );
}
