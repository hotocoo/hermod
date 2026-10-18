'use client';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import type { Seed } from '@/lib/data/types';
import { ARCADE_LIMITS, KINDS, kindInfo } from '@/config/arcade';
import { createGame } from './actions';
import s from './arcade.module.css';

interface Props { space: string; seed: Seed; me: string; onClose: () => void; onCreated: (id: string) => void }

/** Create a table: kind, title and the options that kind has (sides, komi, seats). A named opponent seats them right away. */
export function CreateGameDialog({ space, seed, me, onClose, onCreated }: Props) {
  const uid = useId();
  const [kind, setKind] = useState<string>(KINDS[0].kind);
  const [title, setTitle] = useState('');
  const [side, setSide] = useState<'first' | 'second' | 'random'>('first');
  const [komi, setKomi] = useState('7.5');
  const [seats, setSeats] = useState(4);
  const [opponent, setOpponent] = useState('');
  const [busy, setBusy] = useState(false);
  const info = kindInfo(kind);
  const rt = typeof info.seats === 'object' ? info.seats : null;
  const members = useMemo(() => Object.entries(seed.people).filter(([id]) => id !== me && id !== 'system'), [seed, me]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const options: Record<string, unknown> = {};
    if (!rt) options.host_seat = side === 'first' ? 0 : side === 'second' ? 1 : 'random';
    if (kind === 'go9') options.komi = Number(komi);
    const players = opponent && !rt ? (side === 'second' ? [opponent, me] : [me, opponent]) : undefined;
    if (players && side === 'random') options.host_seat = 0;
    const id = await createGame(space, { kind, title, options, seats: rt ? seats : undefined, players });
    setBusy(false);
    if (id) onCreated(id);
  };

  return (
    <Dialog title="New game" kicker="The Games Hall" onClose={onClose} wide initialFocus="[data-first-kind]">
      <form className={s.formCol} onSubmit={(e) => { void submit(e); }} data-testid="create-game-form">
        <div role="radiogroup" aria-label="Game" className={s.kindGrid}>
          {KINDS.map((k, i) => (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} className={s.kindBtn} onClick={() => setKind(k.kind)}
              data-first-kind={i === 0 ? '' : undefined} data-testid={`kind-${k.kind}`}>
              <b>{k.label}</b><span>{k.blurb}</span>
            </button>
          ))}
        </div>
        <div className={f.field}>
          <label className={f.label} htmlFor={`${uid}-t`}>Title (optional)</label>
          <input id={`${uid}-t`} className="input" maxLength={ARCADE_LIMITS.titleMax} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={info.label} />
        </div>
        {!rt && (
          <div className={f.row}>
            <div className={f.field}>
              <label className={f.label} htmlFor={`${uid}-s`}>You play</label>
              <select id={`${uid}-s`} className="input" value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
                <option value="first">{info.firstName ?? 'First'} (moves first)</option>
                <option value="second">Second</option>
                {!opponent && <option value="random">Random</option>}
              </select>
            </div>
            <div className={f.field}>
              <label className={f.label} htmlFor={`${uid}-o`}>Challenge</label>
              <select id={`${uid}-o`} className="input" value={opponent} onChange={(e) => { setOpponent(e.target.value); if (e.target.value && side === 'random') setSide('first'); }}>
                <option value="">Anyone (open table)</option>
                {members.map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}
              </select>
            </div>
            {kind === 'go9' && (
              <div className={f.field}>
                <label className={f.label} htmlFor={`${uid}-k`}>Komi</label>
                <input id={`${uid}-k`} className="input" type="number" min={0} max={20} step={0.5} value={komi} onChange={(e) => setKomi(e.target.value)} style={{ width: 90 }} />
              </div>
            )}
          </div>
        )}
        {rt && (
          <div className={f.field}>
            <label className={f.label} htmlFor={`${uid}-n`}>Seats ({rt.min} to {rt.max})</label>
            <input id={`${uid}-n`} className="input" type="number" min={rt.min} max={rt.max} value={seats} onChange={(e) => setSeats(Math.min(rt.max, Math.max(rt.min, Number(e.target.value) || rt.def)))} style={{ width: 90 }} />
          </div>
        )}
        <div className={f.actions}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="create-game-submit">Open table</button>
        </div>
      </form>
    </Dialog>
  );
}
