'use client';
import { useState, type FormEvent } from 'react';
import { INVITE_EXPIRY } from '@/config/app';
import { COPY } from '@/config/copy';
import { errorMessage, getBridge, type InviteOut, type Role } from '@/lib/bridge';
import { spaceOf } from '@/state/helpers';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { CopyField } from './CopyField';
import { InviteList } from './InviteList';

/** Create an invite link and code for a Space, and manage the active ones. */
export function InviteModal({ space }: { space: string }) {
  const close = useAppStore((s) => s.closeModal);
  const toast = useAppStore((s) => s.showToast);
  const sp = useAppStore((s) => spaceOf(s.spaces, space));
  const [exp, setExp] = useState('2');
  const [max, setMax] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [out, setOut] = useState<InviteOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const maxUses = max.trim() ? Math.max(1, Math.floor(Number(max))) : null;
      setOut(await getBridge().inviteCreate(space, { expiresIn: INVITE_EXPIRY[Number(exp)].secs, maxUses: Number.isFinite(maxUses) ? maxUses : null, role }));
      setN((x) => x + 1);
    } catch (err) { toast(errorMessage(err), undefined, 'error'); }
    setBusy(false);
  };

  const C = COPY.ui.modals.invite;
  return (
    <Dialog title={C.title(sp.name)} kicker={C.kicker} onClose={close} wide>
      <p className={f.note}>{C.note}</p>
      <form onSubmit={submit} className={f.row} style={{ alignItems: 'flex-end' }}>
        <div className={f.field}>
          <label className={f.label} htmlFor="inv-exp">{C.expires}</label>
          <select id="inv-exp" className="input" value={exp} onChange={(e) => setExp(e.target.value)}>
            {INVITE_EXPIRY.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
          </select>
          <p className={f.note}>{COPY.inviteExpiryNote}</p>
        </div>
        <div className={f.field}>
          <label className={f.label} htmlFor="inv-max">{C.mostUses}</label>
          <input id="inv-max" className="input" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} style={{ width: 120 }} />
        </div>
        <div className={f.field}>
          <label className={f.label} htmlFor="inv-role">{C.joinsAs}</label>
          <select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">{C.member}</option><option value="guest">{C.guest}</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>{C.create}</button>
      </form>
      {out && (
        <>
          <CopyField id="inv-link" label={C.link} value={out.link} />
          <CopyField id="inv-code" label={C.code} value={out.code} />
        </>
      )}
      <h3 style={{ fontSize: 18, margin: '6px 0 0' }}>{C.active}</h3>
      <InviteList space={space} refreshKey={n} />
    </Dialog>
  );
}
