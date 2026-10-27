'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage, getBridge, type InviteRecord } from '@/lib/bridge';
import { useAppStore } from '@/state/store';
import f from '@/components/ui/form.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

const when = (ms: number | null) => (ms ? new Date(ms * (ms < 1e12 ? 1000 : 1)).toLocaleString() : COPY.ui.modals.invites.never);

/** Active invites of a Space with uses, expiry and Revoke (E-004). `refreshKey` reloads after a new invite. */
export function InviteList({ space, refreshKey = 0, canRevoke = true }: { space: string; refreshKey?: number; canRevoke?: boolean }) {
  const [list, setList] = useState<InviteRecord[] | null>(null);
  const toast = useAppStore((s) => s.showToast);
  const confirm = useAppStore((s) => s.confirmAction);
  const load = useCallback(() => {
    getBridge().inviteList(space).then(setList).catch((e) => { setList([]); toast(errorMessage(e), undefined, 'error'); });
  }, [space, toast]);
  useEffect(load, [load, refreshKey]);

  const revoke = async (i: InviteRecord) => {
    if (!(await confirm({ title: COPY.ui.modals.invites.revokeTitle, body: COPY.ui.modals.invites.revokeBody, confirm: COPY.ui.modals.invites.revoke, danger: true }))) return;
    try { await getBridge().inviteRevoke(space, i.id); load(); } catch (e) { toast(errorMessage(e), undefined, 'error'); }
  };

  const C = COPY.ui.modals.invites;
  if (!list) return <p className={f.note}>{C.loading}</p>;
  const active = list.filter((i) => !i.revoked);
  if (!active.length) return <EmptyNote {...COPY.empty.invites} />;
  return (
    <div className={f.scroll}>
      <table className={f.table}>
        <caption className={f.sr}>{C.caption}</caption>
        <thead><tr><th scope="col">{C.role}</th><th scope="col">{C.used}</th><th scope="col">{C.expires}</th><th scope="col"><span className={f.sr}>{C.actions}</span></th></tr></thead>
        <tbody>
          {active.map((i) => (
            <tr key={i.id}>
              <td>{i.role}</td><td>{i.uses}{i.max_uses ? C.usedOf(i.max_uses) : ''}</td><td>{when(i.exp)}</td>
              <td>{canRevoke && <button type="button" className={`btn btn-secondary ${f.danger}`} onClick={() => revoke(i)}>{C.revoke}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
