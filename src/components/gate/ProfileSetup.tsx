'use client';
import { useState, type FormEvent } from 'react';
import { COPY } from '@/config/copy';
import { initialsOf } from '@/state/selectors';
import { PhraseRestore } from './PhraseRestore';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

/** Name and bio, published to your Spaces as your profile. */
export function ProfileSetup() {
  const c = COPY.ui.shell.gate.profile;
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
        <div className={s.kicker}>{c.kicker}</div>
        <h1 id="ps-title" className={s.title}>{c.title}</h1>
        <p className={s.lead}>{c.lead}</p>
      </div>
      <form onSubmit={submit} className={s.panel}>
        <div className={s.row}>
          <div className={s.preview} aria-hidden="true">{name.trim() ? initialsOf(name) : '?'}</div>
          <div className={s.field} style={{ flex: 1 }}>
            <label className={s.label} htmlFor="ps-name">{c.name}</label>
            <input id="ps-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} autoFocus />
          </div>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="ps-bio">{c.bio}</label>
          <textarea id="ps-bio" className="input" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} />
        </div>
        <div className={s.actions}><button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>{c.continue}</button></div>
      </form>
      <PhraseRestore />
    </main>
  );
}
