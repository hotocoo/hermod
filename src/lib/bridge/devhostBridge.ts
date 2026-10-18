import { BridgeError, createBridge, type Transport } from './bridge';

/**
 * Devhost: the exact Tauri command set over HTTP (docs/ARCHITECTURE.md section 9). Built only when NEXT_PUBLIC_HERMOD_DEVHOST is set.
 * The env value is the base URL; `?devhost=<url>` overrides it per page so one build can drive two peers.
 */
function baseUrl(): string {
  const fixed = (process.env.NEXT_PUBLIC_HERMOD_DEVHOST ?? '').replace(/\/$/, '');
  const override = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('devhost');
  return (override ?? fixed).replace(/\/$/, '');
}

const devhostTransport: Transport = {
  kind: 'devhost',
  call: async (command, args) => {
    const res = await fetch(`${baseUrl()}/invoke/${command}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args ?? {}),
    });
    const text = await res.text();
    if (!res.ok) throw new BridgeError(command, text || `${command} failed (${res.status})`);
    return (text ? JSON.parse(text) : null) as never;
  },
  listen: (event, handler) => {
    const source = sharedSource();
    const on = (m: MessageEvent<string>) => handler(JSON.parse(m.data));
    source.addEventListener(event, on as EventListener);
    return () => source.removeEventListener(event, on as EventListener);
  },
  blobUrl: (hash) => `${baseUrl()}/blob/${hash}`,
};

let source: EventSource | null = null;
/** One SSE connection serves every listener (SSE `event:` name = Tauri event name, `data:` = JSON payload). */
function sharedSource(): EventSource {
  if (!source) source = new EventSource(`${baseUrl()}/events`);
  return source;
}

export const devhostBridge = createBridge(devhostTransport);
