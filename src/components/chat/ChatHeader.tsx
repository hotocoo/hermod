import type { VmProps } from '@/components/panel/types';
import { Icon } from '@/components/ui/Icon';
import { COPY } from '@/config/copy';
import { MUTE_CHOICES, isMuted } from '@/state/slices/messaging/helpers';
import { chatKey } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import { ThreadsMenu } from './ThreadsMenu';
import { usePopover } from './usePopover';
import { useChanCfg } from './useMsgView';
import s from './chat.module.css';
import x from './messaging.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';

function Pins({ vm }: VmProps) {
  const [popRef, popOpen, setPopOpen] = usePopover(); const key = useAppStore(chatKey);
  const pinned = vm.pinned;
  return (
    <span ref={popRef} style={{ position: 'relative' }}>
      <button type="button" className={s.search} aria-label={COPY.ui.chat.header.pinnedCount(pinned.length)} aria-expanded={popOpen} title={COPY.ui.chat.header.pinned} onClick={() => setPopOpen(!popOpen)}><Icon name="pin" size={16} /></button>
      {popOpen && (
        <ul className={x.menu} style={{ right: 0, top: '100%', width: 300 }} aria-label={COPY.ui.chat.header.pinned}>
          {pinned.length === 0 && <li><EmptyNote {...COPY.empty.chatPins} /></li>}
          {pinned.map((m) => (
            <li key={m.id}><button type="button" className={s.popItem} onClick={() => { useAppStore.setState({ jump: { key, id: m.id } }); setPopOpen(false); }}>
              <span className={x.grow}><strong>{m.name}</strong> {m.text.slice(0, 80) || COPY.ui.chat.header.attachment}</span></button></li>
          ))}
        </ul>
      )}
    </span>
  );
}

function ChatMenu({ vm }: VmProps) {
  const [popRef, popOpen, setPopOpen] = usePopover(); const st = useAppStore(); const key = chatKey(st); const cfg = useChanCfg();
  const muted = isMuted(st.prefs.muted, key); const pinned = (st.prefs.pinned ?? []).includes(key); const archived = (st.prefs.archived ?? []).includes(key);
  const item = (label: string, fn: () => void) => <li key={label}><button type="button" className={s.popItem} onClick={() => { fn(); setPopOpen(false); }}>{label}</button></li>;
  return (
    <span ref={popRef} style={{ position: 'relative' }}>
      <button type="button" className={s.search} aria-label={COPY.ui.chat.header.options} aria-haspopup="menu" aria-expanded={popOpen} onClick={() => setPopOpen(!popOpen)}><Icon name="more" size={16} /></button>
      {popOpen && (
        <ul className={x.menu} style={{ right: 0, top: '100%' }} role="menu" aria-label={COPY.ui.chat.header.options}>
          {item(pinned ? COPY.ui.chat.header.unpinChat : COPY.ui.chat.header.pinChat, () => { void st.togglePinChat(key); })}
          {item(archived ? COPY.ui.chat.header.unarchiveChat : COPY.ui.chat.header.archiveChat, () => { void st.toggleArchiveChat(key); })}
          {(st.prefs.folders ?? []).map((fo) => item((fo.include.includes(key) ? COPY.folderRemoveChat : COPY.folderAddChat)(fo.name), () => { void st.toggleChatInFolder(fo.id, key); }))}
          {muted ? item(COPY.ui.chat.header.unmute, () => { void st.muteChat(key, null); }) : MUTE_CHOICES.map((c) => item(COPY.ui.chat.header.muteFor(c.label), () => { void st.muteChat(key, c.ms); }))}
          {item(COPY.ui.chat.header.summarize, () => { const t = vm.messages.filter((m) => !m.removed).slice(-60).map((m) => `${m.name}: ${m.text}`).join('\n'); void st.localAi('summarize', t).then((a) => { if (a) st.showToast(a.slice(0, 400)); }); })}
          {item(COPY.ui.chat.header.media, () => st.openModal({ kind: 'gallery' }))}
          {item(COPY.ui.chat.header.scheduled, () => st.openModal({ kind: 'schedule' }))}
          {(cfg?.canManage ?? false) && item(COPY.ui.chat.header.channelSettings, () => st.openModal({ kind: 'channelSettings', space: st.space, channel: st.ch[st.space] }))}
        </ul>
      )}
    </span>
  );
}

/** Hearth drop-in for ordinary channels; per-channel Join or Leave voice for voice and stage channels. */
function VoiceButton({ vm, kind }: VmProps & { kind?: string }) {
  const st = useAppStore(); const chan = st.ch[st.space];
  if (kind === 'voice' || kind === 'stage') {
    const here = st.call?.space === st.space && st.call.room === chan;
    return <button type="button" className={s.drop} onClick={() => { void (here ? st.leave() : st.join(st.space, chan)); }}>{vm.icS.flame} {here ? COPY.ui.chat.header.leaveVoice : COPY.ui.chat.header.joinVoice}</button>;
  }
  return vm.hasRoom ? <button type="button" onClick={vm.joinRoom} className={s.drop}>{vm.icS.flame} {COPY.ui.chat.header.dropInto(vm.hearth?.name ?? '')}</button> : null;
}

export function ChatHeader({ vm, onToggleNav, navOpen }: VmProps & { onToggleNav: () => void; navOpen: boolean }) {
  const cfg = useChanCfg(); const key = useAppStore(chatKey); const muted = useAppStore((st) => isMuted(st.prefs.muted, key));
  const kind = cfg?.kind && cfg.kind !== 'text' ? cfg.kind : null;
  return (
    <header className={s.head}>
      <button type="button" className={s.navToggle} onClick={onToggleNav} aria-label={COPY.ui.chat.channels} aria-expanded={navOpen} aria-controls="chat-channels">{vm.ic.chat}</button>
      <div className={s.headMain}>
        <h2 className={s.name}>{vm.chan.notDm && vm.chan.name && <span className={s.hash} aria-hidden="true">#</span>}{vm.chan.name || COPY.ui.chat.header.noChannel}
          {kind && <span className={`${x.badge} ${x.badgeOn}`} style={{ marginLeft: 8 }}>{kind}</span>}{muted && <span className={x.badge} style={{ marginLeft: 6 }}>{COPY.ui.chat.header.muted}</span>}</h2>
        <p className={s.topic}>{vm.chan.topic}{cfg && cfg.ttlSecs > 0 ? COPY.ui.chat.header.disappearing(cfg.ttlSecs >= 86400 ? `${Math.round(cfg.ttlSecs / 86400)}d` : cfg.ttlSecs >= 3600 ? `${Math.round(cfg.ttlSecs / 3600)}h` : `${cfg.ttlSecs}s`) : ''}</p>
      </div>
      <VoiceButton vm={vm} kind={cfg?.kind} />
      <ThreadsMenu />
      <Pins vm={vm} />
      <button type="button" onClick={vm.openPalette} aria-label={COPY.ui.chat.header.search} className={s.search}>{vm.ic.search}</button>
      <ChatMenu vm={vm} />
    </header>
  );
}
