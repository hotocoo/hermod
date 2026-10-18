import type { PeerStats, Quality } from './types';

export interface StatSample { t: number; bytesIn: number; bytesOut: number; packetsIn: number; lostIn: number; rttMs: number | null }

interface Row { type?: string; bytesReceived?: number; bytesSent?: number; packetsReceived?: number; packetsLost?: number; currentRoundTripTime?: number; nominated?: boolean; state?: string; selected?: boolean; id?: string; selectedCandidatePairId?: string }

/** Totals of one RTCStatsReport. `now` is injected for tests. */
export function sampleFromReport(report: Iterable<Row> | { forEach(cb: (v: Row) => void): void }, now: number): StatSample {
  const s: StatSample = { t: now, bytesIn: 0, bytesOut: 0, packetsIn: 0, lostIn: 0, rttMs: null };
  let selected: string | undefined;
  const pairs: Row[] = [];
  const visit = (r: Row) => {
    if (r.type === 'inbound-rtp') { s.bytesIn += r.bytesReceived ?? 0; s.packetsIn += r.packetsReceived ?? 0; s.lostIn += Math.max(0, r.packetsLost ?? 0); }
    else if (r.type === 'outbound-rtp') s.bytesOut += r.bytesSent ?? 0;
    else if (r.type === 'transport' && r.selectedCandidatePairId) selected = r.selectedCandidatePairId;
    else if (r.type === 'candidate-pair') pairs.push(r);
  };
  if ('forEach' in report && typeof report.forEach === 'function') (report as { forEach(cb: (v: Row) => void): void }).forEach(visit);
  else for (const r of report as Iterable<Row>) visit(r);
  const pair = pairs.find((p) => p.id === selected) ?? pairs.find((p) => p.nominated && p.state === 'succeeded') ?? pairs.find((p) => p.selected);
  if (pair?.currentRoundTripTime !== undefined) s.rttMs = Math.round(pair.currentRoundTripTime * 1000);
  return s;
}

/** Rates between two samples. Counters that went backwards (ICE restart, new transport) count as zero. */
export function diffSamples(prev: StatSample | null, cur: StatSample): PeerStats {
  if (!prev || cur.t <= prev.t) return { rttMs: cur.rttMs, inBps: 0, outBps: 0, lossPct: 0 };
  const secs = (cur.t - prev.t) / 1000;
  const d = (a: number, b: number) => Math.max(0, a - b);
  const packets = d(cur.packetsIn, prev.packetsIn);
  const lost = d(cur.lostIn, prev.lostIn);
  return {
    rttMs: cur.rttMs,
    inBps: Math.round((d(cur.bytesIn, prev.bytesIn) * 8) / secs),
    outBps: Math.round((d(cur.bytesOut, prev.bytesOut) * 8) / secs),
    lossPct: packets + lost === 0 ? 0 : Math.round((lost / (packets + lost)) * 1000) / 10,
  };
}

export function classify(s: PeerStats | undefined, poorRttMs: number, poorLossPct: number): Quality {
  if (!s || s.rttMs === null) return 'unknown';
  return s.rttMs > poorRttMs || s.lossPct > poorLossPct ? 'poor' : 'good';
}
