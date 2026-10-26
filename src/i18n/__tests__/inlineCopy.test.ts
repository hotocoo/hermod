/** W-007 guard: user-visible English in .tsx must come from COPY / the catalog, never inline. */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
/** JSX attributes (native and component props) whose string literal is shown to the user. */
const ATTRS = new Set([
  'aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-roledescription', 'aria-valuetext',
  'kicker', 'label', 'sub', 'hint', 'heading', 'subtitle', 'description', 'caption', 'legend', 'tooltip', 'summary',
]);
const HAS_LETTER = /\p{L}/u;
/** Not translatable copy: the product name, and one or two bare letters (unit suffixes such as s, m, h, d, px, x; glyph letters). */
const BRAND = /^(Hermod|[a-zA-Z]{1,2})$/;

/** `file:text` entries the guard tolerates, each with its reason. */
const ALLOW: Readonly<Record<string, string>> = {
  'components/hud/Header.tsx:Hermóðr ·': 'the product name in its rune spelling, a brand mark rather than translatable copy',
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : walk(p);
    return p.endsWith('.tsx') ? [p] : [];
  });

/** Literal text pieces of an expression (string, template parts, either side of ?: and operators). */
function literals(e: ts.Expression | undefined): string[] {
  if (!e) return [];
  if (ts.isStringLiteralLike(e)) return [e.text];
  if (ts.isTemplateExpression(e)) return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)];
  if (ts.isParenthesizedExpression(e)) return literals(e.expression);
  if (ts.isConditionalExpression(e)) return [...literals(e.whenTrue), ...literals(e.whenFalse)];
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return literals(e.right); // `cond && 'text'`; the left side is a test
    const joins = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken];
    return joins.includes(op) ? [...literals(e.left), ...literals(e.right)] : []; // comparisons are not copy
  }
  return [];
}

export function scan(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const add = (s: string) => {
    const v = s.replace(/\s+/g, ' ').trim();
    if (HAS_LETTER.test(v) && !BRAND.test(v)) found.push(v);
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) add(n.text);
    else if (ts.isJsxExpression(n) && n.expression && !ts.isJsxAttribute(n.parent)) literals(n.expression).forEach(add);
    else if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText())) {
      const i = n.initializer;
      if (i && ts.isStringLiteral(i)) add(i.text);
      else if (i && ts.isJsxExpression(i)) literals(i.expression).forEach(add);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe('inline user-visible English (W-007)', () => {
  it('no .tsx file inlines copy outside the catalog', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f);
      for (const s of scan(f, readFileSync(f, 'utf8'))) if (!ALLOW[`${rel}:${s}`]) bad.push(`${rel}: ${s}`);
    }
    if (process.env.DUMP) writeFileSync(process.env.DUMP, bad.join('\n'));
    expect(bad, 'move these into src/i18n/en.ts and read them through COPY').toEqual([]);
  });

  it('the scanner flags text, attributes and ignores icons/brand', () => {
    const src = 'const A = () => <div title="Hi there" aria-label={`Go home ${x}`}>Hello {"World"}<b>Hermod</b>×<i aria-hidden>{icon}</i></div>;';
    expect(scan('a.tsx', src)).toEqual(['Hi there', 'Go home', 'Hello', 'World']);
  });
});
