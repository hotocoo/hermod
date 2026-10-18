'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage, getBridge, type AuditRow, type Member, type Role } from '@/lib/bridge';
import { appendEvent } from '@/state/act';
import { spaceOf } from '@/state/helpers';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { InviteList } from './InviteList';

const TABS = [['general', 'General'], ['members', 'Members'], ['invites', 'Invites'], ['safety', 'Safety']] as const;
const ROLES: Role[] = ['owner', 'admin', 'member', 'guest'];
const RETENTION = [{ v: '', l: 'Keep everything' }, { v: '30', l: '30 days' }, { v: '90', l: '90 days' }, { v: '365', l: '1 year' }];

/** Space settings: rename, members and roles, invites, safety (U-013, U-014, E-004, E-007). */
export function SpaceSettingsModal({ space }: { space: string }) {
  const s = useAppStore();
  const sp = spaceOf(s.spaces, space);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('general');
  const isHome = sp.kind === 'Personal';
  const me = s.me?.user_id;
  const toast = s.showToast;
  const [members, setMembers] = useState<Member[] | null>(null);
  const load = useCallback(() => { getBridge().spaceMembers(space).then(setMembers).catch((e) => { setMembers([]); toast(errorMessage(e), undefined, 'error'); }); }, [space, toast]);
  useEffect(() => { load(); return getBridge().on('changed', load); }, [load]);
  // The core is the authority: the store role trails it by a snapshot debounce, and invite_list answers 400 for a non-admin.
  const role = members ? members.find((m) => m.user_id === me && !m.removed)?.role : sp.role;
  const admin = role === 'owner' || role === 'admin';
  return (
    <Dialog title={sp.name} kicker="Space settings" onClose={s.closeModal} wide>
      <div role="tablist" className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {TABS.filter(([id]) => !isHome || id === 'general').map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="seg-opt" onClick={() => setTab(id)}
            style={tab === id ? { color: 'var(--color-accent-700)', boxShadow: 'inset 0 0 0 1px var(--color-accent)' } : undefined}>{label}</button>
        ))}
      </div>
      {tab === 'general' && <General space={space} admin={admin} home={isHome} />}
      {tab === 'members' && <Members space={space} list={members} reload={load} admin={admin} owner={role === 'owner'} />}
      {tab === 'invites' && (!members ? <p className={f.note}>Loading invites…</p> : admin ? <InviteList space={space} /> : <p className={f.note}>Only admins manage invites.</p>)}
      {tab === 'safety' && <Safety space={space} admin={!!members && admin} />}
    </Dialog>
  );
}

function General({ space, admin, home }: { space: string; admin: boolean; home: boolean }) {
  const get = useAppStore.getState;
  const sp = useAppStore((s) => spaceOf(s.spaces, space));
  const leave = useAppStore((s) => s.leaveSpace);
  const confirm = useAppStore((s) => s.confirmAction);
  const close = useAppStore((s) => s.closeModal);
  const [name, setName] = useState(sp.name);
  const [tag, setTag] = useState(sp.tagline);
  const dirty = name.trim() !== sp.name || tag.trim() !== sp.tagline;
  const save = async () => { if (name.trim() && await appendEvent(get, space, { t: 'space.update', name: name.trim(), tagline: tag.trim() })) get().showToast('Saved'); };
  const doLeave = async () => {
    if (await confirm({ title: `Leave ${sp.name}?`, body: 'You lose access on this device. You need a new invite to come back. Others keep what you shared.', confirm: 'Leave Space', danger: true }) && await leave(space)) close();
  };
  return (
    <>
      <div className={f.field}><label className={f.label} htmlFor="ss-name">Name</label>
        <input id="ss-name" className="input" value={name} disabled={!admin} onChange={(e) => setName(e.target.value)} /></div>
      <div className={f.field}><label className={f.label} htmlFor="ss-tag">Tagline</label>
        <input id="ss-tag" className="input" value={tag} disabled={!admin} onChange={(e) => setTag(e.target.value)} /></div>
      {!admin && !home && <p className={f.note}>Only admins can change these.</p>}
      <p className={f.note}>Buildings are raised from the island itself: open an empty plot and choose Raise. Raised buildings stay for everyone.</p>
      <div className={f.actions}>
        {!home && <button type="button" className={`btn btn-secondary ${f.danger}`} onClick={doLeave}>Leave Space</button>}
        <button type="button" className="btn btn-primary" disabled={!admin || !dirty || !name.trim()} onClick={save}>Save</button>
      </div>
    </>
  );
}

