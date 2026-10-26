'use client';
import { statusOf } from '@/state/presence';
import { useAppStore } from '@/state/store';
import s from './presence.module.css';

/** Presence dot for a peer: filled when online, hollow when away. Overlays its (positioned) avatar; `inline` sits in text and also draws offline. */
export function PresenceDot({ id, inline = false, fallbackOnline = false }: { id: string; inline?: boolean; fallbackOnline?: boolean }) {
  // A peer already heard from through presence beacons and now offline opted out (M-026): the connection fallback is only for peers that never beacon.
  const beaconed = useAppStore((x) => x.lastSeen[id] !== undefined);
  const st = useAppStore((x) => statusOf(x.presence, id)) ?? (fallbackOnline && !beaconed ? 'online' : null);
  if (!st && !inline) return null;
  const label = st ?? 'offline';
  return <span role="img" aria-label={label} title={label} className={`${s.dot} ${inline ? s.inline : s.over} ${st === 'online' ? s.on : st === 'away' ? s.away : s.off}`} />;
}
