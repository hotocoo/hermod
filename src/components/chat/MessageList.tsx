import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LAYOUT, LIMITS, TIMING } from '@/config/app';
import type { VmProps } from '@/components/panel/types';
import { channelsOf, chatKey, meId, threadToLoad } from '@/state/selectors';
import { getMsgs, msgRef } from '@/state/domRefs';
import { useAppStore } from '@/state/store';
import { Message } from './Message';
import s from './chat.module.css';
import x from './messaging.module.css';

const WINDOW = LIMITS.messageWindow;

/** Names of people typing in this chat right now; ticks once a second only while someone is. */
function useTyping(key: string, people: VmProps['vm']['people']): string {
  const map = useAppStore((st) => st.typing[key]); const me = useAppStore((st) => meId(st));
  const [now, setNow] = useState(() => Date.now());
  const live = Object.entries(map ?? {}).filter(([id, until]) => id !== me && until > now).map(([id]) => people[id]?.name.split(' ')[0] ?? 'Someone');
  const any = !!map && Object.keys(map).length > 0;
  useEffect(() => { if (!any) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [any]);
  return live.length === 0 ? '' : live.length === 1 ? `${live[0]} is typing` : `${live.slice(0, 2).join(' and ')} are typing`;
}

export function MessageList({ vm }: VmProps) {
  const key = useAppStore(chatKey);
  const unreadNow = useAppStore((st) => (st.seed ? channelsOf(st.seed, st.space).find((c) => c.id === st.ch[st.space])?.unread ?? 0 : 0));
  const jump = useAppStore((st) => st.jump);
  const [open, setOpen] = useState({ key, unread: unreadNow });
  if (open.key !== key) setOpen({ key, unread: unreadNow });
  const widen = useAppStore((st) => st.widenChat);
  const thread = useAppStore((st) => st.thread); const ensureLoaded = useAppStore((st) => st.ensureLoaded);
  const typing = useTyping(key, vm.people);

  // The view model already cut the list to the window (and stretched it to a loaded jump target).
  const list = vm.messages; const total = list.length; const hidden = vm.hiddenMessages;
  const jumpIdx = jump && jump.key === key ? list.findIndex((m) => m.id === jump.id) : -1;
  const wider = Math.max(0, total - WINDOW) + WINDOW; // extra that shows one more window than now
  const sepAt = open.unread > 0 && open.unread < list.length ? list.length - open.unread : -1;
  const last = list[total - 1];
  const announce = last && !last.isMe && !last.isSystem ? `New message from ${last.name}: ${last.text}` : '';

  const olderMore = useAppStore((st) => st.olderMore[key]); const loadOlder = useAppStore((st) => st.loadOlder);
  // Older messages exist beyond the snapshot unless a page said otherwise; with a short chat there is nothing to probe.
  const canLoad = olderMore ?? total + hidden >= WINDOW;
  const busy = useRef(false); const anchor = useRef<{ h: number; t: number } | null>(null);
  const older = () => {
    const el = getMsgs();
    if (hidden > 0) { if (el) anchor.current = { h: el.scrollHeight, t: el.scrollTop }; widen(key, wider); return Promise.resolve(true); }
    if (!canLoad || busy.current) return Promise.resolve(false);
    busy.current = true; if (el) anchor.current = { h: el.scrollHeight, t: el.scrollTop };
    return loadOlder(key).then((ok) => { if (ok) widen(key, wider); return ok; }).finally(() => { busy.current = false; });
  };
  // Prepending moves content down; keep the same message under the viewport by adding the height that arrived.
  useLayoutEffect(() => {
    const el = getMsgs(); const a = anchor.current; anchor.current = null;
    if (el && a) el.scrollTop = a.t + el.scrollHeight - a.h;
  }, [list[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!jump || jump.key !== key) return;
    const done = () => useAppStore.setState({ jump: null });
    // Not loaded yet: fetch older pages until it appears or history ends.
    if (jumpIdx < 0) { if (canLoad) void loadOlder(key).then((ok) => { if (!ok) done(); }); else done(); return; }
    const t = setTimeout(() => {
      const el = document.getElementById(`msg-${jump.id}`);
      if (el) { let left = LIMITS.jumpSettleFrames; let prev = NaN;
        // Rows above are laid out lazily (content-visibility), so the target keeps moving until they are measured: re-centre until it holds still.
        const go = () => { el.scrollIntoView({ block: 'center' }); const y = el.getBoundingClientRect().top; if (left-- > 0 && y !== prev) { prev = y; requestAnimationFrame(go); } };
        go(); el.animate([{ outline: '2px solid var(--color-accent)' }, { outline: '2px solid transparent' }], { duration: TIMING.jumpFlashMs }); }
      widen(key, Math.max(0, total - WINDOW)); // keep the window wide once the jump is done
      done();
    }, TIMING.jumpSettleMs);
    return () => clearTimeout(t);
  }, [jump, key, total, jumpIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // An open thread whose root sits above the loaded history: page it in (the pane stays open meanwhile).
  useEffect(() => { const want = threadToLoad(thread, vm.threadFound); if (want) void ensureLoaded(key, want); }, [thread, vm.threadFound, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const toUnread = () => document.getElementById('unread-sep')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return (
    <div ref={msgRef} className={s.scroll} role="log" onScroll={(e) => { if (e.currentTarget.scrollTop < LAYOUT.olderTriggerPx) void older(); }} aria-label="Messages" style={{ position: 'relative' }}>
      {sepAt > 0 && <button type="button" className={x.jump} onClick={toUnread}>Jump to {open.unread} unread</button>}
      <div className={s.inner}>
        {(hidden > 0 || canLoad) && <button type="button" className={`btn btn-secondary ${x.older}`} onClick={() => { void older(); }}>Show earlier messages{hidden > 0 ? ` (${hidden})` : ''}</button>}
        <div className={s.today}><span className={s.rule} />Messages<span className={s.rule} /></div>
        {vm.noMessages && (
          <div className={s.quiet}>
            <div className={s.eth} aria-hidden="true">ð</div>
            <h3 className={s.quietTitle}>{vm.emptyTitle}</h3>
            <p className={s.quietLine}>{vm.emptyLine}</p>
          </div>
        )}
        {list.map((m, i) => (
          <div key={m.id}>
            {i === sepAt && <div id="unread-sep" className={x.sep} role="separator" aria-label="New messages"><span className={x.sepRule} />New messages<span className={x.sepRule} /></div>}
            <Message m={m} icons={{ ic: vm.ic, icS: vm.icS }} people={vm.people} />
          </div>
        ))}
      </div>
      <div className={x.typing} aria-live="polite">{typing}</div>
      <div className={s.sr} role="status" aria-live="polite" aria-atomic="true">{announce}</div>
    </div>
  );
}
