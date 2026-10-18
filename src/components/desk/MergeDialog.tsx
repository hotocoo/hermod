'use client';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import type { DeskView, Ticket } from '@/state/deskTypes';

interface Props { desk: DeskView; from: Ticket; onClose: () => void; onMerge: (into: string) => Promise<boolean> }

/** Pick the ticket that stays; this one is closed and its conversation moves there. */
export function MergeDialog({ desk, from, onClose, onMerge }: Props) {
  const choices = desk.tickets.filter((x) => x.id !== from.id && !x.merged_into);
  const [into, setInto] = useState(choices[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Merge #${from.number}`} kicker="Help Desk" onClose={onClose}>
      <p className={f.note}>#{from.number} {from.subject} is closed and its messages appear in the ticket you choose. This cannot be undone.</p>
      {choices.length === 0 ? <p className={f.note}>There is no other ticket to merge into.</p> : (
        <div className={f.field}>
          <label className={f.label} htmlFor="merge-into">Keep this ticket</label>
          <select id="merge-into" className="input" value={into} onChange={(e) => setInto(e.target.value)} data-testid="merge-into">
            {choices.map((x) => <option key={x.id} value={x.id}>#{x.number} {x.subject}</option>)}
          </select>
        </div>
      )}
      <div className={f.actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!into || busy} data-testid="merge-confirm"
          onClick={() => { setBusy(true); void onMerge(into).then((ok) => { setBusy(false); if (ok) onClose(); }); }}>Merge</button>
      </div>
    </Dialog>
  );
}
