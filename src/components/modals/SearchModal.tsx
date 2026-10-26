'use client';
import { useEffect } from 'react';
import { useAppStore } from '@/state/store';
import { hitItem } from '@/state/palette';
import { Dialog } from '@/components/ui/Dialog';
import { Hit } from '@/components/ui/Hit';
import { Icon } from '@/components/ui/Icon';
import { COPY } from '@/config/copy';
import { SEARCH_KIND_LABELS } from '@/config/ui';
import { SEARCH_MIN_CHARS } from '@/config/app';
import f from '@/components/ui/form.module.css';
import s from './SearchModal.module.css';

/** Full search results: filter by kind and Space, pick a hit to jump to its place. */
export function SearchModal() {
  const st = useAppStore();
  const { q, hits, spaces, seed, searchSpace, searchKinds, closeModal, setQ, setSearchSpace, toggleSearchKind } = st;
  // Refetch at the page's larger limit when it opens.
  useEffect(() => { setQ(q); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const short = q.trim().length < SEARCH_MIN_CHARS;
  return (
    <Dialog title={COPY.searchTitle} kicker={COPY.searchKicker} onClose={closeModal} wide initialFocus="input">
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={COPY.searchPlaceholder} aria-label={COPY.searchLabel} />
      <div className={f.row}>
        <select className="input" aria-label={COPY.searchSpaceLabel} value={searchSpace} onChange={(e) => setSearchSpace(e.target.value)}>
          <option value="">{COPY.searchAllSpaces}</option>
          {spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
        </select>
        <div className={s.chips} role="group" aria-label={COPY.searchKindsLabel}>
          {SEARCH_KIND_LABELS.map(([k, label]) => (
            <button key={k} type="button" className={`${s.chip} ${searchKinds.includes(k) ? s.chipOn : ''}`} aria-pressed={searchKinds.includes(k)} onClick={() => toggleSearchKind(k)}>{label}</button>
          ))}
        </div>
      </div>
      {short || !seed || !hits.length ? <div className={s.empty} role="status">{short ? COPY.searchHint : COPY.searchEmpty}</div> : (
        <ul className={s.list} aria-label={COPY.searchResultsLabel}>
          {hits.map((h) => {
            const it = hitItem(st, seed, h);
            return (
              <li key={`${h.kind}/${h.id}`}>
                <button type="button" className={s.hit} onClick={() => { closeModal(); it.go(); }}>
                  <span className={s.icon}><Icon name={it.icon} size={16} /></span>
                  <span className={s.text}><span className={s.label}><Hit text={it.label} q={q} /></span><span className={s.sub}><Hit text={it.sub} q={q} /></span></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
