import { Fragment, useEffect, useRef, type KeyboardEvent } from 'react';
import type { ViewModel } from '@/state/viewModel';
import s from './CommandPalette.module.css';

const FOCUSABLE = 'button:not([disabled]),input:not([disabled])';

const HIT_OPEN = '\u0001';
const HIT_CLOSE = '\u0002';
const MARK_STYLE = { background: 'color-mix(in srgb, var(--color-accent) 28%, transparent)', color: 'inherit' } as const;

/**
 * Text with matches highlighted. Search results carry core's HIT_OPEN/HIT_CLOSE markers around each match;
 * everything else falls back to highlighting the query. Only React text nodes are produced (never innerHTML).
 */
function Hit({ text, q }: { text: string; q: string }) {
  if (text.includes(HIT_OPEN)) {
    return <>{text.split(HIT_OPEN).map((part, i) => {
      if (i === 0) return part;
      const [hit, ...rest] = part.split(HIT_CLOSE);
      return <span key={i}><mark style={MARK_STYLE}>{hit}</mark>{rest.join(HIT_CLOSE)}</span>;
    })}</>;
  }
  const needle = q.trim();
  const i = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark style={MARK_STYLE}>{text.slice(i, i + needle.length)}</mark>{text.slice(i + needle.length)}</>;
}

export function CommandPalette({ vm }: { vm: ViewModel }) {
  const { closePalette, icL, noResults, onQ, palRef, palette, q, results, stop } = vm;
  const box = useRef<HTMLDivElement>(null);
  const active = results.findIndex((r) => r.active);

  useEffect(() => {
    if (!palette) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => { opener?.focus?.(); };
  }, [palette]);

  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return palette ? (
    <div className={s.backdrop} onClick={closePalette}>
      <div ref={box} className={s.dialog} onClick={stop} onKeyDown={trap} role="dialog" aria-modal="true" aria-label="Search everything">
        <div className={s.searchRow}>
          <span className={s.searchIcon}>{icL.search}</span>
          <input className={s.input} ref={palRef} value={q} onChange={onQ} placeholder="Search people, channels, messages, documents…" aria-label="Search"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-activedescendant={active >= 0 ? `palette-${active}` : undefined} />
          <span className={s.escKey}>esc</span>
        </div>
        <div className={s.results} id="palette-list" role="listbox" aria-label="Results">
          {noResults ? (
            <div className={s.empty} role="status">{q.trim().length < 2 ? 'Type to search.' : 'Nothing matches yet. Try a person, a channel, a snapshot title or words from a message.'}</div>
          ) : null}
          {results.map((r, i) => (
            <Fragment key={i}>
              {r.showGroup ? <div className={s.groupLabel} role="presentation">{r.group}</div> : null}
              <button type="button" id={`palette-${i}`} role="option" aria-selected={r.active} tabIndex={-1} className={s.result} style={{ background: r.bg, color: r.fg }} onClick={r.onClick} onMouseEnter={r.onHover}>
                <span className={s.resultIcon}>{r.iconEl}</span>
                <span className={s.resultText}>
                  <span className={s.resultLabel}><Hit text={r.label} q={q} /></span>
                  <span className={s.resultSub}><Hit text={r.sub} q={q} /></span>
                </span>
              </button>
            </Fragment>
          ))}
        </div>
        <div className={s.footer}>
          <span>Up and down to move</span>
          <span>Enter to open</span>
          <span>Alt 1 to 5 sections</span>
          <span>Alt up and down Spaces</span>
        </div>
      </div>
    </div>
  ) : null;
}
