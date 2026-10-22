import { useState } from 'react';
import type { VmProps } from '@/components/panel/types';
import { Icon } from '@/components/ui/Icon';
import { PresenceDot } from '@/components/ui/PresenceDot';
import type { Role } from '@/lib/bridge';
import { inFolder, isMuted } from '@/state/slices/messaging/helpers';
import { roomOf } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import { msgColl, useMsgView } from './useMsgView';
import s from './chat.module.css';
import x from './messaging.module.css';

const RANK: Record<Role, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

/** Channels grouped by category, DMs, requests and saved notes of the open Space. Collapses behind a toggle on narrow panels. */
export function ChannelList({ vm, open }: VmProps & { open: boolean }) {
  const st = useAppStore(); const view = useMsgView(); const requests = msgColl(st)?.dmRequests ?? [];
  const [folder, setFolder] = useState(''); const [showArchived, setShowArchived] = useState(false); const [shut, setShut] = useState<Record<string, boolean>>({});
  const role = st.spaces.find((sp) => sp.id === st.space)?.role ?? 'member';
  const prefs = st.prefs; const pinned = prefs.pinned ?? []; const archived = prefs.archived ?? [];
  const folders = prefs.folders ?? []; const active = folders.find((f) => f.id === folder);
  const voiceIn = (id: string) => (st.seed ? roomOf(st.seed, st.space)?.channels?.[id]?.length : 0) ?? 0;
  const cfgOf = (id: string) => view?.channels?.[id];
  const keyOf = (id: string) => `${st.space}/${id}`;
  const visible = (c: (typeof vm.channels)[number]) => {
    const cfg = cfgOf(c.id);
    if (cfg && RANK[role as Role] < RANK[cfg.viewMin]) return false;
    const k = keyOf(c.id); const isArch = archived.includes(k);
    if (isArch && !showArchived && !c.hasUnread) return false;
    if (active && !inFolder(active, k, { dm: c.isDm, group: false, unread: c.hasUnread })) return false;
    return true;
  };
  const rows = vm.channels.filter(visible);
  const sorted = (list: typeof rows) => [...list].sort((a, b) => Number(pinned.includes(keyOf(b.id))) - Number(pinned.includes(keyOf(a.id))) || (cfgOf(a.id)?.position ?? 0) - (cfgOf(b.id)?.position ?? 0));
  const channels = sorted(rows.filter((c) => c.notDm)); const dms = sorted(rows.filter((c) => c.isDm));
  const cats = [...new Set(channels.map((c) => cfgOf(c.id)?.category ?? ''))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  const dmSpaces = st.spaces.filter((sp) => sp.kind === 'dm');

  const item = (c: (typeof vm.channels)[number]) => {
    const k = keyOf(c.id); const cfg = cfgOf(c.id); const muted = isMuted(prefs.muted, k);
    const icon = cfg?.kind === 'announcement' ? 'bell' : cfg?.kind === 'forum' ? 'chat' : cfg?.kind === 'voice' || cfg?.kind === 'stage' ? 'mic' : 'hash';
    return (
      <div key={c.id} className={x.chRow}>
        <button type="button" onClick={c.onClick} className={s.ch} aria-current={c.active ? 'page' : undefined} style={{ background: c.bg, color: c.color, fontWeight: c.weight, opacity: muted ? 0.6 : 1, flex: 1 }}>
          {c.isDm ? <span className={s.chFace}><span aria-hidden="true">{c.initials}</span><PresenceDot id={c.dmId} /></span> : <Icon name={icon} size={14} strokeWidth={1.8} />}
          <span className={s.chName}>{c.name}</span>
          {voiceIn(c.id) > 0 && <span className={x.badge} title="In voice now">{voiceIn(c.id)}</span>}
          {pinned.includes(k) && <Icon name="pin" size={11} />}
          {c.hasUnread && <span className={s.chBadge} aria-label={`${c.unread} unread`}>{c.unread}</span>}
        </button>
      </div>
    );
  };
  return (
    <nav aria-label="Channels" className={open ? s.nav : `${s.nav} ${s.navHide}`} id="chat-channels">
      {folders.length > 0 && (
        <div className={x.folderRow} role="group" aria-label="Folders">
          {[{ id: '', name: 'All' }, ...folders].map((f) => <button key={f.id} type="button" className={`${x.chip2} ${folder === f.id ? x.chipOn : ''}`} aria-pressed={folder === f.id} onClick={() => setFolder(f.id)}>{f.name}</button>)}
        </div>
      )}
      {!vm.isHome && (
        <>
          <div className={s.navHead}>Channels
            <button type="button" className={s.navAdd} onClick={vm.newChannel} aria-label="New channel" title="New channel"><Icon name="plus" size={14} /></button>
          </div>
          {channels.length === 0 && <p style={{ margin: '4px 10px', fontSize: 12, fontStyle: 'italic' }}>No channels yet.</p>}
          {cats.map((cat) => (
            <div key={cat || '_'}>
              {cat && <button type="button" className={x.cat} aria-expanded={!shut[cat]} onClick={() => setShut({ ...shut, [cat]: !shut[cat] })}>{shut[cat] ? '+' : '-'} {cat}</button>}
              {!shut[cat] && channels.filter((c) => (cfgOf(c.id)?.category ?? '') === cat).map(item)}
            </div>
          ))}
        </>
      )}
      {(
        <div className={s.navHead}>Direct messages
          <button type="button" className={s.navAdd} onClick={() => st.openModal({ kind: 'contacts' })} aria-label="New message or contacts" title="New message or contacts"><Icon name="plus" size={14} /></button>
        </div>
      )}
      {requests.length > 0 && (
        <section aria-label="Message requests">
          <div className={x.cat}>Requests ({requests.length})</div>
          {requests.map((r) => (
            <div key={r.id} className={x.listRow} style={{ padding: '4px 10px' }}>
              <span className={x.grow}>{vm.people[r.from]?.name ?? r.from.slice(0, 8)}{r.group ? ' (group)' : ''}</span>
              <button type="button" className="btn btn-primary" onClick={() => { void st.acceptDm(r.id); }}>Accept</button>
              <button type="button" className="btn btn-secondary" onClick={() => { void st.declineDm(r.id); }}>Decline</button>
            </div>
          ))}
        </section>
      )}
      <button type="button" className={s.ch} onClick={() => { void st.openSaved(); }}><Icon name="bookmark" size={14} /><span className={s.chName}>Saved messages</span></button>
      {dmSpaces.map((sp) => (
        <button key={sp.id} type="button" className={s.ch} onClick={() => st.goSpace(sp.id)} aria-current={sp.id === st.space ? 'page' : undefined}><span className={s.chFace} aria-hidden="true">{sp.mono}</span><span className={s.chName}>{sp.name}</span></button>
      ))}
      {vm.isHome && dms.length === 0 && dmSpaces.length === 0 && <p style={{ margin: '4px 10px', fontSize: 12, fontStyle: 'italic' }}>Start one with the plus, or from search (Ctrl K).</p>}
      {dms.map(item)}
      {archived.length > 0 && <button type="button" className={x.cat} aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Hide' : 'Show'} archived ({archived.length})</button>}
      <button type="button" className={s.ch} onClick={() => st.openModal({ kind: 'privacy' })}><Icon name="lock" size={14} /><span className={s.chName}>Privacy and chat settings</span></button>
    </nav>
  );
}
