'use client';
import { copyText } from '@/lib/clipboard';
import { COPY } from '@/config/copy';
import { useAppStore } from '@/state/store';
import f from '@/components/ui/form.module.css';

/** Read-only value with a Copy button. */
export function CopyField({ label, value, id }: { label: string; value: string; id: string }) {
  const toast = useAppStore((s) => s.showToast);
  return (
    <div className={f.field}>
      <label className={f.label} htmlFor={id}>{label}</label>
      <div className={f.row}>
        <input id={id} className={`input ${f.grow}`} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-secondary" onClick={async () => toast((await copyText(value)) ? COPY.ui.modals.copyField.copied : COPY.ui.modals.copyField.failed, undefined, undefined)}>{COPY.ui.modals.copyField.copy}</button>
      </div>
    </div>
  );
}
