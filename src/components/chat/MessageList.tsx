import { useEffect, useMemo, useState } from 'react';
import type { VmProps } from '@/components/panel/types';
import { channelsOf, chatKey, meId } from '@/state/selectors';
import { msgRef } from '@/state/domRefs';
import { useAppStore } from '@/state/store';
import { Message } from './Message';
import s from './chat.module.css';
import x from './messaging.module.css';

/** Messages rendered at once; older ones load on demand (the rest stay folded in the snapshot). */
const WINDOW = 150;

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

  const total = vm.messages.length; const shown = Math.min(total, WINDOW + open.extra);
  const list = useMemo(() => vm.messages.slice(total - shown), [vm.messages, total, shown]);
  const sepAt = open.unread > 0 && open.unread < list.length ? list.length - open.unread : -1;
  const last = vm.messages[total - 1];
  const announce = last && !last.isMe && !last.isSystem ? `New message from ${last.name}: ${last.text}` : '';

  useEffect(() => {
    if (!jump || jump.key !== key) return;
    const id = jump.id;
    const t = setTimeout(() => {
      const el = document.getElementById(`msg-${id}`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.animate([{ outline: '2px solid var(--color-accent)' }, { outline: '2px solid transparent' }], { duration: 1600 }); }
      useAppStore.setState({ jump: null });
    }, 120);
    return () => clearTimeout(t);
  }, [jump, key, list.length]);

  const toUnread = () => document.getElementById('unread-sep')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return (
    <div ref={msgRef} className={s.scroll} role="log" aria-label="Messages" style={{ position: 'relative' }}>
      {sepAt > 0 && <button type="button" className={x.jump} onClick={toUnread}>Jump to {open.unread} unread</button>}
      <div className={s.inner}>
        {shown < total && <button type="button" className={`btn btn-secondary ${x.older}`} onClick={() => setOpen({ ...open, extra: open.extra + WINDOW })}>Show earlier messages ({total - shown})</button>}
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
