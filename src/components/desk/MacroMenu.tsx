'use client';
import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/config/copy';
import type { DeskMacro } from '@/state/deskTypes';
import s from './desk.module.css';

/** Dropdown of saved macros; picking one runs its actions as ordinary ticket events. */
export function MacroMenu({ macros, onPick, label = COPY.ui.desk.macros }: { macros: DeskMacro[]; onPick: (m: DeskMacro) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div className={s.menuWrap} ref={ref}>
      <button type="button" className="btn btn-secondary" aria-haspopup="menu" aria-expanded={open} disabled={!macros.length} title={macros.length ? undefined : COPY.ui.desk.macroMenu.empty}
        onClick={() => setOpen((v) => !v)} data-testid="macro-button">{label}</button>
      {open && (
        <div className={s.menu} role="menu">
          {macros.map((m) => <button key={m.id} type="button" role="menuitem" className={s.menuItem} data-testid="macro-item" onClick={() => { setOpen(false); onPick(m); }}>{m.name}</button>)}
        </div>
      )}
    </div>
  );
}
