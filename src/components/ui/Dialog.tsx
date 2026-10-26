'use client';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import s from './Dialog.module.css';
import { COPY } from '@/config/copy';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface Props { title: string; kicker?: string; onClose: () => void; wide?: boolean; children: ReactNode; /** First element to focus; defaults to the first focusable. */ initialFocus?: string }

/** Modal dialog: labelled, traps Tab, closes on Escape or backdrop click, and returns focus to what opened it. */
export function Dialog({ title, kicker, onClose, wide, children, initialFocus }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const first = (initialFocus ? root?.querySelector<HTMLElement>(initialFocus) : null) ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => { opener?.focus?.(); };
  }, [initialFocus]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className={s.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={wide ? `${s.dialog} ${s.wide}` : s.dialog} onKeyDown={onKey}>
        <div className={s.head}>
          <div>
            {kicker && <div className={s.kicker}>{kicker}</div>}
            <h2 id={titleId} className={s.title}>{title}</h2>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label={COPY.ui.shell.dialogText.close}><Icon name="x" size={16} /></button>
        </div>
        <div className={s.body}>{children}</div>
      </div>
    </div>
  );
}
