'use client';
import { useState, type FormEvent } from 'react';
import f from '@/components/ui/form.module.css';
import { seatName } from '@/state/vm/arcade';
import { WORD_LEN, commitWord, loadWord } from '../../actions';
import { myTurn, type RendererProps } from '../types';
import s from '../../arcade.module.css';

interface Guess { word: string; fb: string | null }
interface WState { phase: 'commit' | 'play' | 'reveal' | 'done'; committed: boolean[]; guesses: Guess[][]; revealed: (string | null)[]; maxGuesses: number; wordLen: number; actor: number | null }

function Rows({ guesses, max }: { guesses: Guess[]; max: number }) {
  return (
    <div className={s.wRows}>
      {Array.from({ length: max }, (_, r) => {
        const g = guesses[r];
        return (
          <div key={r} className={s.wRow}>
            {Array.from({ length: WORD_LEN }, (__, c) => (
              <span key={c} className={`${s.wTile} ${g?.fb ? s[`wf${g.fb[c]}` as 'wf0'] : ''}`} aria-label={g ? `${g.word[c]}, ${g.fb ? ['absent', 'elsewhere', 'correct'][Number(g.fb[c])] : 'waiting for feedback'}` : 'empty'}>{g?.word[c] ?? ''}</span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Word duel: both players seal a word (hash in the log, word on this device), then guess each other's. Feedback is answered automatically by the owner's device. */
export default function WordDuelGame({ game, space, seed, seat, move }: RendererProps) {
  const st = game.state as unknown as WState;
  const [word, setWord] = useState('');
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const secret = seat >= 0 ? loadWord(space, game.id) : null;
  const valid = (w: string) => /^[a-z]{5}$/.test(w);

  const seal = async (e: FormEvent) => { e.preventDefault(); if (!valid(word) || busy) return; setBusy(true); await commitWord(space, game, word); setBusy(false); };
  const send = async (e: FormEvent) => { e.preventDefault(); if (!valid(guess) || busy) return; setBusy(true); const ok = await move({ guess }); setBusy(false); if (ok) setGuess(''); };
  const mineToGuess = myTurn(game, seat) && st.actor === seat && !(st.guesses[1 - seat]?.at(-1)?.fb === null) && !(st.guesses[seat]?.at(-1)?.fb === null);

  if (st.phase === 'commit') {
    return (
      <div className={s.formCol} style={{ width: '100%', maxWidth: 360 }}>
        {seat >= 0 && !st.committed[seat] ? (
          <form className={s.formCol} onSubmit={(e) => { void seal(e); }} data-testid="wd-seal">
            <div className={f.field}>
              <label className={f.label} htmlFor="wd-word">Your secret word (5 letters, a to z)</label>
              <input id="wd-word" className="input" value={word} maxLength={5} autoComplete="off" spellCheck={false} onChange={(e) => setWord(e.target.value.toLowerCase())} data-testid="wd-word" />
            </div>
            <p className={f.note}>Only a hash of the word is shared. You reveal it at the end; if it does not match, you forfeit.</p>
            <button type="submit" className="btn btn-primary" disabled={!valid(word) || busy} data-testid="wd-seal-btn">Seal word</button>
          </form>
        ) : <p className={s.empty}>{seat >= 0 ? 'Word sealed. Waiting for your opponent.' : 'Waiting for both players to seal a word.'}</p>}
      </div>
    );
  }
  const names = game.seats.map((u) => seatName(seed, u));
  const view = [seat >= 0 ? seat : 0, seat >= 0 ? 1 - seat : 1];
  return (
    <div className={s.stage}>
      <div className={s.wCols}>
        {view.map((owner, idx) => (
          <div key={owner} className={s.wCol}>
            <span className={s.wLabel}>{idx === 0 && seat >= 0 ? 'Your guesses at' : 'Guesses at'} {idx === 0 && seat >= 0 ? names[1 - seat] : names[1 - owner]}</span>
            <Rows guesses={st.guesses[owner] ?? []} max={st.maxGuesses} />
          </div>
        ))}
      </div>
      {st.phase === 'play' && seat >= 0 && (
        <form className={s.bar} onSubmit={(e) => { void send(e); }}>
          <label className={s.sr} htmlFor="wd-guess">Your guess</label>
          <input id="wd-guess" className="input" style={{ width: 140 }} value={guess} maxLength={5} autoComplete="off" spellCheck={false} disabled={!mineToGuess} onChange={(e) => setGuess(e.target.value.toLowerCase())} data-testid="wd-guess" />
          <button type="submit" className="btn btn-primary" disabled={!mineToGuess || !valid(guess) || busy} data-testid="wd-send">Guess</button>
        </form>
      )}
      {st.phase === 'play' && secret && <p className={s.cardMeta}>Your word: <b>{secret.word}</b>. Feedback for your opponent&apos;s guesses is answered automatically.</p>}
      {st.phase === 'reveal' && <p className={s.cardMeta}>Revealing words and checking every answer.</p>}
      {st.phase === 'done' && st.revealed.some(Boolean) && <p className={s.cardMeta}>Words: {st.revealed.map((w, i) => `${names[i]}: ${w ?? '?'}`).join(', ')}</p>}
    </div>
  );
}
