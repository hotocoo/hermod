import { Fragment, useEffect, useRef, type KeyboardEvent } from 'react';
import type { ViewModel } from '@/state/viewModel';
import { Hit } from '@/components/ui/Hit';
import s from './CommandPalette.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

const FOCUSABLE = 'button:not([disabled]),input:not([disabled])';

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
      <div ref={box} className={s.dialog} onClick={stop} onKeyDown={trap} role="dialog" aria-modal="true" aria-label={COPY.ui.shell.commandPaletteText.searchEverything}>
        <div className={s.searchRow}>
          <span className={s.searchIcon}>{icL.search}</span>
          <input className={s.input} ref={palRef} value={q} onChange={onQ} placeholder={COPY.ui.shell.commandPaletteText.searchPeopleChannelsMessagesDocuments} aria-label={COPY.ui.shell.commandPaletteText.search}
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-activedescendant={active >= 0 ? `palette-${active}` : undefined} />
          <span className={s.escKey}>{COPY.ui.shell.commandPaletteText.esc}</span>
        </div>
        <div className={s.results} id="palette-list" role="listbox" aria-label={COPY.ui.shell.commandPaletteText.results}>
          {noResults ? (
            <div className={s.empty} role="status"><EmptyNote {...(q.trim().length < 2 ? COPY.empty.paletteIdle : COPY.empty.paletteNone)} /></div>
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
          <span>{COPY.ui.shell.commandPaletteText.upAndDownToMove}</span>
          <span>{COPY.ui.shell.commandPaletteText.enterToOpen}</span>
          <span>{COPY.ui.shell.commandPaletteText.alt1To5Sections}</span>
          <span>{COPY.ui.shell.commandPaletteText.altUpAndDownSpaces}</span>
        </div>
      </div>
    </div>
  ) : null;
}
