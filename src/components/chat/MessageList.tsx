import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LAYOUT, LIMITS, TIMING } from '@/config/app';
import type { VmProps } from '@/components/panel/types';
import { channelsOf, chatKey, meId } from '@/state/selectors';
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
  const [open, setOpen] = useState({ key, unread: unreadNow, extra: 0 });
  if (open.key !== key) setOpen({ key, unread: unreadNow, extra: 0 });
  const typing = useTyping(key, vm.people);

  const total = vm.messages.length;
  const jumpIdx = jump && jump.key === key ? vm.messages.findIndex((m) => m.id === jump.id) : -1;
  const shown = Math.min(total, WINDOW + Math.max(open.extra, jumpIdx < 0 ? 0 : total - jumpIdx - WINDOW)); // a jump target folded by the window widens it
  const list = useMemo(() => vm.messages.slice(total - shown), [vm.messages, total, shown]);
  const sepAt = open.unread > 0 && open.unread < list.length ? list.length - open.unread : -1;
  const last = vm.messages[total - 1];
  const announce = last && !last.isMe && !last.isSystem ? `New message from ${last.name}: ${last.text}` : '';

  const olderMore = useAppStore((st) => st.olderMore[key]); const loadOlder = useAppStore((st) => st.loadOlder);
  // Older messages exist beyond the snapshot unless a page said otherwise; with a short chat there is nothing to probe.
  const canLoad = olderMore ?? total >= WINDOW;
  const busy = useRef(false); const anchor = useRef<{ h: number; t: number } | null>(null);
  const older = () => {
    const el = getMsgs();
    if (shown < total) { if (el) anchor.current = { h: el.scrollHeight, t: el.scrollTop }; setOpen((o) => ({ ...o, extra: o.extra + WINDOW })); return Promise.resolve(true); }
    if (!canLoad || busy.current) return Promise.resolve(false);
    busy.current = true; if (el) anchor.current = { h: el.scrollHeight, t: el.scrollTop };
    return loadOlder(key).then((ok) => { if (ok) setOpen((o) => ({ ...o, extra: o.extra + WINDOW })); return ok; }).finally(() => { busy.current = false; });
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
      setOpen((o) => ({ ...o, extra: Math.max(o.extra, total - jumpIdx - WINDOW) })); // keep the window wide once the jump is done
      done();
    }, TIMING.jumpSettleMs);
    return () => clearTimeout(t);
  }, [jump, key, total, jumpIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const toUnread = () => document.getElementById('unread-sep')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return (
    <div ref={msgRef} className={s.scroll} role="log" onScroll={(e) => { if (e.currentTarget.scrollTop < LAYOUT.olderTriggerPx) void older(); }} aria-label="Messages" style={{ position: 'relative' }}>
      {sepAt > 0 && <button type="button" className={x.jump} onClick={toUnread}>Jump to {open.unread} unread</button>}
      <div className={s.inner}>
        {(shown < total || canLoad) && <button type="button" className={`btn btn-secondary ${x.older}`} onClick={() => { void older(); }}>Show earlier messages{shown < total ? ` (${total - shown})` : ''}</button>}
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
