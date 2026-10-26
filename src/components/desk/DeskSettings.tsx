'use client';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Switch } from '@/components/ui/Switch';
import f from '@/components/ui/form.module.css';
import {
  FIELD_KINDS, PRIORITY_LABEL, STATUS_LABEL, TICKET_PRIORITIES, TICKET_STATUSES,
  type BusinessHours, type DeskConfig, type DeskField, type DeskMacro, type DeskQueue, type DeskSla, type FieldKind, type TicketPriority, type TicketStatus,
} from '@/state/deskTypes';
import { useAppStore } from '@/state/store';
import { COPY } from '@/config/copy';
import s from './desk.module.css';

const DEFAULT_HOURS: BusinessHours = { tz: 'UTC', days: [1, 2, 3, 4, 5], start: 540, end: 1020 };
/** Shapes the core accepts: UTC, a signed offset, or an IANA name such as Asia/Kuala_Lumpur (the core checks the name). */
const OFFSET = /^(utc|z|gmt|[+-]\d{1,2}(:?\d{2})?|[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+)$/i;
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutes = (v: string) => { const [h, m] = v.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const uniqueId = (base: string, taken: string[]) => { let id = base || 'item'; let n = 2; while (taken.includes(id)) id = `${base}-${n++}`; return id; };

function Queues({ list, set }: { list: DeskQueue[]; set: (l: DeskQueue[]) => void }) {
  const [name, setName] = useState('');
  return (
    <section className={s.settingsSection}>
      <h3>{COPY.ui.desk.queues}</h3>
      {list.map((q, i) => (
        <div key={q.queue_id} className={s.rowForm}>
          <input className="input" aria-label={COPY.ui.desk.settings.queueName} value={q.name} onChange={(e) => set(list.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
          <input className="input" aria-label={COPY.ui.desk.settings.queueDesc} placeholder={COPY.ui.desk.settings.description} value={q.desc} onChange={(e) => set(list.map((x, k) => (k === i ? { ...x, desc: e.target.value } : x)))} />
          <button type="button" className="btn btn-secondary" onClick={() => set(list.filter((_, k) => k !== i))}>{COPY.ui.desk.remove}</button>
        </div>
      ))}
      <div className={s.rowForm}>
        <input className="input" aria-label={COPY.ui.desk.settings.newQueueLabel} placeholder={COPY.ui.desk.settings.newQueuePh} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn btn-secondary" disabled={!name.trim()} data-testid="add-queue"
          onClick={() => { set([...list, { queue_id: uniqueId(slug(name), list.map((q) => q.queue_id)), name: name.trim(), desc: '' }]); setName(''); }}>{COPY.ui.desk.settings.addQueue}</button>
      </div>
    </section>
  );
}

function Fields({ list, set }: { list: DeskField[]; set: (l: DeskField[]) => void }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<FieldKind>('text');
  return (
    <section className={s.settingsSection}>
      <h3>{COPY.ui.desk.settings.fieldsTitle}</h3>
      {list.map((fd, i) => (
        <div key={fd.field_id} className={s.rowForm}>
          <input className="input" aria-label={COPY.ui.desk.settings.fieldLabel} value={fd.label} onChange={(e) => set(list.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
          <span className={s.chip}>{fd.kind}</span>
          {fd.kind === 'select' && <input className="input" aria-label={COPY.ui.desk.settings.options} placeholder={COPY.ui.desk.settings.options} value={fd.options.join(', ')}
            onChange={(e) => set(list.map((x, k) => (k === i ? { ...x, options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) } : x)))} />}
          <label className={f.check}><input type="checkbox" checked={fd.required} onChange={(e) => set(list.map((x, k) => (k === i ? { ...x, required: e.target.checked } : x)))} />{COPY.ui.desk.settings.required}</label>
          <button type="button" className="btn btn-secondary" onClick={() => set(list.filter((_, k) => k !== i))}>{COPY.ui.desk.remove}</button>
        </div>
      ))}
      <div className={s.rowForm}>
        <input className="input" aria-label={COPY.ui.desk.settings.newFieldLabel} placeholder={COPY.ui.desk.settings.newFieldPh} value={label} onChange={(e) => setLabel(e.target.value)} />
        <select className="input" aria-label={COPY.ui.desk.settings.fieldKind} value={kind} onChange={(e) => setKind(e.target.value as FieldKind)}>{FIELD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <button type="button" className="btn btn-secondary" disabled={!label.trim()} data-testid="add-field"
          onClick={() => { set([...list, { field_id: uniqueId(slug(label), list.map((x) => x.field_id)), label: label.trim(), kind, options: [], required: false }]); setLabel(''); }}>{COPY.ui.desk.settings.addField}</button>
      </div>
    </section>
  );
}

function Sla({ list, set }: { list: DeskSla[]; set: (l: DeskSla[]) => void }) {
  const of = (p: TicketPriority) => list.find((x) => x.priority === p);
  const edit = (p: TicketPriority, key: 'first_response_mins' | 'resolve_mins', v: string) => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    const cur = of(p) ?? { priority: p, first_response_mins: 0, resolve_mins: 0 };
    const next = { ...cur, [key]: n };
    set([...list.filter((x) => x.priority !== p), next]);
  };
  return (
    <section className={s.settingsSection}>
      <h3>{COPY.ui.desk.settings.slaTitle}</h3>
      <p className={f.note}>{COPY.ui.desk.settings.slaNote}</p>
      {TICKET_PRIORITIES.map((p) => (
        <div key={p} className={s.rowForm}>
          <span style={{ width: 70 }}>{PRIORITY_LABEL[p]}</span>
          <input className="input" inputMode="numeric" aria-label={COPY.ui.desk.settings.firstReplyLabel(PRIORITY_LABEL[p])} placeholder={COPY.ui.desk.settings.firstReplyPh} value={of(p)?.first_response_mins || ''} onChange={(e) => edit(p, 'first_response_mins', e.target.value)} data-testid={`sla-first-${p}`} />
          <input className="input" inputMode="numeric" aria-label={COPY.ui.desk.settings.resolveLabel(PRIORITY_LABEL[p])} placeholder={COPY.ui.desk.settings.solvePh} value={of(p)?.resolve_mins || ''} onChange={(e) => edit(p, 'resolve_mins', e.target.value)} data-testid={`sla-resolve-${p}`} />
        </div>
      ))}
    </section>
  );
}

function Hours({ value, set }: { value: BusinessHours | null; set: (h: BusinessHours | null) => void }) {
  return (
    <section className={s.settingsSection}>
      <h3>{COPY.ui.desk.settings.hoursTitle}</h3>
      <Switch label={COPY.ui.desk.settings.hoursSwitch} on={!!value} onChange={(on) => set(on ? DEFAULT_HOURS : null)} />
      {value && (
        <>
          <div className={s.rowForm}>
            <label className={f.label} htmlFor="bh-tz">{COPY.ui.desk.settings.timeZone}</label>
            <input id="bh-tz" className="input" style={{ maxWidth: 220 }} value={value.tz} placeholder={COPY.ui.desk.deskSettingsText.asiaKualaLumpur} onChange={(e) => set({ ...value, tz: e.target.value })} />
            <label className={f.label} htmlFor="bh-start">{COPY.ui.desk.settings.from}</label>
            <input id="bh-start" className="input" type="time" style={{ maxWidth: 120 }} value={hhmm(value.start)} onChange={(e) => set({ ...value, start: minutes(e.target.value) })} />
            <label className={f.label} htmlFor="bh-end">{COPY.ui.desk.settings.to}</label>
            <input id="bh-end" className="input" type="time" style={{ maxWidth: 120 }} value={hhmm(value.end)} onChange={(e) => set({ ...value, end: minutes(e.target.value) })} />
          </div>
          <div className={s.rowForm} role="group" aria-label={COPY.ui.desk.settings.workingDays}>
            {COPY.ui.desk.settings.weekdays.map((d, i) => (
              <label key={d} className={f.check}><input type="checkbox" checked={value.days.includes(i)} onChange={(e) => set({ ...value, days: e.target.checked ? [...value.days, i].sort() : value.days.filter((x) => x !== i) })} />{d}</label>
            ))}
          </div>
          <span className={s.hint} role={OFFSET.test(value.tz.trim()) ? undefined : 'alert'}>{OFFSET.test(value.tz.trim()) ? COPY.ui.desk.settings.tzHelp : COPY.ui.desk.settings.tzInvalid}</span>
        </>
      )}
    </section>
  );
}

function Macros({ list }: { list: DeskMacro[] }) {
  const save = useAppStore((st) => st.deskSaveMacro);
  const del = useAppStore((st) => st.deskDeleteMacro);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<TicketStatus | ''>('');
  const [prio, setPrio] = useState<TicketPriority | ''>('');
  const [tags, setTags] = useState('');
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const reset = () => { setName(''); setStatus(''); setPrio(''); setTags(''); setComment(''); setInternal(false); };
  return (
    <section className={s.settingsSection}>
      <h3>{COPY.ui.desk.macros}</h3>
      <p className={f.note}>{COPY.ui.desk.settings.macrosNote}</p>
      {list.map((m) => (
        <div key={m.id} className={s.rowForm} data-testid="macro-row">
          <strong style={{ minWidth: 100 }}>{m.name}</strong>
          <span className={s.hint}>{m.actions.map((a) => [a.set_status && COPY.ui.desk.settings.macroStatus(a.set_status), a.set_priority && COPY.ui.desk.settings.macroPriority(a.set_priority), a.add_tags?.length && COPY.ui.desk.settings.macroTags(a.add_tags.join(',')), a.comment && COPY.ui.desk.settings.macroComment(!!a.internal, a.comment.slice(0, 30))].filter(Boolean).join(', ')).join(' / ')}</span>
          <span className={s.grow} />
          <button type="button" className="btn btn-secondary" onClick={() => { void del(m.id); }}>{COPY.ui.desk.settings.delete}</button>
        </div>
      ))}
      <div className={s.rowForm}>
        <input className="input" aria-label={COPY.ui.desk.settings.macroName} placeholder={COPY.ui.desk.settings.macroName} value={name} onChange={(e) => setName(e.target.value)} data-testid="macro-name" />
        <select className="input" aria-label={COPY.ui.desk.settings.setStatus} value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | '')}>
          <option value="">{COPY.ui.desk.settings.keepStatus}</option>{TICKET_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
        </select>
        <select className="input" aria-label={COPY.ui.desk.settings.setPriority} value={prio} onChange={(e) => setPrio(e.target.value as TicketPriority | '')}>
          <option value="">{COPY.ui.desk.settings.keepPriority}</option>{TICKET_PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}
        </select>
        <input className="input" aria-label={COPY.ui.desk.settings.addTags} placeholder={COPY.ui.desk.settings.tagsPh} value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <div className={s.rowForm}>
        <input className="input" aria-label={COPY.ui.desk.settings.macroCommentLabel} placeholder={COPY.ui.desk.settings.macroCommentPh} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="macro-comment" />
        <label className={f.check}><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />{COPY.ui.desk.internalNote}</label>
        <button type="button" className="btn btn-secondary" disabled={!name.trim()} data-testid="macro-save"
          onClick={() => {
            const add = tags.split(',').map((x) => x.trim()).filter(Boolean);
            void save({ name: name.trim(), actions: [{ set_status: status || undefined, set_priority: prio || undefined, add_tags: add.length ? add : undefined, comment: comment.trim() || undefined, internal }] }).then((ok) => { if (ok) reset(); });
          }}>{COPY.ui.desk.settings.addMacro}</button>
      </div>
    </section>
  );
}

/** Desk settings. Admins edit queues, fields, service promises, hours and CSAT (one `desk.config` event); agents also manage macros. */
export function DeskSettings({ config, macros, admin, onClose }: { config: DeskConfig; macros: DeskMacro[]; admin: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<DeskConfig>(config);
  const [busy, setBusy] = useState(false);
  const save = useAppStore((st) => st.deskSaveConfig);
  return (
    <Dialog title={COPY.ui.desk.section.deskSettings} kicker={COPY.ui.desk.kicker} onClose={onClose} wide>
      <div className={s.settings} data-testid="desk-settings">
        {admin ? (
          <>
            <Queues list={draft.queues} set={(queues) => setDraft({ ...draft, queues })} />
            <Fields list={draft.fields} set={(fields) => setDraft({ ...draft, fields })} />
            <Sla list={draft.sla} set={(sla) => setDraft({ ...draft, sla })} />
            <Hours value={draft.business_hours} set={(business_hours) => setDraft({ ...draft, business_hours })} />
            <section className={s.settingsSection}>
              <h3>{COPY.ui.desk.settings.customerRating}</h3>
              <Switch label={COPY.ui.desk.settings.askRate} on={draft.csat} onChange={(csat) => setDraft({ ...draft, csat })} />
            </section>
            <div className={f.actions}>
              <button type="button" className="btn btn-primary" disabled={busy || (!!draft.business_hours && !OFFSET.test(draft.business_hours.tz.trim()))} data-testid="save-config"
                onClick={() => { setBusy(true); void save(draft).then((ok) => { setBusy(false); if (ok) onClose(); }); }}>{COPY.ui.desk.settings.save}</button>
            </div>
          </>
        ) : <p className={f.note}>{COPY.ui.desk.settings.adminOnly}</p>}
        <Macros list={macros} />
      </div>
    </Dialog>
  );
}
