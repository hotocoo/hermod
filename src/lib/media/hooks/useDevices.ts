'use client';
import { useCallback, useEffect, useState } from 'react';
import type { DeviceList } from '../types';

const EMPTY: DeviceList = { mics: [], cams: [], speakers: [] };

/** Mics, cameras and speakers, refreshed on `devicechange`. Labels stay empty until the user has granted access once (`unlock`). */
export function useDevices(): { devices: DeviceList; refresh: () => Promise<void>; unlock: () => Promise<void>; error: string | null } {
  const [devices, setDevices] = useState<DeviceList>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) { setError('This device cannot list audio and video devices.'); return; }
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.deviceId);
    setDevices({ mics: all.filter((d) => d.kind === 'audioinput'), cams: all.filter((d) => d.kind === 'videoinput'), speakers: all.filter((d) => d.kind === 'audiooutput') });
  }, []);

  /** Opens and closes the mic once so the browser reveals device names. Call from a user gesture. */
  const unlock = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch { setError('Allow microphone access to see device names.'); }
  }, [refresh]);

  useEffect(() => {
    const first = setTimeout(() => { void refresh().catch(() => setError('Could not list devices.')); }, 0);
    const md = navigator.mediaDevices;
    const on = () => { void refresh().catch(() => undefined); };
    md?.addEventListener?.('devicechange', on);
    return () => { clearTimeout(first); md?.removeEventListener?.('devicechange', on); };
  }, [refresh]);

  return { devices, refresh, unlock, error };
}
