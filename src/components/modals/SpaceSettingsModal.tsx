'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, getBridge, type AuditRow, type Member, type ReportOutcome, type ReportRow, type Role } from '@/lib/bridge';
import { COPY } from '@/config/copy';
import { JOIN_POW_CHOICES } from '@/config/app';
import { exportRows, toCsv, toJson } from '@/lib/auditExport';
import { appendEvent } from '@/state/act';
import { spaceOf } from '@/state/helpers';
import { displayName, nicksIn, profilesIn } from '@/state/selectors';
import { lastSeenLabel, statusOf } from '@/state/presence';
import { useAppStore } from '@/state/store';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { InviteList } from './InviteList';
import { EmptyNote } from '@/components/panel/EmptyStates';

const TABS = ['general', 'members', 'invites', 'safety'] as const;
const C = () => COPY.ui.settingsModals.space;
const ROLES: Role[] = ['owner', 'admin', 'member', 'guest'];

/** Space settings: rename, members and roles, invites, safety (U-013, U-014, E-004, E-007). */
export function SpaceSettingsModal({ space }: { space: string }) {
  const s = useAppStore();
  const sp = spaceOf(s.spaces, space);
  const [tab, setTab] = useState<(typeof TABS)[number]>('general');
  const isHome = sp.kind === 'Personal';
  const me = s.me?.user_id;
  const toast = s.showToast;
  const [members, setMembers] = useState<Member[] | null>(null);
  const load = useCallback(() => { getBridge().spaceMembers(space).then(setMembers).catch((e) => { setMembers([]); toast(errorMessage(e), undefined, 'error'); }); }, [space, toast]);
  // `off` is exposed so the leave flow can stop polling first: the core answers 400 for a
  // space it stopped tracking, and a `changed` landing mid-leave would ask for it again.
  const off = useRef<() => void>(() => undefined);
  useEffect(() => { load(); off.current = getBridge().on('changed', load); return () => off.current(); }, [load]);
  // The core is the authority: the store role trails it by a snapshot debounce, and invite_list answers 400 for a non-admin.
  const role = members ? members.find((m) => m.user_id === me && !m.removed)?.role : sp.role;
  const admin = role === 'owner' || role === 'admin';
  return (
    <Dialog title={sp.name} kicker={C().kicker} onClose={s.closeModal} wide>
      <div role="tablist" className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {TABS.filter((id) => !isHome || id === 'general').map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="seg-opt" onClick={() => setTab(id)}
            style={tab === id ? { color: 'var(--color-accent-700)', boxShadow: 'inset 0 0 0 1px var(--color-accent)' } : undefined}>{C().tab[id]}</button>
        ))}
      </div>
      {tab === 'general' && <General space={space} admin={admin} home={isHome} stopPolling={() => off.current()} />}
      {tab === 'members' && <Members space={space} list={members} reload={load} admin={admin} owner={role === 'owner'} />}
      {tab === 'invites' && (!members ? <p className={f.note}>{C().loadingInvites}</p> : admin ? <InviteList space={space} /> : <p className={f.note}>{C().invitesAdminOnly}</p>)}
      {tab === 'safety' && <Safety space={space} admin={!!members && admin} />}
    </Dialog>
  );
}

/** E-011: admins pick how much work a new member's join request must prove. Takes effect for invites made afterwards. */
function JoinPow({ space, admin }: { space: string; admin: boolean }) {
  const get = useAppStore.getState;
  const bits = useAppStore((s) => spaceOf(s.spaces, space).joinPowBits ?? 0);
  const save = async (v: number) => { if (await appendEvent(get, space, { t: 'space.update', join_pow_bits: v })) get().showToast(COPY.powSaved); };
  return (
    <div className={f.field}>
      <label className={f.label} htmlFor="ss-pow">{COPY.powLabel}</label>
      <select id="ss-pow" className="input" value={bits} disabled={!admin} onChange={(e) => void save(Number(e.target.value))}>
        {(JOIN_POW_CHOICES.includes(bits) ? JOIN_POW_CHOICES : [...JOIN_POW_CHOICES, bits]).map((b) => <option key={b} value={b}>{b === 0 ? COPY.powOff : COPY.powBits(b)}</option>)}
      </select>
      <p className={f.note}>{COPY.powNote}</p>
    </div>
  );
}

