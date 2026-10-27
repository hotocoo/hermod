 
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { VmProps } from '@/components/panel/types';
import { Icon } from '@/components/ui/Icon';
import { COPY } from '@/config/copy';
import { getBridge } from '@/lib/bridge';
import { humanSize } from '@/lib/upload';
import { chatKey } from '@/state/selectors';
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
  // Draft lives outside the view model so a keystroke does not rebuild it (see useViewModel).
  const draft = useAppStore((st) => st.drafts[chatKey(st)] ?? ''); const setDraft = useAppStore((st) => st.setDraft);
  const canSend = !!draft.trim() || vm.attached.length > 0 || !!vm.snapRef;
  const cfg = useChanCfg(); const forum = cfg?.kind === 'forum'; const locked = !!cfg && !cfg.canSend;
  const probe = useAppStore((st) => st.probePreview); const ping = useAppStore((st) => st.typingPing); const forumPost = useAppStore((st) => st.forumPost);
  useEffect(() => { const t = setTimeout(() => { void probe(draft); }, 600); return () => clearTimeout(t); }, [draft, probe]);
  const publish = () => { void forumPost(title, tags.split(',').map((t) => t.trim()).filter(Boolean), draft.trim()).then(() => { setTitle(''); setTags(''); setDraft(''); }); };

  // Auto-grow to content, capped by CSS max-height.
  useEffect(() => { const el = area.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }, [draft]);

  const query = MENTION_AT_CARET.exec(draft.slice(0, caret))?.[2] ?? null;
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
  useLayoutEffect(() => { const pos = pendingCaret.current; if (pos === null) return; pendingCaret.current = null; placeCaret(pos); }, [draft]);
  const setText = (text: string, pos: number) => {
    if (text === draft) { placeCaret(pos); return; }
    pendingCaret.current = pos;
    setDraft(text);
  };
  const insert = (first: string) => {
    const before = draft.slice(0, caret).replace(MENTION_AT_CARET, `$1@${first} `);
    setText(before + draft.slice(caret), before.length);
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
              <input className="input" aria-label={COPY.ui.chat.composer.postTitle} placeholder={COPY.ui.chat.composer.postTitle} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} style={{ flex: 2 }} />
              <input className="input" aria-label={COPY.ui.chat.composer.tags} placeholder={cfg?.tags?.length ? COPY.ui.chat.composer.tagsList(cfg.tags.join(', ')) : COPY.ui.chat.composer.tags} value={tags} onChange={(e) => setTags(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn btn-primary" disabled={!title.trim()} onClick={publish}>{COPY.ui.chat.composer.post}</button>
            </div>
          )}
          {(vm.attached.length > 0 || vm.snapRef) && (
            <ul className={s.chips} style={{ listStyle: 'none', margin: 0 }} aria-label={COPY.ui.chat.composer.attached}>
              {vm.attached.map((a) => (
                <li key={a.blob.hash} className={s.chip}>
                  {a.local && a.blob.mime.startsWith('image/') ? <img className={s.chipImg} src={a.local} alt="" /> : <Icon name="doc" size={16} />}
                  <span className={s.fileName}>{a.blob.name}</span><span className={s.fileSize}>{humanSize(a.blob.size)}</span>
                  <button type="button" className={s.chipX} onClick={() => vm.detach(a.blob.hash)} aria-label={COPY.ui.chat.composer.remove(a.blob.name)}><Icon name="x" size={12} /></button>
                </li>
              ))}
              {vm.snapRef && (
                <li className={s.chip}><Icon name="line" size={16} /><span className={s.fileName}>{COPY.ui.chat.composer.snapshotNamed(vm.snapRefTitle)}</span>
                  <button type="button" className={s.chipX} onClick={() => vm.setSnapRef(null)} aria-label={COPY.ui.chat.composer.removeSnapshot}><Icon name="x" size={12} /></button></li>
              )}
            </ul>
          )}
          <div className={`${x.toolRow} ${s.relative}`}><ComposerTools draft={draft} setDraft={(v) => setText(v, v.length)} /></div>
          <div className={`${s.boxRow} ${s.relative}`}>
            <input ref={files} type="file" multiple hidden onChange={(e) => { void vm.attachFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            <button type="button" aria-label={COPY.ui.chat.composer.attachFiles} title={COPY.ui.chat.composer.attachFiles} className={s.tool} onClick={() => (getBridge().kind === 'tauri' ? void vm.attachNative() : files.current?.click())}>{vm.ic.clip}</button>
            {vm.snapChoices.length > 0 && (
              <span className={s.relative}>
                <button type="button" aria-label={COPY.ui.chat.composer.attachSnapshot} aria-haspopup="listbox" aria-expanded={snapOpen} title={COPY.ui.chat.composer.attachSnapshotTitle} className={s.tool} onClick={() => setSnapOpen((v) => !v)}>{vm.ic.line}</button>
                {snapOpen && (
                  <ul className={s.pop} role="listbox" aria-label={COPY.ui.chat.composer.snapshots}>
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
              <ul className={s.pop} role="listbox" id="mention-list" aria-label={COPY.ui.chat.composer.mention} style={{ left: 50 }}>
                {suggestions.map((p, i) => (
                  <li key={p.id} role="option" id={`mention-${i}`} aria-selected={i === pick}>
                    <button type="button" tabIndex={-1} className={s.popItem} onMouseDown={(e) => { e.preventDefault(); insert(p.first); }}>
                      <span className={s.chFace} aria-hidden="true">{p.initials}</span>{p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <textarea ref={area} rows={1} className={s.area} value={draft} placeholder={locked ? COPY.ui.chat.composer.cannotPost : vm.placeholder} readOnly={locked} aria-label={COPY.ui.chat.composer.message}
              role="combobox" aria-expanded={listOpen} aria-controls="mention-list" aria-autocomplete="list" aria-activedescendant={listOpen ? `mention-${pick}` : undefined}
              onChange={(e) => { setDraft(e.target.value); setCaret(e.target.selectionStart); setPick(0); ping(); }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)} onKeyDown={onKey} onPaste={onPaste} />
            <button type="button" onClick={() => { if (canSend && !locked) vm.onSend(); }} aria-label={COPY.ui.chat.composer.send} aria-disabled={!canSend} className={s.send} style={{ color: canSend ? vm.sendFgOn : vm.sendFgOff }}>{vm.ic.send}</button>
          </div>
        </div>
        <div className={s.hints}><span>{COPY.ui.chat.composer.hintSend}</span><span>{COPY.ui.chat.composer.hintNewline}</span><span>{COPY.ui.chat.composer.hintMention}</span><span className={s.hintEnd}>{COPY.ui.chat.composer.hintJump}</span></div>
      </div>
    </div>
  );
}
