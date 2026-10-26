'use client';
import { useState } from 'react';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import { COPY } from '@/config/copy';
import f from '@/components/ui/form.module.css';

/** Explicit confirmation for destructive actions (store.confirmAction). `typed` requires the user to type a phrase first. */
export function ConfirmDialog() {
  const spec = useAppStore((s) => s.confirm);
  const settle = useAppStore((s) => s.settleConfirm);
  const [typed, setTyped] = useState('');
  if (!spec) return null;
  const ready = !spec.typed || typed.trim() === spec.typed;
  return (
    <Dialog key={spec.id} title={spec.title} onClose={() => { setTyped(''); settle(false); }} initialFocus="[data-cancel]">
      <p className={f.note}>{spec.body}</p>
      {spec.typed && (
        <div className={f.field}>
          <label className={f.label} htmlFor="cf-typed">{COPY.ui.modals.confirm.typeBefore} <b>{spec.typed}</b> {COPY.ui.modals.confirm.typeAfter}</label>
          <input id="cf-typed" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
      <div className={f.actions}>
        <button type="button" data-cancel className="btn btn-secondary" onClick={() => { setTyped(''); settle(false); }}>{COPY.ui.modals.common.cancel}</button>
        <button type="button" className={spec.danger ? `btn btn-secondary ${f.danger}` : 'btn btn-primary'} disabled={!ready} onClick={() => { setTyped(''); settle(true); }}>{spec.confirm}</button>
      </div>
    </Dialog>
  );
}
