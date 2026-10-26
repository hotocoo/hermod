/** Minimal ICU MessageFormat: `{arg}`, `{arg, plural, =N {..} one {..} other {..}}` with `#`, `{arg, select, key {..} other {..}}`. No offsets, no quote escaping, no number/date styles (use lib/format). */
type Node = string | { hash: true } | { arg: string; kind?: 'plural' | 'select'; opts?: Record<string, Node[]> };
export type Args = Readonly<Record<string, string | number>>;

const cache = new Map<string, Node[]>();
interface Pos { i: number }

function nodes(s: string, pos: Pos, nested: boolean, plural: boolean): Node[] {
  const out: Node[] = [];
  let text = '';
  const flush = () => { if (text) { out.push(text); text = ''; } };
  while (pos.i < s.length) {
    const c = s[pos.i];
    if (c === '}') { if (!nested) throw new Error(`ICU: unmatched } in "${s}"`); break; }
    if (c === '{') { flush(); pos.i++; out.push(arg(s, pos, plural)); continue; }
    if (c === '#' && plural) { flush(); out.push({ hash: true }); pos.i++; continue; }
    text += c; pos.i++;
  }
  flush();
  return out;
}

const until = (s: string, pos: Pos, stops: string): string => {
  const start = pos.i;
  while (pos.i < s.length && !stops.includes(s[pos.i])) pos.i++;
  return s.slice(start, pos.i).trim();
};
const skipWs = (s: string, pos: Pos) => { while (/\s/.test(s[pos.i] ?? '')) pos.i++; };

function arg(s: string, pos: Pos, plural: boolean): Node {
  const name = until(s, pos, ',}');
  if (s[pos.i] === '}') { pos.i++; return { arg: name }; }
  pos.i++;
  const kind = until(s, pos, ',}');
  if (kind !== 'plural' && kind !== 'select') throw new Error(`ICU: unsupported type "${kind}" in "${s}"`);
  pos.i++;
  const opts: Record<string, Node[]> = {};
  for (;;) {
    skipWs(s, pos);
    if (pos.i >= s.length) throw new Error(`ICU: unterminated argument in "${s}"`);
    if (s[pos.i] === '}') { pos.i++; break; }
    const key = until(s, pos, ' \t\n{');
    skipWs(s, pos);
    if (s[pos.i] !== '{') throw new Error(`ICU: expected { after "${key}" in "${s}"`);
    pos.i++;
    opts[key] = nodes(s, pos, true, kind === 'plural' || plural);
    pos.i++;
  }
  if (!opts.other) throw new Error(`ICU: "${name}" needs an other branch in "${s}"`);
  return { arg: name, kind, opts };
}

export const parse = (msg: string): Node[] => {
  let ast = cache.get(msg);
  if (!ast) { ast = nodes(msg, { i: 0 }, false, false); cache.set(msg, ast); }
  return ast;
};

export interface Env {
  /** Intl tag for plural rules and digits. */
  tag: string;
  /** Applied to literal message text only (pseudo-locale); arguments are never touched. */
  text?: (s: string) => string;
}

export function render(ast: readonly Node[], args: Args, env: Env, n?: number): string {
  let out = '';
  const nf = new Intl.NumberFormat(env.tag);
  for (const node of ast) {
    if (typeof node === 'string') { out += env.text ? env.text(node) : node; continue; }
    if ('hash' in node) { out += nf.format(n ?? 0); continue; }
    const v = args[node.arg];
    if (!node.kind || !node.opts) { out += v === undefined ? '' : typeof v === 'number' ? nf.format(v) : v; continue; }
    if (node.kind === 'select') {
      out += render(node.opts[String(v)] ?? node.opts.other, args, env, n);
    } else {
      const num = Number(v);
      const branch = node.opts[`=${num}`] ?? node.opts[new Intl.PluralRules(env.tag).select(num)] ?? node.opts.other;
      out += render(branch, args, env, num);
    }
  }
  return out;
}