function Members({ space, list, reload, admin, owner }: { space: string; list: Member[] | null; reload: () => void; admin: boolean; owner: boolean }) {
  const toast = useAppStore((s) => s.showToast);
  const confirm = useAppStore((s) => s.confirmAction);
  const blocked = useAppStore((s) => s.blocked);
  const me = useAppStore((s) => s.me?.user_id);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); reload(); } catch (e) { toast(errorMessage(e), undefined, 'error'); } };
  const toggleBlock = (m: Member) => run(async () => {
    const b = getBridge();
    await (blocked[m.user_id] ? b.unblockUser(m.user_id) : b.blockUser(m.user_id));
    useAppStore.getState().setBlocked((await b.blockList()).map((x) => x.user_id));
  });
  if (!list) return <p className={f.note}>Loading members…</p>;
  const active = list.filter((m) => !m.removed);
  if (!active.length) return <p className={f.note}>No members yet.</p>;
  return (
    <div className={f.scroll}>
      <table className={f.table}>
        <caption className={f.sr}>Members</caption>
        <thead><tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col"><span className={f.sr}>Actions</span></th></tr></thead>
        <tbody>
          {active.map((m) => (
            <tr key={m.user_id}>
              <td><span aria-label={m.online ? 'online' : 'offline'} title={m.online ? 'online' : 'offline'} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 8, background: m.online ? 'var(--color-accent)' : 'var(--color-neutral-400)' }} />{m.name}{m.user_id === me ? ' (you)' : ''}</td>
              <td>
                {owner && m.user_id !== me ? (
                  <select aria-label={`Role of ${m.name}`} className="input" value={m.role} onChange={(e) => run(() => getBridge().memberSetRole(space, m.user_id, e.target.value as Role))}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : m.role}
              </td>
              <td>
                {m.user_id !== me && (
                  <span className={f.row}>
                    <button type="button" className="btn btn-secondary" onClick={() => toggleBlock(m)}>{blocked[m.user_id] ? 'Unblock' : 'Block'}</button>
                    {admin && m.role !== 'owner' && (
                      <button type="button" className={`btn btn-secondary ${f.danger}`} onClick={async () => {
                        if (await confirm({ title: `Remove ${m.name}?`, body: 'They lose access to new messages. What they already received stays on their device.', confirm: 'Remove', danger: true })) await run(() => getBridge().memberRemove(space, m.user_id));
                      }}>Remove</button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={f.note}>Blocking hides someone for you only, on this device. Admins remove people for everyone.</p>
    </div>
  );
}

function Safety({ space, admin }: { space: string; admin: boolean }) {
  const toast = useAppStore((s) => s.showToast);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [days, setDays] = useState('');
  useEffect(() => { if (admin) getBridge().auditList(space).then(setRows).catch((e) => { setRows([]); toast(errorMessage(e), undefined, 'error'); }); }, [admin, space, toast]);
  const setRetention = async (v: string) => {
    setDays(v);
    try { await getBridge().retentionSet(space, v ? Number(v) : null); toast('Saved'); } catch (e) { toast(errorMessage(e), undefined, 'error'); }
  };
  return (
    <>
      <div className={f.field}>
        <label className={f.label} htmlFor="ss-ret">Delete my copy of messages older than</label>
        <select id="ss-ret" className="input" value={days} onChange={(e) => setRetention(e.target.value)}>
          {RETENTION.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
        <p className={f.note}>Applies to this device only.</p>
      </div>
      {admin && (
        <div className={f.scroll}>
          <h3 style={{ fontSize: 18 }}>Audit log</h3>
          {!rows ? <p className={f.note}>Loading…</p> : rows.length === 0 ? <p className={f.note}>Nothing recorded yet.</p> : (
            <table className={f.table}>
              <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">By</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}><td>{new Date(r.ts).toLocaleString()}</td><td>{r.kind}{r.detail ? `: ${r.detail}` : ''}</td><td>{r.by.slice(0, 8)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
