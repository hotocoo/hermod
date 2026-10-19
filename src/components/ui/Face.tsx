'use client';
import { useEffect, useState } from 'react';
import { blobUrl } from '@/lib/upload';

const IMG: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' };
/** A peer's photo may still be syncing; try the blob again after this long. */
const RETRY_MS = 15_000;

/** Avatar photo filling its (already styled) parent; initials while there is none or its blob has not synced yet. */
export function Face({ initials, av }: { initials: string; av?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => setFailed(null), RETRY_MS);
    return () => clearTimeout(t);
  }, [failed]);
  if (!av || failed === av) return <>{initials}</>;
  return <img src={blobUrl(av)} alt="" style={IMG} draggable={false} onError={() => setFailed(av)} />;
}
