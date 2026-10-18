'use client';
import type { DeskField } from '@/state/deskTypes';

interface Props { f: DeskField; value: string; onChange: (v: string) => void; id: string; onBlurCommit?: () => void }

/** One custom field control, picked by the field kind. Checkbox values are the strings `true` / `false`. */
export function FieldInput({ f, value, onChange, id, onBlurCommit }: Props) {
  if (f.kind === 'checkbox') {
    return <input id={id} type="checkbox" checked={value === 'true'} onChange={(e) => { onChange(e.target.checked ? 'true' : 'false'); onBlurCommit?.(); }} />;
  }
  if (f.kind === 'select') {
    return (
      <select id={id} className="input" value={value} required={f.required} onChange={(e) => { onChange(e.target.value); onBlurCommit?.(); }}>
        <option value="">{f.required ? 'Choose' : 'None'}</option>
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input id={id} className="input" type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'} required={f.required} value={value}
      onChange={(e) => onChange(e.target.value)} onBlur={onBlurCommit} />
  );
}
