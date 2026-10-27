import { useCallback, useEffect, useState } from 'react';
import { getBridge, errorMessage } from '@/lib/bridge';
import { COPY } from '@/config/copy';
import { diffLineVm } from '@/state/vm/skein';
import { blobUrl } from '@/lib/upload';
import { useAppStore } from '@/state/store';
import type { BlobDiff, BlobRef } from '@/lib/bridge';
import { Icon } from '@/components/ui/Icon';
import { Swatch, type SwatchData } from './Swatch';
import s from './skein.module.css';

/** Size of the file icon shown for a stored file that has no image preview (K-005). */
const FILE_GLYPH_PX = 32;

interface DiffLineData { s: string; mark: string; n: number; bg: string; fg: string; strike: string; markFg: string }
export interface SkeinFileData {
  /** Blob hashes of the parent snapshot's file at this path and of this one; null when absent. */
  fromHash: string | null; toHash: string | null; kind: string;
  path: string; kindLabel: string; adds: number; dels: number; isSwatch: boolean; isCode: boolean; isAudio: boolean; mono: string;
  blob: BlobRef | null; previewUrl: string;
  swatches: SwatchData[]; audio?: { from: string; to: string }; lines: DiffLineData[];
}

async function download(b: BlobRef) {
  const bridge = getBridge();
  try {
    if (bridge.kind === 'tauri') { await bridge.blobSaveAs(b.hash, b.name); return; }
    const a = document.createElement('a');
    a.href = blobUrl(b.hash); a.download = b.name; a.click();
  } catch (e) { useAppStore.getState().showToast(errorMessage(e), undefined, 'error'); }
}

type DiffState = { s: 'loading' } | { s: 'error'; why: string } | { s: 'done'; diff: BlobDiff };
type Keyed = { key: string; st: DiffState };

/** Fetches the real line hunks once a code or text file has blobs and no preset lines. */
function useBlobDiff(f: SkeinFileData) {
  const wanted = (f.isCode && f.lines.length === 0 && !!f.toHash);
  const [res, setRes] = useState<Keyed | null>(null);
  const [tries, setTries] = useState(0);
  const key = `${f.fromHash}:${f.toHash}:${tries}`;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    getBridge().diffBlobs(f.fromHash, f.toHash)
      .then((diff) => { if (live) setRes({ key, st: { s: 'done', diff } }); })
      .catch((e: unknown) => { if (live) setRes({ key, st: { s: 'error', why: errorMessage(e) } }); });
    return () => { live = false; };
  }, [wanted, f.fromHash, f.toHash, key]);
  const retry = useCallback(() => setTries((n) => n + 1), []);
  const st: DiffState = res && res.key === key ? res.st : { s: 'loading' };
  return { wanted, st, retry };
}

function HunkView({ diff, f }: { diff: Extract<BlobDiff, { state: 'text' }>; f: SkeinFileData }) {
  if (diff.hunks.length === 0) return <div className={s.diffNote}>{COPY.fileDiff.unchanged}</div>;
  return (
    <>
      {diff.hunks.map((h, i) => {
        let oldN = h.old_start; let newN = h.new_start;
        return (
          <div key={`${h.old_start}:${h.new_start}`}>
            <div className={s.hunkHead}>{COPY.fileDiff.hunk(i + 1)} · {h.old_start}/{h.new_start}</div>
            {h.rows.map((r, k) => {
              const n = r.t === '-' ? oldN++ : (r.t === '+' ? newN++ : (oldN++, newN++));
              const ln = diffLineVm(r, n - 1, f);
              return (
                <div key={k} className={s.diffLine} style={{ background: ln.bg, fontFamily: f.mono }}>
                  <span className={s.lnNum}>{ln.n}</span>
                  <span className={s.lnMark} style={{ color: ln.markFg }}>{ln.mark}</span>
                  <span className={s.lnText} style={{ color: ln.fg, textDecoration: ln.strike }}>{ln.s}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

/** One changed file: swatch grid, code/doc diff or audio before/after. */
export function FileDiff({ f }: { f: SkeinFileData }) {
  const { wanted, st, retry } = useBlobDiff(f);
  return (
    <section className={s.file}>
      <div className={s.fileHead}>
        <span className={s.filePath}>{f.path}</span><span className={s.fileKind}>{f.kindLabel}</span>
        <span className={`${s.tnum} ${s.adds}`}>+{f.adds}</span><span className={s.dels}>−{f.dels}</span>
      </div>
      
      {f.previewUrl && <img className={s.preview} src={f.previewUrl} alt={f.path} />}
      {f.blob && !f.previewUrl && <span className={s.fileGlyph} role="img" aria-label={COPY.fileDiff.fileIcon}><Icon name="doc" size={FILE_GLYPH_PX} /></span>}
      {f.blob && <button type="button" className={s.dl} onClick={() => { void download(f.blob as BlobRef); }}>{COPY.ui.panel.sections.fileDownload(f.blob.name)}</button>}
      {f.isSwatch && <div className={s.swatches}>{f.swatches.map((w) => <Swatch key={w.n} w={w} />)}</div>}
      {f.isCode && f.lines.length > 0 && (
        <div className={s.code}>
          {f.lines.map((ln) => (
            <div key={ln.n} className={s.diffLine} style={{ background: ln.bg, fontFamily: f.mono }}>
              <span className={s.lnNum}>{ln.n}</span>
              <span className={s.lnMark} style={{ color: ln.markFg }}>{ln.mark}</span>
              <span className={s.lnText} style={{ color: ln.fg, textDecoration: ln.strike }}>{ln.s}</span>
            </div>
          ))}
        </div>
      )}
      {f.isCode && wanted && (
        <div className={s.code} aria-live="polite">
          {st.s === 'loading' && <div className={s.diffNote}>{COPY.fileDiff.loading}</div>}
          {st.s === 'error' && (
            <div className={s.diffNote} role="alert">{COPY.fileDiff.failed(st.why)}
              <button type="button" className={s.dl} onClick={retry}>{COPY.fileDiff.retry}</button>
            </div>
          )}
          {st.s === 'done' && st.diff.state === 'binary' && <div className={s.diffNote}>{COPY.fileDiff.binary}</div>}
          {st.s === 'done' && st.diff.state === 'too_large' && <div className={s.diffNote}>{COPY.fileDiff.tooLarge}</div>}
          {st.s === 'done' && st.diff.state === 'text' && <HunkView diff={st.diff} f={f} />}
        </div>
      )}
      {f.isAudio && f.audio && (
        <div className={s.audio}>
          <div><div className={s.audioLabel}>{COPY.ui.panel.sections.fileBefore(f.audio.from)}</div><div className={`${s.wave} ${s.waveBefore}`}></div></div>
          <div><div className={`${s.audioLabel} ${s.audioAfterLabel}`}>{COPY.ui.panel.sections.fileAfter(f.audio.to)}</div><div className={`${s.wave} ${s.waveAfter}`}></div></div>
        </div>
      )}
    </section>
  );
}
