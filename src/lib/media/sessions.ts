/**
 * Pure signalling rules (no browser APIs), unit tested.
 */

export type SignalType =
  | 'hello' | 'hello-ack' | 'offer' | 'answer' | 'ice' | 'hangup' | 'renegotiate' | 'rec'
  | 'live-join' | 'live-leave' | 'live-forward';

export const SIGNAL_TYPES: readonly SignalType[] = [
  'hello', 'hello-ack', 'offer', 'answer', 'ice', 'hangup', 'renegotiate', 'rec', 'live-join', 'live-leave', 'live-forward',
];

/** Envelope of every signalling payload. `scope` names the room (`call:<id>`) or stream (`live:<id>`). */
export interface SignalMsg {
  m: 'hermod.media';
  v: number;
  scope: string;
  /** Sender session id, sortable by creation time (see `newSid`). */
  sid: string;
  type: SignalType;
  to?: string;
  data?: unknown;
}

export const ENVELOPE = 'hermod.media';

/** Validates an untrusted payload from the network; null when it is not a media message we understand. */
export function parseSignal(payload: unknown, version: number): SignalMsg | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.m !== ENVELOPE || p.v !== version) return null;
  if (typeof p.scope !== 'string' || p.scope.length === 0 || p.scope.length > 128) return null;
  if (typeof p.sid !== 'string' || p.sid.length === 0 || p.sid.length > 64) return null;
  if (typeof p.type !== 'string' || !(SIGNAL_TYPES as readonly string[]).includes(p.type)) return null;
  if (p.to !== undefined && typeof p.to !== 'string') return null;
  return { m: ENVELOPE, v: version, scope: p.scope, sid: p.sid, type: p.type as SignalType, to: p.to as string | undefined, data: p.data };
}

/** Session id: 9 base36 chars of epoch ms (sorts by time) plus 6 random chars. */
export function newSid(now = Date.now(), rand: () => number = Math.random): string {
  const t = now.toString(36).padStart(9, '0');
  let r = '';
  while (r.length < 6) r += Math.floor(rand() * 36).toString(36);
  return `${t}${r}`;
}

/** Types that may start (or restart) a remote session; anything else only joins an existing one. */
const ESTABLISHING: ReadonlySet<SignalType> = new Set(['hello', 'hello-ack', 'offer', 'live-join', 'live-forward']);

export type GateResult = 'accept' | 'reset' | 'drop';

/**
 * Decides what to do with a message given the remote session id we currently know for that peer.
 * Newer sid + establishing type: the peer restarted, drop the old link (reset). Older sid: stale, drop.
 */
export function gateSession(current: string | undefined, type: SignalType, sid: string): GateResult {
  if (current === undefined) return 'accept';
  if (sid === current) return 'accept';
  if (sid < current) return 'drop';
  return ESTABLISHING.has(type) ? 'reset' : 'drop';
}

/** Perfect negotiation: true when the peer with id `self` yields on offer collisions. Lower id is polite. */
export const isPolite = (self: string, remote: string): boolean => self < remote;

export interface NegotiationState { polite: boolean; makingOffer: boolean; signalingState: string; settingRemoteAnswer: boolean }

/** Decision for an incoming offer or answer (W3C perfect negotiation). `collision` means a polite peer must rollback. */
export function onRemoteDescription(s: NegotiationState, type: 'offer' | 'answer'): { ignore: boolean; collision: boolean } {
  const ready = !s.makingOffer && (s.signalingState === 'stable' || s.settingRemoteAnswer);
  const collision = type === 'offer' && !ready;
  return { ignore: !s.polite && collision, collision };
}
