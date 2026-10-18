'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getBridge } from '@/lib/bridge';
import { useCustomEmoji } from './useMsgView';
import s from './messaging.module.css';

type Groups = { name: string; items: [string, string][] }[];
const RECENT_KEY = 'hermodr.emoji.recent';
const MAX_RECENT = 24;

const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]; } catch { return []; } };
const pushRecent = (e: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter((x) => x !== e)].slice(0, MAX_RECENT))); } catch { /* recents are a convenience */ } };

/** Emoji for reactions and the composer: Space custom emoji first, then the bundled set (loaded on first open). */
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [groups, setGroups] = useState<Groups | null>(null);
  const [q, setQ] = useState(''); const [tab, setTab] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const custom = useCustomEmoji();
  const recent = useMemo(() => readRecent(), []);
  useEffect(() => { let live = true; void import('@/lib/messaging/emojiData').then((m) => { if (live) setGroups(m.EMOJI_GROUPS); }); return () => { live = false; }; }, []);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, [onClose]);
  const pick = (e: string) => { pushRecent(e); onPick(e); };
  const needle = q.trim().toLowerCase();
  const found = useMemo(() => (needle && groups ? groups.flatMap((g) => g.items).filter(([, n]) => n.includes(needle)).slice(0, 120) : []), [needle, groups]);
  const tabs = ['Recent', 'Custom', ...(groups?.map((g) => g.name) ?? [])];
  const list = tab === 0 ? recent.map((c) => [c, c] as [string, string]) : tab >= 2 ? (groups?.[tab - 2].items ?? []) : [];
  return (
    <div ref={root} className={s.panel} role="dialog" aria-label="Emoji" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className={s.panelHead}>
        <input className="input" style={{ height: 30 }} placeholder="Search emoji" aria-label="Search emoji" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {!needle && <div className={s.panelHead} role="tablist" aria-label="Emoji groups">{tabs.map((t, i) => <button key={t} type="button" role="tab" aria-selected={tab === i} className={`${s.tab} ${tab === i ? s.tabOn : ''}`} onClick={() => setTab(i)}>{t}</button>)}</div>}
      {needle ? (
        <div className={s.grid}>{found.map(([c, n]) => <button key={c + n} type="button" className={s.cell} title={n} aria-label={n} onClick={() => pick(c)}>{c}</button>)}{!found.length && <p className={s.empty}>{groups ? 'No emoji match' : 'Loading'}</p>}</div>
      ) : tab === 1 ? (
        <div className={s.grid}>
          {custom.map((e) => (
            <button key={e.name} type="button" className={s.cell} title={`:${e.name}:`} aria-label={e.name} onClick={() => pick(`:${e.name}:`)}>
              <img src={getBridge().blobUrl(e.blob.hash)} alt="" />
            </button>
          ))}
          {!custom.length && <p className={s.empty}>This Space has no custom emoji yet. Add one from Space settings.</p>}
        </div>
      ) : (
        <div className={s.grid}>{list.map(([c, n]) => <button key={c + n} type="button" className={s.cell} title={n} aria-label={n} onClick={() => pick(c)}>{c}</button>)}{tab === 0 && !list.length && <p className={s.empty}>Emoji you use show up here</p>}</div>
      )}
    </div>
  );
}
