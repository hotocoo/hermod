import { useState } from 'react';
import type { VmProps } from '@/components/panel/types';
import { Icon } from '@/components/ui/Icon';
import { PresenceDot } from '@/components/ui/PresenceDot';
import type { Role } from '@/lib/bridge';
import { DM_KIND } from '@/config/app';
import { hiddenAsArchived, inFolder, isMuted, pinnedFirst } from '@/state/slices/messaging/helpers';
import { roomOf, spaceUnread } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import { msgColl, useMsgView } from './useMsgView';
import s from './chat.module.css';
import x from './messaging.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

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
  /** Archive, mute and folder rules shared by channel rows and DM Space rows. */
  const shown = (k: string, unread: boolean, kind: { dm: boolean; group: boolean }) => {
    if (hiddenAsArchived(archived.includes(k), showArchived, unread, isMuted(prefs.muted, k))) return false;
    return !active || inFolder(active, k, { ...kind, unread });
  };
  const visible = (c: (typeof vm.channels)[number]) => {
    const cfg = cfgOf(c.id);
    if (cfg && RANK[role as Role] < RANK[cfg.viewMin]) return false;
    return shown(keyOf(c.id), c.hasUnread, { dm: c.isDm, group: false });
  };
  const rows = vm.channels.filter(visible);
  const sorted = (list: typeof rows) => pinnedFirst([...list].sort((a, b) => (cfgOf(a.id)?.position ?? 0) - (cfgOf(b.id)?.position ?? 0)), (c) => keyOf(c.id), pinned);
  const channels = sorted(rows.filter((c) => c.notDm)); const dms = sorted(rows.filter((c) => c.isDm));
  const cats = [...new Set(channels.map((c) => cfgOf(c.id)?.category ?? ''))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  // A DM Space has one chat; its key is the Space and its open channel. Group or pair is fixed at creation (Space.group).
  const dmRows = pinnedFirst(st.spaces.filter((sp) => sp.kind === DM_KIND).map((sp) => ({ sp, key: `${sp.id}/${st.ch[sp.id] ?? sp.defaultChannel ?? ''}`, unread: sp.id === st.space || !st.seed ? 0 : spaceUnread(st, st.seed, sp.id) }))
    .filter((r) => shown(r.key, r.unread > 0, { dm: true, group: !!r.sp.group })), (r) => r.key, pinned);

  const item = (c: (typeof vm.channels)[number]) => {
    const k = keyOf(c.id); const cfg = cfgOf(c.id); const muted = isMuted(prefs.muted, k);
    const icon = cfg?.kind === 'announcement' ? 'bell' : cfg?.kind === 'forum' ? 'chat' : cfg?.kind === 'voice' || cfg?.kind === 'stage' ? 'mic' : 'hash';
    return (
      <div key={c.id} className={x.chRow}>
        <button type="button" onClick={c.onClick} className={muted ? `${s.ch} ${x.muted}` : s.ch} aria-current={c.active ? 'page' : undefined} style={{ background: c.bg, color: c.color, fontWeight: c.weight, flex: 1 }}>
          {c.isDm ? <span className={s.chFace}><span aria-hidden="true">{c.initials}</span><PresenceDot id={c.dmId} /></span> : <Icon name={icon} size={14} strokeWidth={1.8} />}
          <span className={s.chName}>{c.name}</span>
          {voiceIn(c.id) > 0 && <span className={x.badge} title={COPY.ui.chat.channelList.inVoiceNow}>{voiceIn(c.id)}</span>}
          {pinned.includes(k) && <Icon name="pin" size={11} />}
          {c.hasUnread && <span className={s.chBadge} aria-label={COPY.ui.chat.channelList.unread(c.unread)}>{c.unread}</span>}
        </button>
      </div>
    );
  };
  return (
    <nav aria-label={COPY.ui.chat.channels} className={open ? s.nav : `${s.nav} ${s.navHide}`} id="chat-channels">
      {folders.length > 0 && (
        <div className={x.folderRow} role="group" aria-label={COPY.ui.chat.channelList.folders}>
          {[{ id: '', name: COPY.ui.chat.channelList.all }, ...folders].map((f) => <button key={f.id} type="button" className={`${x.chip2} ${folder === f.id ? x.chipOn : ''}`} aria-pressed={folder === f.id} onClick={() => setFolder(f.id)}>{f.name}</button>)}
        </div>
      )}
      {!vm.isHome && (
        <>
          <div className={s.navHead}>{COPY.ui.chat.channels}
            <button type="button" className={s.navAdd} onClick={vm.newChannel} aria-label={COPY.ui.chat.channelList.newChannel} title={COPY.ui.chat.channelList.newChannel}><Icon name="plus" size={14} /></button>
          </div>
          {channels.length === 0 && <EmptyNote {...COPY.empty.chatChannels} />}
          {cats.map((cat) => (
            <div key={cat || '_'}>
              {cat && <button type="button" className={x.cat} aria-expanded={!shut[cat]} onClick={() => setShut({ ...shut, [cat]: !shut[cat] })}>{shut[cat] ? '+' : '-'} {cat}</button>}
              {!shut[cat] && channels.filter((c) => (cfgOf(c.id)?.category ?? '') === cat).map(item)}
            </div>
          ))}
        </>
      )}
      {(
        <div className={s.navHead}>{COPY.ui.chat.channelList.directMessages}
          <button type="button" className={s.navAdd} onClick={() => st.openModal({ kind: 'contacts' })} aria-label={COPY.ui.chat.channelList.newMessage} title={COPY.ui.chat.channelList.newMessage}><Icon name="plus" size={14} /></button>
        </div>
      )}
      {requests.length > 0 && (
        <section aria-label={COPY.ui.chat.channelList.messageRequests}>
          <div className={x.cat}>{COPY.ui.chat.channelList.requests(requests.length)}</div>
          {requests.map((r) => (
            <div key={r.id} className={x.listRow} style={{ padding: '4px 10px' }}>
              <span className={x.grow}>{vm.people[r.from]?.name ?? r.from.slice(0, 8)}{r.group ? COPY.ui.chat.channelList.groupSuffix : ''}</span>
              <button type="button" className="btn btn-primary" onClick={() => { void st.acceptDm(r.id); }}>{COPY.ui.chat.channelList.accept}</button>
              <button type="button" className="btn btn-secondary" onClick={() => { void st.declineDm(r.id); }}>{COPY.ui.chat.channelList.decline}</button>
            </div>
          ))}
        </section>
      )}
      <button type="button" className={s.ch} onClick={() => { void st.openSaved(); }}><Icon name="bookmark" size={14} /><span className={s.chName}>{COPY.ui.chat.channelList.savedMessages}</span></button>
      {dmRows.map(({ sp, key, unread }) => (
        <div key={sp.id} className={x.chRow}>
          <button type="button" className={isMuted(prefs.muted, key) ? `${s.ch} ${x.muted}` : s.ch} onClick={() => st.goSpace(sp.id)} aria-current={sp.id === st.space ? 'page' : undefined} style={{ flex: 1 }}>
            <span className={s.chFace} aria-hidden="true">{sp.mono}</span><span className={s.chName}>{sp.name}</span>
            {pinned.includes(key) && <Icon name="pin" size={11} />}
            {unread > 0 && <span className={s.chBadge} aria-label={COPY.ui.chat.channelList.unread(unread)}>{unread}</span>}
          </button>
        </div>
      ))}
      {vm.isHome && dms.length === 0 && dmRows.length === 0 && <EmptyNote {...COPY.empty.chatDms} />}
      {dms.map(item)}
      {archived.length > 0 && <button type="button" className={x.cat} aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>{COPY.ui.chat.channelList.archived(showArchived, archived.length)}</button>}
      <button type="button" className={s.ch} onClick={() => st.openModal({ kind: 'privacy' })}><Icon name="lock" size={14} /><span className={s.chName}>{COPY.ui.chat.channelList.privacy}</span></button>
    </nav>
  );
}
