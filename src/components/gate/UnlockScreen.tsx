'use client';
import { useState, type FormEvent } from 'react';
import { COPY } from '@/config/copy';
import { errorMessage, getBridge } from '@/lib/bridge';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Shown at startup when the secret key cannot be opened: sealed with a passphrase (type it), or
 * the keychain cannot return it (`bootError` carries why). Either way the person can restore a
 * backup or start over, so a forgotten passphrase or a lost keychain entry is never a dead end.
 */
export function UnlockScreen() {
  const keyLost = useAppStore((x) => x.bootError);
  const ask = useAppStore((x) => x.ask);
  const confirm = useAppStore((x) => x.confirmAction);
  const [pass, setPass] = useState('');
  const [backupPass, setBackupPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(errorMessage(err)); }
    setBusy(false);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => { await getBridge().identityUnlock(pass); setPass(''); await useAppStore.getState().boot(); });
  };
  const restore = () => run(async () => {
    let path: string | undefined;
    if (isTauri()) path = (await getBridge().pickFiles({ accept: ['hermodbak'] }))?.[0];
    else path = (await ask({ title: COPY.recoverRestore, submit: COPY.recoverRestore, fields: [{ key: 'p', label: COPY.recoverRestorePath, required: true }] }))?.p.trim();
    if (!path) return;
    await getBridge().backupImport(path, backupPass);
    setBackupPass('');
    await useAppStore.getState().boot();
  });
  const startOver = () => run(async () => {
    if (!(await confirm({ title: COPY.recoverResetTitle, body: COPY.recoverResetBody, confirm: COPY.recoverResetConfirm, danger: true, typed: COPY.recoverResetTyped }))) return;
    await getBridge().appReset();
    await useAppStore.getState().boot();
  });

  return (
    <main className={s.screen} aria-labelledby="ul-title">
      <div>
        <div className={s.kicker}>{COPY.unlockKicker}</div>
        <h1 id="ul-title" className={s.title}>{keyLost ? COPY.recoverTitle : COPY.unlockTitle}</h1>
        <p className={s.lead}>{keyLost ? COPY.recoverLead : COPY.unlockLead}</p>
        {keyLost && <p role="alert" className={s.error}>{keyLost}</p>}
      </div>
      {!keyLost && (
        <form onSubmit={submit} className={s.panel}>
          <div className={s.field}>
            <label className={s.label} htmlFor="ul-pass">{COPY.unlockLabel}</label>
            <input id="ul-pass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" autoFocus />
          </div>
          <div className={s.actions}><button type="submit" className="btn btn-primary" disabled={!pass || busy}>{COPY.unlockSubmit}</button></div>
        </form>
      )}
      <div className={s.panel}>
        <div className={s.field}>
          <label className={s.label} htmlFor="ul-backup-pass">{COPY.recoverRestorePass}</label>
          <input id="ul-backup-pass" type="password" className="input" value={backupPass} onChange={(e) => setBackupPass(e.target.value)} autoComplete="off" />
        </div>
        {error && <p role="alert" className={s.error}>{error}</p>}
        <div className={s.actions}>
          <button type="button" className="btn btn-secondary" disabled={busy || !backupPass} onClick={restore}>{COPY.recoverRestore}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={startOver}>{COPY.recoverReset}</button>
        </div>
      </div>
    </main>
  );
}
