import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { COPY } from '@/config/copy';
import chrome from '../ui/chrome.module.css';
import s from './DrawerFrame.module.css';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface DrawerFrameProps {
  label: string;
  kicker: ReactNode;
  /** Heading under the kicker; omit when `headExtra` supplies a custom one. */
  title?: ReactNode;
  /** Extra header content rendered after the kicker/title (e.g. the sky clock). */
  headExtra?: ReactNode;
  /** Space below the header: none, 8px or 12px. */
  headGap?: 'sm' | 'md';
  closeIcon: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** Shared chrome of the top-right drawers: dialog container, kicker/title header and close button. */
export function DrawerFrame({ label, kicker, title, headExtra, headGap, closeIcon, onClose, children }: DrawerFrameProps) {
  const head = headGap === 'sm' ? `${s.head} ${s.headSm}` : headGap === 'md' ? `${s.head} ${s.headMd}` : s.head;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { opener?.focus?.(); };
  }, []);
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
    <div ref={ref} className={s.root} role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey}>
      <div className={head}>
        <div>
          <div className={chrome.kicker}>{kicker}</div>
          {title != null ? <div className={s.title}>{title}</div> : null}
          {headExtra}
        </div>
        <button className={s.closeBtn} onClick={onClose} aria-label={COPY.ui.shell.misc.close}>{closeIcon}</button>
      </div>
      {children}
    </div>
  );
}