function General({ space, admin, home, stopPolling }: { space: string; admin: boolean; home: boolean; stopPolling: () => void }) {
  const get = useAppStore.getState;
  const sp = useAppStore((s) => spaceOf(s.spaces, space));
  const leave = useAppStore((s) => s.leaveSpace);
  const confirm = useAppStore((s) => s.confirmAction);
  const close = useAppStore((s) => s.closeModal);
  const [name, setName] = useState(sp.name);
  const [tag, setTag] = useState(sp.tagline);
  const dirty = name.trim() !== sp.name || tag.trim() !== sp.tagline;
  const save = async () => { if (name.trim() && await appendEvent(get, space, { t: 'space.update', name: name.trim(), tagline: tag.trim() })) get().showToast(C().saved); };
  const doLeave = async () => {
    if (!(await confirm({ title: C().leaveTitle(sp.name), body: C().leaveBody, confirm: C().leave, danger: true }))) return;
    // Stop the members poll before the core stops tracking the space, or its next `changed`
    // would ask for members of a space that now answers 400.
    stopPolling();
    if (await leave(space)) close();
  };
  return (
    <>
      <div className={f.field}><label className={f.label} htmlFor="ss-name">{C().name}</label>
        <input id="ss-name" className="input" value={name} disabled={!admin} onChange={(e) => setName(e.target.value)} /></div>
      <div className={f.field}><label className={f.label} htmlFor="ss-tag">{C().tagline}</label>
        <input id="ss-tag" className="input" value={tag} disabled={!admin} onChange={(e) => setTag(e.target.value)} /></div>
      {!admin && !home && <p className={f.note}>{C().adminOnly}</p>}
      {!home && <JoinPow space={space} admin={admin} />}
      <p className={f.note}>{C().raiseNote}</p>
      <div className={f.actions}>
        {!home && <button type="button" className={`btn btn-secondary ${f.danger}`} onClick={doLeave}>{C().leave}</button>}
        <button type="button" className="btn btn-primary" disabled={!admin || !dirty || !name.trim()} onClick={save}>{C().save}</button>
      </div>
    </>
  );
}

