import { useMemo } from 'react';
import { COPY } from '@/config/copy';
import { qrMatrix } from '@/lib/messaging/qr';

/** QR code drawn locally as one SVG path (dark on white, 4 module quiet zone so it scans in dark mode too). */
export function QrSvg({ text, size = 220, label }: { text: string; size?: number; label: string }) {
  const m = useMemo(() => { try { return qrMatrix(text); } catch { return null; } }, [text]);
  if (!m) return <p role="alert">{COPY.ui.modals.qr.tooLong}</p>;
  const n = m.length; let d = '';
  m.forEach((row, y) => { let x = 0; while (x < n) { if (!row[x]) { x += 1; continue; } let w = 1; while (x + w < n && row[x + w]) w += 1; d += `M${x + 4} ${y + 4}h${w}v1h-${w}z`; x += w; } });
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n + 8} ${n + 8}`} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 8 }}>
      <path d={d} fill="#000" />
    </svg>
  );
}
