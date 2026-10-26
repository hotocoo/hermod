'use client';
import { Dialog } from '@/components/ui/Dialog';
import { DownloadButton } from '@/components/chat/Attachment';
import { COPY } from '@/config/copy';
import type { BlobRef } from '@/lib/bridge';
import { blobUrl } from '@/lib/upload';
import { useAppStore } from '@/state/store';

/** Full-size image or video from the blob store. Esc and the backdrop close it (Dialog); neighbour cycling is not wired. */
export function LightboxModal({ blob }: { blob: BlobRef }) {
  const close = useAppStore((s) => s.closeModal);
  const url = blobUrl(blob.hash);
  return (
    <Dialog title={blob.name || COPY.ui.modals.lightbox.fallbackTitle} onClose={close} wide>
      {blob.mime.startsWith('video/') ? (
        <video src={url} controls autoPlay preload="metadata" aria-label={blob.name} style={{ width: '100%', maxHeight: '68dvh', background: '#000' }} />
      ) : blob.mime.startsWith('image/') ? (
         
        <img src={url} alt={blob.name} style={{ maxWidth: '100%', maxHeight: '68dvh', margin: '0 auto', objectFit: 'contain' }} />
      ) : <p>{COPY.ui.modals.lightbox.noPreview}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><DownloadButton blob={blob} /></div>
    </Dialog>
  );
}
