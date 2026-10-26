'use client';
import { useState, type FormEvent } from 'react';
import { COPY } from '@/config/copy';
import { errorMessage, getBridge } from '@/lib/bridge';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

/** Shown at startup when the secret key is sealed with a passphrase; boot resumes once it opens. */
export function UnlockScreen() {
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await getBridge().identityUnlock(pass);
      await useAppStore.getState().boot();
    } catch (err) { setError(errorMessage(err)); }
    setBusy(false);
  };
  return (
    <main className={s.screen} aria-labelledby="ul-title">
      <div>
        <div className={s.kicker}>{COPY.unlockKicker}</div>
        <h1 id="ul-title" className={s.title}>{COPY.unlockTitle}</h1>
        <p className={s.lead}>{COPY.unlockLead}</p>
      </div>
      <form onSubmit={submit} className={s.panel}>
        <div className={s.field}>
          <label className={s.label} htmlFor="ul-pass">{COPY.unlockLabel}</label>
          <input id="ul-pass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" autoFocus />
        </div>
        {error && <p role="alert" className={s.error}>{error}</p>}
        <div className={s.actions}><button type="submit" className="btn btn-primary" disabled={!pass || busy}>{COPY.unlockSubmit}</button></div>
      </form>
    </main>
  );
}
