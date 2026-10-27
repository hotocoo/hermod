import { Icon } from '@/components/ui/Icon';
import { getBridge, type BlobRef } from '@/lib/bridge';
import { COPY } from '@/config/copy';
import { blobUrl, humanSize } from '@/lib/upload';
import s from './chat.module.css';

/** Saves through the native dialog in Tauri; elsewhere a plain download link works. */
export function DownloadButton({ blob }: { blob: BlobRef }) {
  const bridge = getBridge();
  if (bridge.kind === 'tauri') {
    return <button type="button" className={s.dl} onClick={() => { void bridge.blobSaveAs(blob.hash, blob.name); }} aria-label={COPY.ui.chat.attachment.downloadNamed(blob.name)}><Icon name="download" size={13} /> {COPY.ui.chat.attachment.download}</button>;
  }
  return <a className={s.dl} href={blobUrl(blob.hash)} download={blob.name} aria-label={COPY.ui.chat.attachment.downloadNamed(blob.name)}><Icon name="download" size={13} /> {COPY.ui.chat.attachment.download}</a>;
}

interface Props { b: BlobRef & { open: () => void } }

/** One attachment: image inline (opens the lightbox), video and audio with controls, anything else as a file chip. */
export function Attachment({ b }: Props) {
  const url = blobUrl(b.hash);
  if (b.mime.startsWith('image/')) {
    return (
      <button type="button" onClick={b.open} aria-label={COPY.ui.chat.attachment.open(b.name)} style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }}>
        
        <img className={s.attImg} src={url} alt={b.name} loading="lazy" />
      </button>
    );
  }
  if (b.mime.startsWith('video/')) {
    return <div><video className={s.attVideo} src={url} controls preload="metadata" aria-label={b.name} /><div><DownloadButton blob={b} /></div></div>;
  }
  if (b.mime.startsWith('audio/')) {
    return <div><audio src={url} controls preload="metadata" aria-label={b.name} /><div><DownloadButton blob={b} /></div></div>;
  }
  return (
    <div className={s.file}>
      <Icon name="doc" size={18} />
      <span className={s.fileName} title={b.name}>{b.name}</span>
      <span className={s.fileSize}>{humanSize(b.size)}</span>
      <DownloadButton blob={b} />
    </div>
  );
}
