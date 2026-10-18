 
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { VmProps } from '@/components/panel/types';
import { Icon } from '@/components/ui/Icon';
import { getBridge } from '@/lib/bridge';
import { humanSize } from '@/lib/upload';
import { useAppStore } from '@/state/store';
import { ComposeBars, ComposerTools } from './ComposerTools';
import { useChanCfg } from './useMsgView';
import s from './chat.module.css';
import x from './messaging.module.css';

const MENTION_AT_CARET = /(^|\s)@([\p{L}\p{N}_.-]*)$/u;
const MAX_SUGGESTIONS = 6;

export function Composer({ vm }: VmProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [snapOpen, setSnapOpen] = useState(false);
  const [title, setTitle] = useState(''); const [tags, setTags] = useState('');
  const cfg = useChanCfg(); const forum = cfg?.kind === 'forum'; const locked = !!cfg && !cfg.canSend;
  const probe = useAppStore((st) => st.probePreview); const ping = useAppStore((st) => st.typingPing); const forumPost = useAppStore((st) => st.forumPost);
  useEffect(() => { const t = setTimeout(() => { void probe(vm.draft); }, 600); return () => clearTimeout(t); }, [vm.draft, probe]);
  const publish = () => { void forumPost(title, tags.split(',').map((t) => t.trim()).filter(Boolean), vm.draft.trim()).then(() => { setTitle(''); setTags(''); vm.onDraft({ target: { value: '' } }); }); };

  // Auto-grow to content, capped by CSS max-height.
  useEffect(() => { const el = area.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }, [vm.draft]);

  const query = MENTION_AT_CARET.exec(vm.draft.slice(0, caret))?.[2] ?? null;
  const suggestions = useMemo(() => {
    if (query === null) return [];
    return Object.entries(vm.people)
      .filter(([id, p]) => id !== 'system' && id !== vm.meId && p.name.split(' ')[0].toLowerCase().startsWith(query.toLowerCase()))
      .slice(0, MAX_SUGGESTIONS).map(([id, p]) => ({ id, name: p.name, first: p.name.split(' ')[0], initials: p.i }));
  }, [query, vm.people, vm.meId]);
  const listOpen = suggestions.length > 0;

  // The caret is placed when the new draft commits, not a frame later: a frame later it would jump back over what was typed since.
  const pendingCaret = useRef<number | null>(null);
  const placeCaret = (pos: number) => { area.current?.focus(); area.current?.setSelectionRange(pos, pos); setCaret(pos); };
  useLayoutEffect(() => { const pos = pendingCaret.current; if (pos === null) return; pendingCaret.current = null; placeCaret(pos); }, [vm.draft]);
  const setText = (text: string, pos: number) => {
    if (text === vm.draft) { placeCaret(pos); return; }
    pendingCaret.current = pos;
    vm.onDraft({ target: { value: text } });
  };
  const insert = (first: string) => {
    const before = vm.draft.slice(0, caret).replace(MENTION_AT_CARET, `$1@${first} `);
    setText(before + vm.draft.slice(caret), before.length);
    setPick(0);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (listOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPick((pick + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPick((pick - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(suggestions[pick].first); return; }
      if (e.key === 'Escape') { e.stopPropagation(); setCaret(0); return; }
    }
    vm.onDraftKey(e);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) void vm.attachFiles(Array.from(e.dataTransfer.files));
  };
  const onPaste = (e: ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); void vm.attachFiles(imgs); }
  };

  return (
    <div className={s.composer}>
      <div className={s.composerIn}>
        <div className={`${s.boxCol} ${dragging ? s.drop : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <ComposeBars />
          {forum && (
            <div className={s.chips} style={{ gap: 8 }}>
              <input className="input" aria-label="Post title" placeholder="Post title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} style={{ flex: 2 }} />
              <input className="input" aria-label="Tags, comma separated" placeholder={cfg?.tags?.length ? `Tags: ${cfg.tags.join(', ')}` : 'Tags, comma separated'} value={tags} onChange={(e) => setTags(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn btn-primary" disabled={!title.trim()} onClick={publish}>Post</button>
            </div>
          )}
          {(vm.attached.length > 0 || vm.snapRef) && (
            <ul className={s.chips} style={{ listStyle: 'none', margin: 0 }} aria-label="Attached">
              {vm.attached.map((a) => (
                <li key={a.blob.hash} className={s.chip}>
                  {a.local && a.blob.mime.startsWith('image/') ? <img className={s.chipImg} src={a.local} alt="" /> : <Icon name="doc" size={16} />}
                  <span className={s.fileName}>{a.blob.name}</span><span className={s.fileSize}>{humanSize(a.blob.size)}</span>
                  <button type="button" className={s.chipX} onClick={() => vm.detach(a.blob.hash)} aria-label={`Remove ${a.blob.name}`}><Icon name="x" size={12} /></button>
                </li>
              ))}
              {vm.snapRef && (
                <li className={s.chip}><Icon name="line" size={16} /><span className={s.fileName}>Snapshot: {vm.snapRefTitle}</span>
                  <button type="button" className={s.chipX} onClick={() => vm.setSnapRef(null)} aria-label="Remove snapshot"><Icon name="x" size={12} /></button></li>
              )}
            </ul>
          )}
          <div className={`${x.toolRow} ${s.relative}`}><ComposerTools draft={vm.draft} setDraft={(v) => setText(v, v.length)} /></div>
          <div className={`${s.boxRow} ${s.relative}`}>
            <input ref={files} type="file" multiple hidden onChange={(e) => { void vm.attachFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            <button type="button" aria-label="Attach files" title="Attach files" className={s.tool} onClick={() => (getBridge().kind === 'tauri' ? void vm.attachNative() : files.current?.click())}>{vm.ic.clip}</button>
            {vm.snapChoices.length > 0 && (
              <span className={s.relative}>
                <button type="button" aria-label="Attach a snapshot" aria-haspopup="listbox" aria-expanded={snapOpen} title="Attach a snapshot from Skein" className={s.tool} onClick={() => setSnapOpen((v) => !v)}>{vm.ic.line}</button>
                {snapOpen && (
                  <ul className={s.pop} role="listbox" aria-label="Snapshots">
                    {vm.snapChoices.map((q) => (
                      <li key={q.id} role="option" aria-selected={vm.snapRef === q.id}>
                        <button type="button" className={s.popItem} onClick={() => { vm.setSnapRef(q.id); setSnapOpen(false); }}>{q.title}<span className={s.fileSize}>{q.line}</span></button>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            )}
            {listOpen && (
              <ul className={s.pop} role="listbox" id="mention-list" aria-label="Mention someone" style={{ left: 50 }}>
                {suggestions.map((p, i) => (
                  <li key={p.id} role="option" id={`mention-${i}`} aria-selected={i === pick}>
                    <button type="button" tabIndex={-1} className={s.popItem} onMouseDown={(e) => { e.preventDefault(); insert(p.first); }}>
                      <span className={s.chFace} aria-hidden="true">{p.initials}</span>{p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <textarea ref={area} rows={1} className={s.area} value={vm.draft} placeholder={locked ? 'You cannot post in this channel' : vm.placeholder} readOnly={locked} aria-label="Message"
              role="combobox" aria-expanded={listOpen} aria-controls="mention-list" aria-autocomplete="list" aria-activedescendant={listOpen ? `mention-${pick}` : undefined}
              onChange={(e) => { vm.onDraft(e); setCaret(e.target.selectionStart); setPick(0); ping(); }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)} onKeyDown={onKey} onPaste={onPaste} />
            <button type="button" onClick={() => { if (vm.canSend && !locked) vm.onSend(); }} aria-label="Send" aria-disabled={!vm.canSend} className={s.send} style={{ color: vm.sendFg }}>{vm.ic.send}</button>
          </div>
        </div>
        <div className={s.hints}><span>Enter to send</span><span>Shift + Enter for a new line</span><span>@ to mention</span><span className={s.hintEnd}>Ctrl K to jump anywhere</span></div>
      </div>
    </div>
  );
}
