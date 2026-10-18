import { Fragment, type ReactNode } from 'react';
import s from './screens.module.css';

/** Inline spans: `code`, **bold**, [text](url). Everything else is plain text (React escapes it). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<code key={k++}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k++}>{m[2]}</strong>);
    else if (/^(https?:|mailto:)/.test(m[4])) out.push(<a key={k++} href={m[4]} target="_blank" rel="noreferrer noopener">{m[3]}</a>);
    else out.push(m[3]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** Renders legal markdown (headings, paragraphs, lists, tables) to React nodes. No raw HTML is ever injected. */
export function Markdown({ source }: { source: string }) {
  const lines = source.split('\n'); const nodes: ReactNode[] = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,3}) (.*)/.exec(l);
    if (h) {
      const Tag = (`h${h[1].length + 1}`) as 'h2' | 'h3' | 'h4';
      nodes.push(<Tag key={i} className={s.mdHead}>{inline(h[2])}</Tag>); i++; continue;
    }
    if (l.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const [head, , ...body] = rows;
      nodes.push(
        <div key={i} className={s.tableWrap}><table className={s.table}>
          <thead><tr>{cells(head).map((c, j) => <th key={j} scope="col">{inline(c)}</th>)}</tr></thead>
          <tbody>{body.map((r, j) => <tr key={j}>{cells(r).map((c, n) => <td key={n}>{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (l.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2));
      nodes.push(<ul key={i}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- )/.test(lines[i])) para.push(lines[i++]);
    nodes.push(<p key={i}>{inline(para.join(' '))}</p>);
  }
  return <>{nodes.map((n, j) => <Fragment key={j}>{n}</Fragment>)}</>;
}
