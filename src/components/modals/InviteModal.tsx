'use client';
import { useState, type FormEvent } from 'react';
import { INVITE_EXPIRY } from '@/config/app';
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

  return (
    <Dialog title={`Invite people to ${sp.name}`} kicker="Invite" onClose={close} wide>
      <p className={f.note}>They install Hermod from the link, then it opens the space. Anyone holding the link or code can join, so share it only with people you trust.</p>
      <form onSubmit={submit} className={f.row} style={{ alignItems: 'flex-end' }}>
        <div className={f.field}>
          <label className={f.label} htmlFor="inv-exp">Expires after</label>
          <select id="inv-exp" className="input" value={exp} onChange={(e) => setExp(e.target.value)}>
            {INVITE_EXPIRY.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
          </select>
        </div>
        <div className={f.field}>
          <label className={f.label} htmlFor="inv-max">Most uses (optional)</label>
          <input id="inv-max" className="input" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} style={{ width: 120 }} />
        </div>
        <div className={f.field}>
          <label className={f.label} htmlFor="inv-role">Joins as</label>
          <select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">Member</option><option value="guest">Guest</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>Create invite</button>
      </form>
      {out && (
        <>
          <CopyField id="inv-link" label="Invite link" value={out.link} />
          <CopyField id="inv-code" label="Invite code" value={out.code} />
        </>
      )}
      <h3 style={{ fontSize: 18, margin: '6px 0 0' }}>Active invites</h3>
      <InviteList space={space} refreshKey={n} />
    </Dialog>
  );
}
