'use client';
import { useEffect, useState } from 'react';
import { errorMessage, getBridge, type NodeSettings, type NodeSettingsView, type NodeStatus } from '@/lib/bridge';
import { humanSize } from '@/lib/upload';
import { useAppStore } from '@/state/store';
import type { ViewModel } from '@/state/viewModel';
import { Switch } from '@/components/ui/Switch';
import { DrawerFrame } from './DrawerFrame';
import s from './NetworkDrawer.module.css';

const REACH: Record<NodeStatus['reachability'], string> = {
  public: 'Reachable from the internet. You can act as a relay for people behind strict networks.',
  private: 'Behind a router or firewall. Hermod uses hole punching and other people’s relays to connect you.',
  unknown: 'Still checking how your network looks from outside.',
};
const rate = (n: number) => `${humanSize(n)}/s`;

type Slider = { key: 'relay_circuits' | 'relay_bandwidth_bps' | 'blob_cache_bytes' | 'max_connections'; label: string; min: number; step: number; fmt: (n: number) => string };
const SLIDERS: Slider[] = [
  { key: 'relay_circuits', label: 'Relay circuits for others', min: 0, step: 1, fmt: String },
  { key: 'relay_bandwidth_bps', label: 'Relay bandwidth', min: 16 * 1024, step: 16 * 1024, fmt: rate },
  { key: 'blob_cache_bytes', label: 'Encrypted cache kept for others', min: 0, step: 64 * 1024 * 1024, fmt: humanSize },
  { key: 'max_connections', label: 'Connections', min: 8, step: 8, fmt: String },
];

function Caps() {
  const toast = useAppStore((st) => st.showToast);
  const [view, setView] = useState<NodeSettingsView | null>(null);
  const [draft, setDraft] = useState<Partial<NodeSettings>>({});
  useEffect(() => { getBridge().nodeSettingsGet().then(setView).catch((e) => toast(errorMessage(e), undefined, 'error')); }, [toast]);
  if (!view) return null;
  const save = async (patch: Partial<NodeSettings>) => {
    try { setView(await getBridge().nodeSettingsSet(patch)); setDraft({}); } catch (e) { toast(errorMessage(e), undefined, 'error'); }
  };
  const v = { ...view.values, ...draft };
  return (
    <>
      <h3 className={s.h}>What you share</h3>
      <Switch label="Pause relaying" sub="Stop carrying traffic for other people. Your own spaces keep syncing." on={v.relay_paused} onChange={(on) => save({ relay_paused: on })} />
      <Switch label="Keep helping the network in the background" sub="Closing the window keeps the node running. Quit from the tray to stop it." on={v.background} onChange={(on) => save({ background: on })} />
      {SLIDERS.map((sl) => {
        const max = view.ceilings[sl.key]; const val = Math.min(v[sl.key], max); const id = `net-${sl.key}`;
        return (
          <label key={sl.key} className={s.slider} htmlFor={id}>
            <span className={s.sliderTop}><span>{sl.label}</span><output htmlFor={id}>{sl.fmt(val)} of {sl.fmt(max)} max</output></span>
            <input id={id} type="range" min={sl.min} max={max} step={sl.step} value={val}
              onChange={(e) => setDraft((d) => ({ ...d, [sl.key]: Number(e.target.value) }))}
              onPointerUp={() => save({ [sl.key]: val })} onKeyUp={() => save({ [sl.key]: val })} />
          </label>
        );
      })}
    </>
  );
}

/** Network panel (W-001): live node status, resource caps bounded by the hard ceilings, and the honest limits. */
export function NetworkDrawer({ vm }: { vm: ViewModel }) {
  const node = useAppStore((st) => st.node);
  const pending = useAppStore((st) => st.syncPending);
  if (!vm.drawerNet) return null;
  return (
    <DrawerFrame label="Network" kicker="Network" title="Your place in the mesh" headGap="sm" closeIcon={vm.icS.x} onClose={vm.closeDrawer}>
      <p className={s.note} role="status">{pending > 0 ? `Waiting to sync ${pending} ${pending === 1 ? 'change' : 'changes'}. They send as soon as a peer is reachable.` : 'Everything you did is synced.'}</p>
      {!node || !node.running ? (
        <p className={s.empty}>The network node is not running. It starts after you accept the Terms, and stops when you quit unless background mode is on.</p>
      ) : (
        <dl className={s.stats}>
          <div className={s.stat}><dt>Peers</dt><dd>{node.peers}</dd></div>
          {node.banned > 0 && <div className={s.stat}><dt>Banned for flooding</dt><dd>{node.banned}</dd></div>}
          <div className={s.stat}><dt>Relaying now</dt><dd>{node.relaying}{node.relay_paused ? ' (paused)' : ''}</dd></div>
          <div className={`${s.stat} ${s.wide}`}><dt>Reachability</dt><dd>{REACH[node.reachability]}{node.nat ? ` NAT: ${node.nat}.` : ''}</dd></div>
          <div className={s.stat}><dt>Bandwidth in / out</dt><dd>{rate(node.bandwidth.in_bps)} / {rate(node.bandwidth.out_bps)}</dd></div>
          <div className={s.stat}><dt>Relay traffic</dt><dd>{rate(node.bandwidth.relay_bps)}</dd></div>
          <div className={s.stat}><dt>Stored for others</dt><dd>{humanSize(node.storage.for_others_bytes)}</dd></div>
          <div className={s.stat}><dt>Your own data</dt><dd>{humanSize(node.storage.own_bytes)}</dd></div>
        </dl>
      )}
      <Caps />
      <h3 className={s.h}>Honest limits</h3>
      <ul className={s.limits}>
        <li>Two people behind symmetric NATs may not connect until a reachable Hermod peer is online.</li>
        <li>Public bootstrap nodes and STUN servers are third-party services; they see your IP address.</li>
        <li>Anyone with a space’s invite code can read it. Removing a member does not recall what they already received.</li>
      </ul>
    </DrawerFrame>
  );
}
