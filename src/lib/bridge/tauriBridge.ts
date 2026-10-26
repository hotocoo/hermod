import { isBlobHash } from '../blobHash';
import { BridgeError, createBridge, type Transport } from './bridge';

const asError = (command: string, e: unknown) => new BridgeError(command, typeof e === 'string' ? e : e instanceof Error ? e.message : JSON.stringify(e));

/** Tauri IPC: `invoke` for commands, `listen` for `hermod://*` events, `hermod-blob://` for media. */
const tauriTransport: Transport = {
  kind: 'tauri',
  call: async (command, args) => {
    const { invoke } = await import('@tauri-apps/api/core');
    try { return await invoke(command, args); } catch (e) { throw asError(command, e); }
  },
  callRaw: async (command, args, bytes) => {
    const { invoke } = await import('@tauri-apps/api/core');
    // Header values are ASCII: escape everything else as \uXXXX, which JSON parsing undoes.
    const meta = JSON.stringify(args).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    try { return await invoke(command, bytes, { headers: { 'x-hermod-args': meta } }); } catch (e) { throw asError(command, e); }
  },
  listen: (event, handler) => {
    let off: (() => void) | null = null; let dead = false;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen(event, (e) => handler(e.payload)))
      .then((un) => { if (dead) un(); else off = un; })
      .catch((e) => console.error(`listen ${event} failed`, e));
    return () => { dead = true; off?.(); };
  },
  blobUrl: (hash) => (isBlobHash(hash) ? `hermod-blob://${hash}` : ''),
};

export const tauriBridge = createBridge(tauriTransport);
