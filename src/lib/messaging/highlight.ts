/** Small generic lexer for code blocks: keywords, strings, comments, numbers. Not grammar-accurate by design (docs/MESSAGING.md section 4). */
export type TokKind = 'kw' | 'str' | 'com' | 'num' | 'fn' | 'plain';
export interface Tok { k: TokKind; v: string }

const KW = new Set(`as async await break case catch class const continue default defer delete do else enum export extends false final finally fn for from func function go if impl import in interface is lambda let loop match mod mut new nil none null of or and not package priv private pub public pure raise return self static struct super switch this throw trait true try type typeof union unsafe use var void where while with yield select insert update from where join group order by limit create table into values`.split(/\s+/));
const HASH_COMMENT = new Set(['py', 'python', 'sh', 'bash', 'zsh', 'shell', 'yaml', 'yml', 'toml', 'rb', 'ruby', 'ini', 'conf', 'dockerfile']);
const DASH_COMMENT = new Set(['sql', 'lua', 'hs']);
const NO_COMMENT = new Set(['json', 'txt', 'text', 'md']);
const MAX_CODE_CHARS = 20_000;

export function highlight(code: string, lang: string): Tok[] {
  const src = code.slice(0, MAX_CODE_CHARS);
  const out: Tok[] = [];
  const hash = HASH_COMMENT.has(lang); const dash = DASH_COMMENT.has(lang); const none = NO_COMMENT.has(lang);
  const push = (k: TokKind, v: string) => { const l = out[out.length - 1]; if (l && l.k === k && k === 'plain') l.v += v; else out.push({ k, v }); };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (!none && ((c === '/' && src[i + 1] === '/') || (hash && c === '#') || (dash && c === '-' && src[i + 1] === '-'))) {
      const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e;
      push('com', src.slice(i, end)); i = end; continue;
    }
    if (!none && c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2;
      push('com', src.slice(i, end)); i = end; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && (src[j] !== '\n' || c === '`')) { if (src[j] === '\\') j += 1; j += 1; }
      j = Math.min(j + 1, src.length);
      push('str', src.slice(i, j)); i = j; continue;
    }
    if (/[0-9]/.test(c) && !/[\p{L}_]/u.test(src[i - 1] ?? ' ')) {
      let j = i + 1; while (j < src.length && /[0-9a-fA-FxX._]/.test(src[j])) j += 1;
      push('num', src.slice(i, j)); i = j; continue;
    }
    if (/[\p{L}_$]/u.test(c)) {
      let j = i + 1; while (j < src.length && /[\p{L}\p{N}_$]/u.test(src[j])) j += 1;
      const w = src.slice(i, j);
      if (KW.has(w) || KW.has(w.toLowerCase()) && lang === 'sql') push('kw', w);
      else if (src[j] === '(') push('fn', w);
      else push('plain', w);
      i = j; continue;
    }
    push('plain', c); i += 1;
  }
  return out;
}
