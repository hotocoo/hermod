'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage, getBridge, type InviteRecord } from '@/lib/bridge';
import { useAppStore } from '@/state/store';
import f from '@/components/ui/form.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

const when = (ms: number | null) => (ms ? new Date(ms * (ms < 1e12 ? 1000 : 1)).toLocaleString() : 'never');

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
    if (!(await confirm({ title: 'Revoke this invite?', body: 'Nobody can join with it any more. People who already joined keep their access: codes cannot be taken back from them.', confirm: 'Revoke', danger: true }))) return;
    try { await getBridge().inviteRevoke(space, i.id); load(); } catch (e) { toast(errorMessage(e), undefined, 'error'); }
  };

  if (!list) return <p className={f.note}>Loading invites…</p>;
  const active = list.filter((i) => !i.revoked);
  if (!active.length) return <EmptyNote {...COPY.empty.invites} />;
  return (
    <div className={f.scroll}>
      <table className={f.table}>
        <caption className={f.sr}>Active invites</caption>
        <thead><tr><th scope="col">Role</th><th scope="col">Used</th><th scope="col">Expires</th><th scope="col"><span className={f.sr}>Actions</span></th></tr></thead>
        <tbody>
          {active.map((i) => (
            <tr key={i.id}>
              <td>{i.role}</td><td>{i.uses}{i.max_uses ? ` of ${i.max_uses}` : ''}</td><td>{when(i.exp)}</td>
              <td>{canRevoke && <button type="button" className={`btn btn-secondary ${f.danger}`} onClick={() => revoke(i)}>Revoke</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
