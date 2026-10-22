import { useEffect, useRef, useState } from 'react';
import type { VmProps } from '@/components/panel/types';
import { Icon } from '@/components/ui/Icon';
import { COPY } from '@/config/copy';
import { MUTE_CHOICES, isMuted } from '@/state/slices/messaging/helpers';
import { chatKey } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import { useChanCfg } from './useMsgView';
import s from './chat.module.css';
import x from './messaging.module.css';

/** Click-away and Escape for a popover that lives next to its button. */
function usePopover() {
  const [open, setOpen] = useState(false); const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return [root, open, setOpen] as const;
}

function Pins({ vm }: VmProps) {
  const [popRef, popOpen, setPopOpen] = usePopover(); const key = useAppStore(chatKey);
  const pinned = vm.messages.filter((m) => m.raw.pinned && !m.removed);
  return (
    <span ref={popRef} style={{ position: 'relative' }}>
      <button type="button" className={s.search} aria-label={`Pinned messages (${pinned.length})`} aria-expanded={popOpen} title="Pinned messages" onClick={() => setPopOpen(!popOpen)}><Icon name="pin" size={16} /></button>
      {popOpen && (
        <ul className={x.menu} style={{ right: 0, top: '100%', width: 300 }} aria-label="Pinned messages">
          {pinned.length === 0 && <li className={x.empty}>Nothing is pinned yet.</li>}
          {pinned.map((m) => (
            <li key={m.id}><button type="button" className={s.popItem} onClick={() => { useAppStore.setState({ jump: { key, id: m.id } }); setPopOpen(false); }}>
              <span className={x.grow}><strong>{m.name}</strong> {m.text.slice(0, 80) || 'Attachment'}</span></button></li>
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
      <button type="button" className={s.search} aria-label="Chat options" aria-haspopup="menu" aria-expanded={popOpen} onClick={() => setPopOpen(!popOpen)}><Icon name="more" size={16} /></button>
      {popOpen && (
        <ul className={x.menu} style={{ right: 0, top: '100%' }} role="menu" aria-label="Chat options">
          {item(pinned ? 'Unpin chat' : 'Pin chat', () => { void st.togglePinChat(key); })}
          {item(archived ? 'Unarchive chat' : 'Archive chat', () => { void st.toggleArchiveChat(key); })}
          {(st.prefs.folders ?? []).map((fo) => item((fo.include.includes(key) ? COPY.folderRemoveChat : COPY.folderAddChat)(fo.name), () => { void st.toggleChatInFolder(fo.id, key); }))}
          {muted ? item('Unmute', () => { void st.muteChat(key, null); }) : MUTE_CHOICES.map((c) => item(`Mute for ${c.label}`, () => { void st.muteChat(key, c.ms); }))}
          {item('Summarize chat with local AI', () => { const t = vm.messages.filter((m) => !m.removed).slice(-60).map((m) => `${m.name}: ${m.text}`).join('\n'); void st.localAi('summarize', t).then((a) => { if (a) st.showToast(a.slice(0, 400)); }); })}
          {item('Media, files and links', () => st.openModal({ kind: 'gallery' }))}
          {item('Scheduled messages', () => st.openModal({ kind: 'schedule' }))}
          {(cfg?.canManage ?? false) && item('Channel settings', () => st.openModal({ kind: 'channelSettings', space: st.space, channel: st.ch[st.space] }))}
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
    return <button type="button" className={s.drop} onClick={() => { void (here ? st.leave() : st.join(st.space, chan)); }}>{vm.icS.flame} {here ? 'Leave voice' : 'Join voice'}</button>;
  }
  return vm.hasRoom ? <button type="button" onClick={vm.joinRoom} className={s.drop}>{vm.icS.flame} Drop into {vm.hearth?.name}</button> : null;
}

export function ChatHeader({ vm, onToggleNav, navOpen }: VmProps & { onToggleNav: () => void; navOpen: boolean }) {
  const cfg = useChanCfg(); const key = useAppStore(chatKey); const muted = useAppStore((st) => isMuted(st.prefs.muted, key));
  const kind = cfg?.kind && cfg.kind !== 'text' ? cfg.kind : null;
  return (
    <header className={s.head}>
      <button type="button" className={s.navToggle} onClick={onToggleNav} aria-label="Channels" aria-expanded={navOpen} aria-controls="chat-channels">{vm.ic.chat}</button>
      <div className={s.headMain}>
        <h2 className={s.name}>{vm.chan.notDm && vm.chan.name && <span className={s.hash} aria-hidden="true">#</span>}{vm.chan.name || 'No channel yet'}
          {kind && <span className={`${x.badge} ${x.badgeOn}`} style={{ marginLeft: 8 }}>{kind}</span>}{muted && <span className={x.badge} style={{ marginLeft: 6 }}>muted</span>}</h2>
        <p className={s.topic}>{vm.chan.topic}{cfg && cfg.ttlSecs > 0 ? ` Disappearing messages: ${cfg.ttlSecs >= 86400 ? `${Math.round(cfg.ttlSecs / 86400)}d` : cfg.ttlSecs >= 3600 ? `${Math.round(cfg.ttlSecs / 3600)}h` : `${cfg.ttlSecs}s`}.` : ''}</p>
      </div>
      <VoiceButton vm={vm} kind={cfg?.kind} />
      <Pins vm={vm} />
      <button type="button" onClick={vm.openPalette} aria-label="Search" className={s.search}>{vm.ic.search}</button>
      <ChatMenu vm={vm} />
    </header>
  );
}
