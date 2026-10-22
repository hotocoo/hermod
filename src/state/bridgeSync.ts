/** Rust to UI: subscribes to the bridge events and keeps the store in step with the core. Returns cleanup. */
import { getBridge } from '../lib/bridge';
import { getNotifySettings, setNotifySettings } from './notify';
import type { StoreLike } from './types';

type SignalHandler = (from: string, payload: unknown, space?: string) => void;
const signalHandlers = new Set<SignalHandler>();

/** The media layer (WebRTC) registers here to receive signalling from `hermod://signal`. */
export function onSignal(h: SignalHandler): () => void {
  signalHandlers.add(h);
  return () => { signalHandlers.delete(h); };
}

export function startBridgeSync(store: StoreLike): () => void {
  const bridge = getBridge(); const get = store.getState;
  const stops = [
    bridge.on('changed', () => get().refreshSoon()),
    bridge.on('node', (e) => get().setNode(e.status)),
    bridge.on('sync', (e) => get().setSync(e.pending)),
    bridge.on('ephemeral', (e) => {
      const sp = e.space_id ?? '';
      const p = (e.payload ?? {}) as { channel?: string; away?: boolean };
      if (e.kind === 'typing' && typeof p.channel === 'string') get().noteTyping(e.from, sp, p.channel);
      else if (e.kind === 'presence') get().notePresence(e.from, p.away === true);
    }),
    bridge.on('signal', (e) => signalHandlers.forEach((h) => h(e.from, e.payload, e.space_id))),
  ];
  bridge.nodeStatus().then((n) => get().setNode(n)).catch(() => { /* the node starts after the Terms gate; its first event fills this in */ });
  bridge.outboxStatus().then((o) => get().setSync(o.pending)).catch(() => { /* indicator stays hidden until the first sync event */ });
  if (!getNotifySettings()) bridge.notifySettingsGet().then(setNotifySettings).catch(() => { /* notifications stay off without settings */ });
  return () => stops.forEach((f) => f());
}
