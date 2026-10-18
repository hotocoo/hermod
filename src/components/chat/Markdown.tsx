'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { getBridge } from '@/lib/bridge';
import { highlight, type TokKind } from '@/lib/messaging/highlight';
import { parseBlocks, type Block, type Inline } from '@/lib/messaging/markdown';
import { useAppStore } from '@/state/store';
import { useCustomEmoji } from './useMsgView';
import s from './messaging.module.css';

interface Ctx { people: Record<string, { name: string }>; emoji: Record<string, string>; hasEveryone: boolean }

const TOK_CLASS: Record<TokKind, string> = { kw: s.tkw, str: s.tstr, com: s.tcom, num: s.tnum, fn: s.tfn, plain: '' };

function Spoiler({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  return <button type="button" className={s.spoiler} aria-pressed={on} aria-label={on ? 'Spoiler' : 'Spoiler, press to reveal'} onClick={() => setOn(true)}>{children}</button>;
}

function Code({ lang, v }: { lang: string; v: string }) {
  const toks = useMemo(() => highlight(v, lang), [v, lang]);
  return (
    <pre className={s.pre} tabIndex={0} aria-label={lang ? `${lang} code` : 'code'}>
      {lang && <span className={s.preLang}>{lang}</span>}
      <code>{toks.map((t, i) => (t.k === 'plain' ? t.v : <span key={i} className={TOK_CLASS[t.k]}>{t.v}</span>))}</code>
    </pre>
  );
}

function Inl({ nodes, x }: { nodes: Inline[]; x: Ctx }): ReactNode {
  const openLink = useAppStore((st) => st.openMessageLink);
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'bold': return <strong key={i}><Inl nodes={n.c} x={x} /></strong>;
      case 'italic': return <em key={i}><Inl nodes={n.c} x={x} /></em>;
      case 'strike': return <s key={i}><Inl nodes={n.c} x={x} /></s>;
      case 'spoiler': return <Spoiler key={i}><Inl nodes={n.c} x={x} /></Spoiler>;
      case 'code': return <code key={i} className={s.code}>{n.v}</code>;
      case 'link':
        return n.href.startsWith('hermod://')
          ? <button key={i} type="button" className="link" style={{ font: 'inherit' }} onClick={() => openLink(n.href)}><Inl nodes={n.c} x={x} /></button>
          : <a key={i} className={s.a} href={n.href} target="_blank" rel="noopener noreferrer nofollow"><Inl nodes={n.c} x={x} /></a>;
      case 'emoji': {
        const hash = x.emoji[n.name];
        return hash ? <img key={i} className={s.ext} src={getBridge().blobUrl(hash)} alt={`:${n.name}:`} title={`:${n.name}:`} /> : `:${n.name}:`;
      }
      case 'mention': {
        const group = ['everyone', 'here', 'admins', 'owners'].includes(n.v);
        const known = Object.values(x.people).some((p) => p.name.split(' ')[0].toLowerCase() === n.v.toLowerCase());
        if (group) return <mark key={i} className={`${s.everyone} mention`} style={x.hasEveryone ? undefined : { background: 'none', color: 'inherit', fontWeight: 400 }}>@{n.v}</mark>;
        return known ? <mark key={i} className="mention">@{n.v}</mark> : `@${n.v}`;
      }
      default: return null;
    }
  });
}

function Blk({ b, x }: { b: Block; x: Ctx }) {
  switch (b.t) {
    case 'p': return <p className="mdp"><Inl nodes={b.c} x={x} /></p>;
    case 'pre': return <Code lang={b.lang} v={b.v} />;
    case 'quote': return <blockquote className={s.quote}>{b.c.map((c, i) => <Blk key={i} b={c} x={x} />)}</blockquote>;
    case 'ul': return <ul className={s.list}>{b.items.map((it, i) => <li key={i}><Inl nodes={it} x={x} /></li>)}</ul>;
    case 'ol': return <ol className={s.list}>{b.items.map((it, i) => <li key={i}><Inl nodes={it} x={x} /></li>)}</ol>;
    default: return null;
  }
}

interface Props { text: string; people: Record<string, { name: string }>; everyone?: boolean; className?: string }

/** Renders message markup as React elements. No raw HTML ever reaches the DOM. */
export function Markdown({ text, people, everyone, className }: Props) {

  const emoji = useCustomEmoji();
  const map = useMemo(() => Object.fromEntries((emoji ?? []).map((e) => [e.name, e.blob.hash])), [emoji]);
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const x: Ctx = { people, emoji: map, hasEveryone: !!everyone };
  return <div className={`${s.md} ${className ?? ''}`}>{blocks.map((b, i) => <Blk key={i} b={b} x={x} />)}</div>;
}
