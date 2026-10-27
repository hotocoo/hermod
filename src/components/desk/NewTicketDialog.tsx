'use client';
import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { COPY } from '@/config/copy';
import { errorMessage, type BlobRef } from '@/lib/bridge';
import { pickAndStore } from '@/lib/upload';
import { PRIORITY_LABEL, TICKET_PRIORITIES, type DeskView, type TicketPriority } from '@/state/deskTypes';
import { useAppStore } from '@/state/store';
import { Atts } from './Conversation';
import { FieldInput } from './FieldInput';

interface Props { desk: DeskView; onClose: () => void }

/** New ticket form: subject, queue, details, the space's custom fields and attachments. Guests do not choose a priority. */
export function NewTicketDialog({ desk, onClose }: Props) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [queue, setQueue] = useState(desk.config.queues[0]?.queue_id ?? '');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [att, setAtt] = useState<BlobRef[]>([]);
  const [busy, setBusy] = useState(false);
  const create = useAppStore((s) => s.deskCreate);
  const toast = useAppStore((s) => s.showToast);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || busy) return;
    setBusy(true);
    const id = await create({ queue, subject, body, priority, fields, attachments: att });
    setBusy(false);
    if (id) onClose();
  };
  const attach = async () => {
    try { const picked = await pickAndStore('*/*', true); setAtt((a) => [...a, ...picked.map((x) => x.blob)]); } catch (err) { toast(errorMessage(err), undefined, 'error'); }
  };
  return (
    <Dialog title={COPY.ui.desk.newTicket} kicker={COPY.ui.desk.kicker} onClose={onClose} wide initialFocus="#nt-subject">
      <form onSubmit={(e) => { void submit(e); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="new-ticket-form">
        <div className={f.field}>
          <label className={f.label} htmlFor="nt-subject">{COPY.ui.desk.newTicketDialog.subject}</label>
          <input id="nt-subject" className="input" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="nt-subject" />
        </div>
        <div className={f.row}>
          {desk.config.queues.length > 0 && (
            <div className={f.field}>
              <label className={f.label} htmlFor="nt-queue">{COPY.ui.desk.queue}</label>
              <select id="nt-queue" className="input" value={queue} onChange={(e) => setQueue(e.target.value)}>
                {desk.config.queues.map((q) => <option key={q.queue_id} value={q.queue_id}>{q.name}</option>)}
              </select>
            </div>
          )}
          {desk.agent && (
            <div className={f.field}>
              <label className={f.label} htmlFor="nt-prio">{COPY.ui.desk.priority}</label>
              <select id="nt-prio" className="input" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className={f.field}>
          <label className={f.label} htmlFor="nt-body">{COPY.ui.desk.newTicketDialog.body}</label>
          <textarea id="nt-body" className="input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} data-testid="nt-body" />
        </div>
        {desk.config.fields.map((fd) => (
          <div key={fd.field_id} className={fd.kind === 'checkbox' ? f.check : f.field}>
            <label className={f.label} htmlFor={`nt-${fd.field_id}`}>{fd.label}{fd.required && fd.kind !== 'checkbox' ? COPY.ui.desk.newTicketDialog.required : ''}</label>
            <FieldInput f={fd} id={`nt-${fd.field_id}`} value={fields[fd.field_id] ?? ''} onChange={(v) => setFields((x) => ({ ...x, [fd.field_id]: v }))} />
          </div>
        ))}
        <Atts list={att} />
        <div className={f.actions}>
          <button type="button" className="btn btn-secondary" onClick={() => { void attach(); }}>{COPY.ui.desk.newTicketDialog.attachFiles}</button>
          <span className={f.grow} />
          <button type="button" className="btn btn-secondary" onClick={onClose}>{COPY.ui.desk.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !subject.trim()} data-testid="nt-submit">{COPY.ui.desk.newTicketDialog.create}</button>
        </div>
      </form>
    </Dialog>
  );
}
