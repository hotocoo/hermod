import s from './Switch.module.css';

interface Props { label: string; sub?: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }

/** Labelled on/off row (role=switch), same look as the settings drawer rows. */
export function Switch({ label, sub, on, onChange, disabled }: Props) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} className={s.row} onClick={() => onChange(!on)}>
      <span className={s.text}><span className={s.label}>{label}</span>{sub && <span className={s.sub}>{sub}</span>}</span>
      <span className={on ? `${s.track} ${s.on}` : s.track}><span className={s.knob} /></span>
    </button>
  );
}
