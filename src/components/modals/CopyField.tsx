'use client';
import { copyText } from '@/lib/clipboard';
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
        <button type="button" className="btn btn-secondary" onClick={async () => toast((await copyText(value)) ? 'Copied' : 'Copy failed, select the text and copy it by hand.', undefined, undefined)}>Copy</button>
      </div>
    </div>
  );
}
