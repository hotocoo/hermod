'use client';
import { useState } from 'react';
import { ICEBREAKERS } from '@/config/arcade';
import { useAppStore } from '@/state/store';
import { postIcebreaker } from '../actions';
import s from '../arcade.module.css';

/** Prompt list is product copy; posting one sends it to the space's main channel as a normal message. */
export function Icebreakers({ space }: { space: string }) {
  const channel = useAppStore((st) => st.seed?.spaces.find((x) => x.id === space)?.defaultChannel ?? '');
  const toast = useAppStore((st) => st.showToast);
  const [i, setI] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0] % ICEBREAKERS.length);
  const post = async () => { if (channel && await postIcebreaker(space, channel, ICEBREAKERS[i])) toast('Posted to the channel'); };
  return (
    <div className={s.stage} style={{ maxWidth: 520, margin: '0 auto' }}>
      <p className={s.bigQ} data-testid="icebreaker">{ICEBREAKERS[i]}</p>
      <div className={s.bar}>
        <button type="button" className="btn btn-secondary" onClick={() => setI((x) => (x + 1) % ICEBREAKERS.length)}>Another</button>
        <button type="button" className="btn btn-primary" disabled={!channel} onClick={() => { void post(); }}>Post to channel</button>
      </div>
    </div>
  );
}
