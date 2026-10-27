'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getBridge } from '@/lib/bridge';
import { useAppStore } from '@/state/store';
import { useStickers } from './useMsgView';
import s from './messaging.module.css';
import { COPY } from '@/config/copy';

/** Stickers (per-Space packs from uploads) and the user's own GIFs. No network source: files come from the user's disk. */
export function StickerPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'stickers' | 'gifs'>('stickers');
  const root = useRef<HTMLDivElement>(null); const files = useRef<HTMLInputElement>(null);
  const st = useAppStore();
  const stickers = useStickers();
  const packs = useMemo(() => { const m = new Map<string, typeof stickers>(); for (const x of stickers) m.set(x.pack, [...(m.get(x.pack) ?? []), x]); return [...m.entries()]; }, [stickers]);
  const gifs = st.prefs.gifs ?? []; const bridge = getBridge();
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, [onClose]);
  const add = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      if (tab === 'gifs') await st.addGif(f);
      else await st.addSticker(f, f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'sticker', packs[0]?.[0] ?? 'Stickers');
    }
  };
  return (
    <div ref={root} className={s.panel} role="dialog" aria-label={COPY.ui.chat.stickerPanelText.stickersAndGifs} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className={s.panelHead} role="tablist">
        {(['stickers', 'gifs'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${s.tab} ${tab === t ? s.tabOn : ''}`} onClick={() => setTab(t)}>{t === 'gifs' ? COPY.ui.chat.stickerPanelText.myGifs : COPY.ui.chat.stickerPanelText.stickers}</button>)}
        <span style={{ flex: 1 }} />
        <input ref={files} type="file" hidden multiple accept={tab === 'gifs' ? 'image/gif,image/webp' : 'image/png,image/webp,image/gif,image/jpeg'} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
        <button type="button" className={s.tab} onClick={() => files.current?.click()}>{tab === 'gifs' ? COPY.ui.chat.stickerPanelText.addGif : COPY.ui.chat.stickerPanelText.addSticker}</button>
      </div>
      {tab === 'stickers' ? (
        <div style={{ overflow: 'auto' }}>
          {packs.map(([pack, list]) => (
            <section key={pack} aria-label={pack}>
              <div className={s.cat}>{pack}</div>
              <div className={s.stGrid}>{list.map((x) => (
                <button key={x.id} type="button" className={s.cell} title={x.name} aria-label={x.name} onClick={() => { void st.sendSticker(x); onClose(); }}>
                  <img src={bridge.blobUrl(x.blob.hash)} alt="" style={{ width: 72, height: 72 }} loading="lazy" />
                </button>
              ))}</div>
            </section>
          ))}
          {!packs.length && <p className={s.empty}>{COPY.ui.chat.stickerPanelText.noStickersInThisSpace}</p>}
        </div>
      ) : (
        <div className={s.stGrid}>
          {gifs.map((g) => (
            <button key={g.hash} type="button" className={s.cell} aria-label={g.name} onClick={() => { void st.sendGif(g); onClose(); }}>
              <img src={bridge.blobUrl(g.hash)} alt="" style={{ width: 84, height: 84, objectFit: 'cover' }} loading="lazy" />
            </button>
          ))}
          {!gifs.length && <p className={s.empty} style={{ gridColumn: '1 / -1' }}>{COPY.ui.chat.stickerPanelText.addGifOrWebpFiles}</p>}
        </div>
      )}
    </div>
  );
}
