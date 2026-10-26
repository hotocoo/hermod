import type { SnapVerify } from '../lib/bridge';

/** What the seal check shows: pending, clean, altered (red), partly not downloaded, or could not run. */
export type SealView =
  | { s: 'checking' } | { s: 'verified' } | { s: 'tampered'; files: string[] } | { s: 'partial'; missing: number } | { s: 'error'; why: string };

/** Corrupt files win over missing ones: altered bytes are a tamper warning, missing bytes are only not fetched yet. */
export function sealView(v: SnapVerify): SealView {
  if (v.corrupt.length > 0) return { s: 'tampered', files: v.corrupt };
  if (v.missing.length > 0) return { s: 'partial', missing: v.missing.length };
  return { s: 'verified' };
}
