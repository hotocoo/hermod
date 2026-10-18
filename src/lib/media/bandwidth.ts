import { MEDIA } from '../../config/media';

/** Per-peer video bitrate cap so total uplink stays inside the budget as the mesh grows. */
export function videoBitrate(peers: number, sharing: boolean): number {
  const n = Math.max(1, peers);
  const total = sharing ? MEDIA.call.screenMaxBps : MEDIA.call.uplinkBudgetBps;
  return Math.round(Math.min(MEDIA.call.maxVideoBps * (sharing ? 2 : 1), Math.max(MEDIA.call.minVideoBps, total / n)));
}
