import { MONO_FONT, SKEIN_FILE_KIND_LABEL, SKEIN_SEAL_SHORT, SKEIN_TERMS } from '../../config/ui';
import { anim, firstName } from '../../lib/format';
import type { DiffLine, SkeinFile } from '../dataTypes';
import { blobUrl } from '../../lib/upload';
import { personOf } from '../selectors';
import type { Ctx } from './context';
import { ACCENT, ACCENT_700, TEXT, mixAccent, mixText, fgOf } from './css';

export const diffLineVm = (l: DiffLine, k: number, file: Pick<SkeinFile, 'kind'>) => ({
  s: l.s || ' ', mark: l.t === ' ' ? '' : l.t, n: k + 1,
  bg: l.t === '+' ? mixAccent(14) : (l.t === '-' ? mixText(7) : 'transparent'), fg: l.t === '-' ? mixText(55) : TEXT,
  strike: l.t === '-' && file.kind === 'doc' ? 'line-through' : 'none', markFg: l.t === '+' ? ACCENT_700 : mixText(50),
});

export function skeinVm(x: Ctx) {
  const { s, seed } = x;
  const sk = s.skein[s.space];
  if (!sk) return { skein: null, hasSkein: false, noSkein: true, newSnapshot: () => s.openModal({ kind: 'newSnapshot' }), newLine: undefined };
  const selId = s.snap[s.space]; const lineSel = s.line[s.space] ?? 'all'; const ex = s.expert;
  const T = ex ? SKEIN_TERMS.expert : SKEIN_TERMS.plain;
  const snaps = sk.snaps.filter((q) => lineSel === 'all' || q.line === lineSel);
  const sel = sk.snaps.find((q) => q.id === selId) ?? sk.snaps[0];
  const mainId = sk.lines[0].id;
  // `parent` is the parent seal's short prefix (empty for a root snapshot).
  const parentSnap = sel && sel.parent ? sk.snaps.find((q) => q.seal.startsWith(sel.parent)) : undefined;
  const parentFiles = new Map((parentSnap?.files ?? []).map((f) => [f.path, f]));
  const onSel = (id: string) => !!sel && id === sel.id;
  const weavable = sk.lines.filter((l) => l.ahead).map((l) => ({
    id: l.id, name: l.name, by: l.by ? firstName(personOf(seed, l.by).name) : '', onWeave: () => { void s.weave(s.space, l.id); },
  }));
  const allLine = { id: 'all', name: 'All lines', note: `${sk.snaps.length} ${T.snapshots.toLowerCase()}`, ahead: 0 };
  const skein = {
    repo: sk.repo, blurb: sk.blurb, T, expert: ex, plain: !ex, lineSel,
    lines: [allLine, ...sk.lines].map((l) => ({
      id: l.id, name: l.name, note: l.note, ahead: l.ahead, hasAhead: !!l.ahead, aheadLabel: `${l.ahead} to ${T.weave.toLowerCase()}`,
      active: lineSel === l.id, bg: lineSel === l.id ? mixAccent(11) : 'transparent', fg: fgOf(lineSel === l.id),
      canWeave: !!l.ahead && l.id !== 'all', onClick: () => s.setLine(l.id), onWeave: () => { void s.weave(s.space, l.id); },
    })),
    snaps: snaps.map((q, i) => ({
      id: q.id, title: q.title, by: personOf(seed, q.by).name, initials: personOf(seed, q.by).i, when: q.when, kind: q.kind, line: q.line,
      seal: q.seal.slice(0, ex ? SKEIN_SEAL_SHORT.expert : SKEIN_SEAL_SHORT.plain), active: onSel(q.id), isLast: i === snaps.length - 1,
      dot: onSel(q.id) ? ACCENT : 'var(--color-bg)', dotBd: q.line === mainId ? TEXT : ACCENT, bg: onSel(q.id) ? mixAccent(9) : 'transparent',
      onClick: () => s.openSnap(s.space, q.id), anim: anim(i),
    })),
    sel: sel ? {
      id: sel.id, title: sel.title, by: personOf(seed, sel.by).name, initials: personOf(seed, sel.by).i, when: sel.when, kind: sel.kind, line: sel.line,
      seal: sel.seal, sealShort: sel.seal.slice(0, SKEIN_SEAL_SHORT.plain), parent: sel.parent, linked: sel.linked.label, hasLink: !!sel.linked.ch,
      isWeave: !!sel.weaveOf, weaveOf: sel.weaveOf,
      openLink: () => { if (sel.linked.ch) s.goChannel(s.space, sel.linked.ch); },
      cli: `skein show ${sel.seal.slice(0, 12)} --stat`,
      cliWeave: `skein weave ${(sk.lines.find((l) => l.ahead) ?? { id: mainId }).id} --into ${mainId}`,
      adds: sel.files.reduce((a, f) => a + f.adds, 0), dels: sel.files.reduce((a, f) => a + f.dels, 0), fileCount: sel.files.length, noFiles: sel.files.length === 0,
      files: sel.files.map((f) => ({
        fromHash: parentFiles.get(f.path)?.blob?.hash ?? null, toHash: f.blob?.hash ?? null,
        path: f.path, kind: f.kind, adds: f.adds, dels: f.dels, isSwatch: f.kind === 'swatch', isCode: f.kind === 'code' || f.kind === 'doc', isAudio: f.kind === 'audio', isDoc: f.kind === 'doc',
        kindLabel: SKEIN_FILE_KIND_LABEL[f.kind], mono: f.kind === 'code' ? MONO_FONT : 'var(--font-body)',
        swatches: (f.swatches ?? []).map((w) => ({ n: w.n, from: w.from, to: w.to })), audio: f.audio,
        lines: (f.lines ?? []).map((l, k) => diffLineVm(l, k, f)),
        blob: f.blob ?? null, previewUrl: f.blob && f.blob.mime.startsWith('image/') ? blobUrl(f.blob.hash) : '',
      })),
    } : null,
    weavable, hasWeavable: weavable.length > 0,
    newLine: () => { void s.newLine(); }, newSnapshot: () => s.openModal({ kind: 'newSnapshot' }),
    toggleExpert: s.toggleExpert, plainBd: !ex ? ACCENT : 'transparent', expertBd: ex ? ACCENT : 'transparent',
    plainFg: fgOf(!ex), expertFg: fgOf(ex), setPlain: () => s.setExpert(false), setExpert: () => s.setExpert(true),
  };
  return { skein, hasSkein: true, noSkein: false };
}