function Members({ space, list, reload, admin, owner }: { space: string; list: Member[] | null; reload: () => void; admin: boolean; owner: boolean }) {
  const toast = useAppStore((s) => s.showToast);
  const nicks = useAppStore((s) => (s.seed ? nicksIn(s.seed, space) : {}));
  const profiles = useAppStore((s) => (s.seed ? profilesIn(s.seed, space) : {}));
  const presence = useAppStore((s) => s.presence);
  const lastSeen = useAppStore((s) => s.lastSeen);
  const confirm = useAppStore((s) => s.confirmAction);
  const blocked = useAppStore((s) => s.blocked);
  const me = useAppStore((s) => s.me?.user_id);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); reload(); } catch (e) { toast(errorMessage(e), undefined, 'error'); } };
  const toggleBlock = (m: Member) => run(async () => {
    const b = getBridge();
    await (blocked[m.user_id] ? b.unblockUser(m.user_id) : b.blockUser(m.user_id));
    useAppStore.getState().setBlocked((await b.blockList()).map((x) => x.user_id));
  });
  if (!list) return <p className={f.note}>{C().loadingMembers}</p>;
  const active = list.filter((m) => !m.removed);
  if (!active.length) return <EmptyNote {...COPY.empty.members} />;
  return (
    <div className={f.scroll}>
      <table className={f.table}>
        <caption className={f.sr}>{C().members}</caption>
        <thead><tr><th scope="col">{C().colMember}</th><th scope="col">{C().colRole}</th><th scope="col"><span className={f.sr}>{C().colActions}</span></th></tr></thead>
        <tbody>
          {active.map((m) => (
            <tr key={m.user_id}>
              <td>
                <PresenceDot id={m.user_id} inline fallbackOnline={m.online} />{nicks[m.user_id] || m.name}{m.user_id === me ? C().you : ''}
                {(profiles[m.user_id]?.status || profiles[m.user_id]?.pronouns) && (
                  <div className={f.note}>{profiles[m.user_id]?.statusEmoji} {profiles[m.user_id]?.status}{profiles[m.user_id]?.pronouns ? C().pronouns(profiles[m.user_id]?.pronouns ?? '') : ''}</div>
                )}
                {lastSeenLabel(lastSeen[m.user_id]) && !statusOf(presence, m.user_id) && <div className={f.note}>{lastSeenLabel(lastSeen[m.user_id])}</div>}
              </td>
              <td>
                {owner && m.user_id !== me ? (
                  <select aria-label={C().roleOf(nicks[m.user_id] || m.name)} className="input" value={m.role} onChange={(e) => run(() => getBridge().memberSetRole(space, m.user_id, e.target.value as Role))}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : m.role}
              </td>
              <td>
                {m.user_id !== me && (
                  <span className={f.row}>
                    <button type="button" className="btn btn-secondary" onClick={() => toggleBlock(m)}>{blocked[m.user_id] ? C().unblock : C().block}</button>
                    {admin && m.role !== 'owner' && (
                      <button type="button" className={`btn btn-secondary ${f.danger}`} onClick={async () => {
                        if (await confirm({ title: C().removeTitle(m.name), body: C().removeBody, confirm: C().remove, danger: true })) await run(() => getBridge().memberRemove(space, m.user_id));
                      }}>{C().remove}</button>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={f.note}>{C().blockNote}</p>
    </div>
  );
}

function Safety({ space, admin }: { space: string; admin: boolean }) {
  const toast = useAppStore((s) => s.showToast);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [days, setDays] = useState('');
  useEffect(() => {
    let live = true;
    getBridge().retentionGet(space).then((d) => { if (live) setDays(d == null ? '' : String(d)); }).catch((e) => toast(errorMessage(e), undefined, 'error'));
    return () => { live = false; };
  }, [space, toast]);
  const [exporting, setExporting] = useState(false);
  const exportSpace = async () => {
    setExporting(true);
    try {
      const r = await getBridge().spaceExport(space);
      if (r) toast(COPY.exportDone(r.messages, r.files, r.missing));
    } catch (e) { toast(errorMessage(e), undefined, 'error'); } finally { setExporting(false); }
  };
  const seed = useAppStore((s) => s.seed);
  const nameOf = (id: string) => (seed ? displayName(seed, space, id) : id.slice(0, 8));
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const loadReports = useCallback(() => { getBridge().reportsList(space).then(setReports).catch((e) => { setReports([]); toast(errorMessage(e), undefined, 'error'); }); }, [space, toast]);
  useEffect(() => { if (admin) loadReports(); }, [admin, loadReports]);
  const resolve = async (r: ReportRow, outcome: ReportOutcome) => { if (await useAppStore.getState().resolveReport(space, r, outcome)) loadReports(); };
  const open = (r: ReportRow) => {
    const st = useAppStore.getState();
    st.closeModal();
    if (r.target_kind === 'message') st.jumpToMessage(space, r.channel, r.target);
    else { st.goSpace(space); st.goSection('feed'); }
  };
  const save = async (kind: 'csv' | 'json') => {
    const data = exportRows(rows ?? [], nameOf);
    try {
      const saved = await getBridge().saveFile(COPY.audit.fileName(kind), new TextEncoder().encode(kind === 'csv' ? toCsv(data) : toJson(data)));
      if (saved) toast(COPY.audit.exported);
    } catch (e) { toast(errorMessage(e), undefined, 'error'); }
  };
  useEffect(() => { if (admin) getBridge().auditList(space).then(setRows).catch((e) => { setRows([]); toast(errorMessage(e), undefined, 'error'); }); }, [admin, space, toast]);
  const setRetention = async (v: string) => {
    setDays(v);
    try { await getBridge().retentionSet(space, v ? Number(v) : null); toast(COPY.savedToast); } catch (e) { toast(errorMessage(e), undefined, 'error'); getBridge().retentionGet(space).then((d) => setDays(d == null ? '' : String(d))).catch(() => undefined); }
  };
  return (
    <>
      <div className={f.field}>
        <label className={f.label} htmlFor="ss-ret">{COPY.retentionLabel}</label>
        <select id="ss-ret" className="input" value={days} onChange={(e) => setRetention(e.target.value)}>
          {COPY.retentionOptions.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
        <p className={f.note}>{COPY.retentionNote}</p>
      </div>
      <div className={f.field}>
        <span className={f.label} id="ss-export-label">{COPY.exportLabel}</span>
        <button type="button" className="btn btn-secondary" disabled={exporting} onClick={exportSpace}>{COPY.exportButton}</button>
        <p className={f.note}>{COPY.exportNote}</p>
      </div>
      {admin && (
        <div className={f.scroll}>
          <h3 style={{ fontSize: 18 }}>{COPY.report.queue}</h3>
          {!reports ? <p className={f.note}>{C().loading}</p> : reports.length === 0 ? <p className={f.note}>{COPY.report.queueEmpty}</p> : (
            <table className={f.table}>
              <thead><tr>{(['when', 'by', 'what', 'reason', 'action'] as const).map((k) => <th key={k} scope="col">{COPY.report.cols[k]}</th>)}</tr></thead>
              <tbody>{reports.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.ts).toLocaleString()}</td><td>{nameOf(r.by)}</td>
                  <td>{r.target_kind ? `${nameOf(r.target_by)}: ${r.target_text.slice(0, COPY.report.snippetMax)}` : COPY.report.gone}</td>
                  <td>{r.reason || COPY.report.noReason}</td>
                  <td>
                    {r.target_kind && <button type="button" className="btn btn-secondary" aria-label={COPY.report.openLabel(nameOf(r.by))} onClick={() => open(r)}>{COPY.report.open}</button>}{' '}
                    <button type="button" className="btn btn-secondary" aria-label={COPY.report.dismissLabel(nameOf(r.by))} onClick={() => { void resolve(r, 'dismissed'); }}>{COPY.report.dismiss}</button>{' '}
                    {r.target_kind && <button type="button" className="btn btn-secondary" aria-label={COPY.report.removeLabel(nameOf(r.by))} onClick={() => { void resolve(r, 'removed'); }}>{COPY.report.remove}</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <h3 style={{ fontSize: 18 }}>{C().auditHeading}</h3>
          <div>
            <span className={f.note}>{COPY.audit.export}: </span>
            <button type="button" className="btn btn-secondary" disabled={!rows?.length} aria-label={COPY.audit.exportLabel(COPY.audit.csv)} onClick={() => { void save('csv'); }}>{COPY.audit.csv}</button>{' '}
            <button type="button" className="btn btn-secondary" disabled={!rows?.length} aria-label={COPY.audit.exportLabel(COPY.audit.json)} onClick={() => { void save('json'); }}>{COPY.audit.json}</button>
          </div>
          {!rows ? <p className={f.note}>{C().loading}</p> : rows.length === 0 ? <p className={f.note}>{C().auditEmpty}</p> : (
            <table className={f.table}>
              <thead><tr><th scope="col">{C().colWhen}</th><th scope="col">{C().colWhat}</th><th scope="col">{C().colBy}</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}><td>{new Date(r.ts).toLocaleString()}</td><td>{r.kind}{r.detail ? `: ${r.detail}` : ''}</td><td>{nameOf(r.by)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
