'use client';
import { useState, type FormEvent } from 'react';
import { COPY } from '@/config/copy';
import { PHRASE_WORDS } from '@/config/app';
import { errorMessage, getBridge } from '@/lib/bridge';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Restore the identity from a recovery phrase. On a fresh install it runs at once; with
 * `startOver` (the recovery screen, where the install may hold another identity) it first asks
 * the same destructive confirmation as Start over, then wipes, then restores.
 */
export function PhraseRestore({ startOver = false }: { startOver?: boolean }) {
  const confirm = useAppStore((x) => x.confirmAction);
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (startOver && !(await confirm({ title: COPY.recoverResetTitle, body: COPY.recoverResetBody, confirm: COPY.recoverResetConfirm, danger: true, typed: COPY.recoverResetTyped }))) return;
      if (startOver) await getBridge().appReset();
      await getBridge().identityRestorePhrase(phrase);
      setPhrase('');
      await useAppStore.getState().boot();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };

  if (!open) return <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>{COPY.restorePhraseShow}</button>;
  return (
    <form onSubmit={submit} className={s.panel} aria-labelledby="pr-title">
      <h2 id="pr-title" style={{ fontSize: 20 }}>{COPY.restorePhraseTitle}</h2>
      <p className={s.lead}>{COPY.restorePhraseNote}</p>
      {startOver && <p className={s.lead}>{COPY.restorePhraseReset}</p>}
      <div className={s.field}>
        <label className={s.label} htmlFor="pr-phrase">{COPY.restorePhraseLabel}</label>
        <textarea id="pr-phrase" className="input" rows={3} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <div className={s.actions}>
        <button type="submit" className="btn btn-primary" disabled={busy || wordCount(phrase) !== PHRASE_WORDS}>{COPY.restorePhraseSubmit}</button>
      </div>
    </form>
  );
}
