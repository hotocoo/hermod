import { useState } from 'react';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { Icon } from '@/components/ui/Icon';
import { COPY } from '@/config/copy';
import { splitThreads } from '@/state/slices/messaging/helpers';
import { useAppStore } from '@/state/store';
import { usePopover } from './usePopover';
import { useMsgView } from './useMsgView';
import s from './chat.module.css';
import x from './messaging.module.css';

/** Thread list of the open channel: open and archived, with Archive and Reopen (M-042). */
export function ThreadsMenu() {
  const [popRef, popOpen, setPopOpen] = usePopover();
  const [tab, setTab] = useState<'open' | 'archived'>('open');
  const space = useAppStore((st) => st.space); const channel = useAppStore((st) => st.ch[st.space]);
  const view = useMsgView();
  const { open, archived } = splitThreads(view?.threads?.[channel]);
  const shown = tab === 'open' ? open : archived;
  const go = (id: string) => { useAppStore.setState({ jump: { key: `${space}/${channel}`, id }, thread: id, tdraft: '' }); setPopOpen(false); };
  return (
    <span ref={popRef} style={{ position: 'relative' }}>
      <button type="button" className={s.search} aria-label={`${COPY.threads.button} (${open.length})`} aria-expanded={popOpen} aria-haspopup="true" title={COPY.threads.list} onClick={() => setPopOpen(!popOpen)}><Icon name="chat" size={16} /></button>
      {popOpen && (
        <div className={x.menu} style={{ right: 0, top: '100%', width: 320 }} role="region" aria-label={COPY.threads.list}>
          <div role="tablist" className={x.folderRow}>
            {(['open', 'archived'] as const).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} className={`${x.chip2} ${tab === t ? x.chipOn : ''}`} onClick={() => setTab(t)}>{COPY.threads[t]} ({(t === 'open' ? open : archived).length})</button>
            ))}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.length === 0 && <li><EmptyNote {...(tab === 'open' ? COPY.empty.chatThreads : COPY.empty.chatThreadsArchived)} /></li>}
            {shown.map((t) => (
              <li key={t.id} className={x.listRow}>
                <button type="button" className={`${s.popItem} ${x.grow}`} onClick={() => go(t.id)}>
                  <strong>{t.title || t.id}</strong> <span className={x.meta}>{COPY.threads.meta(t.replies)}</span>
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { void useAppStore.getState().setThreadState(space, t.id, !t.archived); }}>{t.archived ? COPY.threads.reopen : COPY.threads.archive}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
