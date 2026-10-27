'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { COPY } from '@/config/copy';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

const KINDS = ['Team', 'Community', 'Friends'] as const;

/** Accepts the full link (`...join#<code>`), `hermod://join/<code>` or the bare code. */
export function parseInviteCode(input: string): string {
  const t = input.trim();
  const hash = t.indexOf('#');
  if (hash >= 0) return t.slice(hash + 1).trim();
  if (/^hermod:\/\//i.test(t)) return t.replace(/\/+$/, '').split('/').pop() ?? '';
  return t;
}

export function CreateSpaceForm({ onDone }: { onDone: () => void }) {
  const create = useAppStore((x) => x.createSpace);
  const [name, setName] = useState(''); const [tagline, setTagline] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('Team'); const [busy, setBusy] = useState(false);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    if (await create(name, tagline, kind)) onDone();
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className={s.panel}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-n`}>{COPY.ui.shell.gate.space.name}</label>
        <input id={`${id}-n`} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-t`}>{COPY.ui.shell.gate.space.tagline}</label>
        <input id={`${id}-t`} className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} autoComplete="off" />
      </div>
      <fieldset className={s.group}>
        <legend className={s.legend}>{COPY.ui.shell.gate.space.kind}</legend>
        <div className="seg">
          {KINDS.map((k) => (
            <label key={k} className="seg-opt"><input type="radio" name={`${id}-k`} checked={kind === k} onChange={() => setKind(k)} />{COPY.ui.shell.gate.space.kinds[k]}</label>
          ))}
        </div>
      </fieldset>
      <div className={s.actions}><button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>{COPY.ui.shell.gate.space.create}</button></div>
    </form>
  );
}

export function JoinForm({ initial, onDone, focus }: { initial?: string; onDone: () => void; focus?: boolean }) {
  const join = useAppStore((x) => x.joinSpace);
  const cancel = useAppStore((x) => x.cancelJoin);
  const joining = useAppStore((x) => x.joining);
  const [value, setValue] = useState(initial ?? ''); const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { if (focus || initial) ref.current?.focus(); }, [focus, initial]);
  const code = parseInviteCode(value);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code) return;
    setBusy(true);
    if (await join(code)) onDone();
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className={s.panel}>
      <div className={s.field}>
        <label className={s.label} htmlFor={`${id}-c`}>{COPY.ui.shell.gate.space.inviteField}</label>
        <input id={`${id}-c`} ref={ref} className="input" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <p className={s.note}>{COPY.ui.shell.gate.space.noDirectory}</p>
      {joining && <p role="status" className={s.note}>{COPY.joinWorking}</p>}
      <div className={s.actions}>
        {joining && <button type="button" className="btn btn-secondary" onClick={() => void cancel()}>{COPY.joinCancel}</button>}
        <button type="submit" className="btn btn-primary" disabled={!code || busy}>{COPY.joinSpace}</button>
      </div>
    </form>
  );
}
