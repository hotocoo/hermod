'use client';
import { statusOf } from '@/state/presence';
import { useAppStore } from '@/state/store';
import s from './presence.module.css';

/** Presence dot for a peer: filled when online, hollow when away. Overlays its (positioned) avatar; `inline` sits in text and also draws offline. */
export function PresenceDot({ id, inline = false, fallbackOnline = false }: { id: string; inline?: boolean; fallbackOnline?: boolean }) {
  const st = useAppStore((x) => statusOf(x.presence, id)) ?? (fallbackOnline ? 'online' : null);
  if (!st && !inline) return null;
  const label = st ?? 'offline';
  return <span role="img" aria-label={label} title={label} className={`${s.dot} ${inline ? s.inline : s.over} ${st === 'online' ? s.on : st === 'away' ? s.away : s.off}`} />;
}
