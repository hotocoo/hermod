'use client';
import { useState, type FormEvent } from 'react';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { COPY } from '@/config/copy';

/** The one text-input dialog every "new thing" action uses (store.ask). Required fields block submit. */
export function PromptDialog() {
  const spec = useAppStore((s) => s.prompt);
  const settle = useAppStore((s) => s.settlePrompt);
  if (!spec) return null;
  return <PromptForm key={spec.id} spec={spec} settle={settle} />;
}

function PromptForm({ spec, settle }: { spec: NonNullable<ReturnType<typeof useAppStore.getState>['prompt']>; settle: (v: Record<string, string> | null) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(spec.fields.map((x) => [x.key, x.initial ?? ''])));
  const ok = spec.fields.every((x) => !x.required || values[x.key].trim());
  const submit = (e: FormEvent) => { e.preventDefault(); if (ok) settle(values); };
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));
  return (
    <Dialog title={spec.title} kicker={spec.kicker} onClose={() => settle(null)}>
      <form onSubmit={submit} className={f.field} style={{ gap: 14 }}>
        {spec.fields.map((fl) => (
          <div key={fl.key} className={f.field}>
            <label className={f.label} htmlFor={`pf-${fl.key}`}>{fl.label}{fl.required ? COPY.ui.modals.promptDialogText.required : ''}</label>
            {fl.options ? (
              <select id={`pf-${fl.key}`} className="input" value={values[fl.key]} onChange={(e) => set(fl.key, e.target.value)}>
                {fl.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : fl.multiline ? (
              <textarea id={`pf-${fl.key}`} className="input" rows={4} value={values[fl.key]} placeholder={fl.placeholder} onChange={(e) => set(fl.key, e.target.value)} />
            ) : (
              <input id={`pf-${fl.key}`} className="input" value={values[fl.key]} placeholder={fl.placeholder} onChange={(e) => set(fl.key, e.target.value)} autoComplete="off" />
            )}
          </div>
        ))}
        {spec.note && <p className={f.note}>{spec.note}</p>}
        <div className={f.actions}>
          <button type="button" className="btn btn-secondary" onClick={() => settle(null)}>{COPY.ui.modals.promptDialogText.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={!ok}>{spec.submit}</button>
        </div>
      </form>
    </Dialog>
  );
}
