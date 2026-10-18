'use client';
import { useState, type FormEvent } from 'react';
import { initialsOf } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

/** Name and bio, published to your Spaces as your profile. */
export function ProfileSetup() {
  const save = useAppStore((x) => x.saveProfile);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    if (await save(name, bio)) await useAppStore.getState().boot();
    setBusy(false);
  };
  return (
    <main className={s.screen} aria-labelledby="ps-title">
      <div>
        <div className={s.kicker}>Who are you</div>
        <h1 id="ps-title" className={s.title}>Tell people your name</h1>
        <p className={s.lead}>This is shown to the members of Spaces you join. You can change it any time.</p>
      </div>
      <form onSubmit={submit} className={s.panel}>
        <div className={s.row}>
          <div className={s.preview} aria-hidden="true">{name.trim() ? initialsOf(name) : '?'}</div>
          <div className={s.field} style={{ flex: 1 }}>
            <label className={s.label} htmlFor="ps-name">Name (required)</label>
            <input id="ps-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} autoFocus />
          </div>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="ps-bio">Bio</label>
          <textarea id="ps-bio" className="input" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} />
        </div>
        <div className={s.actions}><button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>Continue</button></div>
      </form>
    </main>
  );
}
