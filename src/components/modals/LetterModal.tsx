'use client';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { COPY } from '@/config/copy';
import { channelsOf } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import f from '@/components/ui/form.module.css';

/** Write a raven letter to a channel of another Space you belong to (R-005). */
export function LetterModal() {
  const st = useAppStore();
  const targets = st.spaces.filter((sp) => sp.id !== st.space);
  const [to, setTo] = useState(targets[0]?.id ?? '');
  const channels = st.seed && to ? channelsOf(st.seed, to) : [];
  const [chosen, setChosen] = useState('');
  const channel = channels.some((c) => c.id === chosen) ? chosen : (channels[0]?.id ?? '');
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const target = targets.find((sp) => sp.id === to);
  const ready = !!target && !!channel && text.trim().length > 0 && !busy;
  const send = async () => {
    if (!ready || !target) return;
    setBusy(true);
    const ok = await st.sendLetter(to, channel, text.trim());
    setBusy(false);
    if (ok) { st.closeModal(); st.showToast(COPY.letter.sent(target.name)); }
  };
  return (
    <Dialog title={COPY.letter.title} kicker={COPY.letter.kicker} onClose={st.closeModal} initialFocus="#lt-text">
      {targets.length === 0 ? <p className={f.note}>{COPY.letter.noSpaces}</p> : (
        <div className={f.field}>
          <label className={f.label} htmlFor="lt-to">{COPY.letter.to}</label>
          <select id="lt-to" className="input" value={to} onChange={(e) => { setTo(e.target.value); setChosen(''); }}>{targets.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}</select>
          <label className={f.label} htmlFor="lt-ch">{COPY.letter.channel}</label>
          <select id="lt-ch" className="input" value={channel} onChange={(e) => setChosen(e.target.value)} disabled={channels.length === 0}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          {channels.length === 0 && <p className={f.note}>{COPY.letter.noChannels}</p>}
          <label className={f.label} htmlFor="lt-text">{COPY.letter.text}</label>
          <textarea id="lt-text" className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          <div className={f.actions}>
            <button type="button" className="btn btn-secondary" onClick={st.closeModal}>{COPY.letter.cancel}</button>
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => { void send(); }}>{COPY.letter.send}</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
