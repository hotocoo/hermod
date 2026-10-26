import { OWN_SEQ_HOLD_MARKER } from '../../config/app';
import { COPY } from '../../config/copy';
import type { Bridge } from './bridge';
import { devhostBridge } from './devhostBridge';
import { tauriBridge } from './tauriBridge';

export type { Bridge } from './bridge';
export { BridgeError } from './bridge';
export * from './types';
export * from './messagingTypes';

/** NEXT_PUBLIC_* is inlined at build time, so production builds contain only the Tauri path. */
const DEVHOST = !!process.env.NEXT_PUBLIC_HERMOD_DEVHOST;

export const getBridge = (): Bridge => (DEVHOST ? devhostBridge : tauriBridge);

/** Readable text for a failed command; the restore post-hold gets its own plain message. */
export const errorMessage = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes(OWN_SEQ_HOLD_MARKER) ? COPY.ownSeqHold : msg;
};
