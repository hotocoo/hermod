import { getBridge, errorMessage } from '@/lib/bridge';
import { blobUrl } from '@/lib/upload';
import { useAppStore } from '@/state/store';
import type { BlobRef } from '@/lib/bridge';
import { Swatch, type SwatchData } from './Swatch';
import s from './skein.module.css';

interface DiffLineData { s: string; mark: string; n: number; bg: string; fg: string; strike: string; markFg: string }
export interface SkeinFileData {
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

/** One changed file: swatch grid, code/doc diff or audio before/after. */
export function FileDiff({ f }: { f: SkeinFileData }) {
  return (
    <section className={s.file}>
      <div className={s.fileHead}>
        <span className={s.filePath}>{f.path}</span><span className={s.fileKind}>{f.kindLabel}</span>
        <span className={`${s.tnum} ${s.adds}`}>+{f.adds}</span><span className={s.dels}>−{f.dels}</span>
      </div>
      
      {f.previewUrl && <img className={s.preview} src={f.previewUrl} alt={f.path} />}
      {f.blob && <button type="button" className={s.dl} onClick={() => { void download(f.blob as BlobRef); }}>Download {f.blob.name}</button>}
      {f.isSwatch && <div className={s.swatches}>{f.swatches.map((w) => <Swatch key={w.n} w={w} />)}</div>}
      {f.isCode && (
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
      {f.isAudio && f.audio && (
        <div className={s.audio}>
          <div><div className={s.audioLabel}>Before · {f.audio.from}</div><div className={`${s.wave} ${s.waveBefore}`}></div></div>
          <div><div className={`${s.audioLabel} ${s.audioAfterLabel}`}>After · {f.audio.to}</div><div className={`${s.wave} ${s.waveAfter}`}></div></div>
        </div>
      )}
    </section>
  );
}
