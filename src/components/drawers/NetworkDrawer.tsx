'use client';
import { useEffect, useState } from 'react';
import { errorMessage, getBridge, type NodeSettings, type NodeSettingsView, type NodeStatus } from '@/lib/bridge';
import { COPY } from '@/config/copy';
import { humanSize } from '@/lib/upload';
import { useAppStore } from '@/state/store';
import type { ViewModel } from '@/state/viewModel';
import { Switch } from '@/components/ui/Switch';
import { DrawerFrame } from './DrawerFrame';
import s from './NetworkDrawer.module.css';

const net = () => COPY.ui.shell.drawers.net;
const reach = (r: NodeStatus['reachability']) => net().reach[r];
const rate = (n: number) => `${humanSize(n)}/s`;

type SliderKey = 'relay_circuits' | 'relay_bandwidth_bps' | 'blob_cache_bytes' | 'max_connections' | 'event_rate_per_sec' | 'event_burst' | 'max_event_bytes';
type Slider = { key: SliderKey; label: string; min: number; step: number; fmt: (n: number) => string };
const sliders = (): Slider[] => [
  { key: 'relay_circuits', label: net().sliderRelayCircuits, min: 0, step: 1, fmt: String },
  { key: 'relay_bandwidth_bps', label: net().sliderRelayBandwidth, min: 16 * 1024, step: 16 * 1024, fmt: rate },
  { key: 'blob_cache_bytes', label: net().sliderBlobCache, min: 0, step: 64 * 1024 * 1024, fmt: humanSize },
  { key: 'max_connections', label: net().sliderConnections, min: 8, step: 8, fmt: String },
  { key: 'event_rate_per_sec', label: COPY.netEventRate, min: 1, step: 1, fmt: String },
  { key: 'event_burst', label: COPY.netEventBurst, min: 1, step: 1, fmt: String },
  { key: 'max_event_bytes', label: COPY.netEventBytes, min: 16 * 1024, step: 16 * 1024, fmt: humanSize },
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
      <h3 className={s.h}>{net().whatYouShare}</h3>
      <Switch label={net().pauseRelay} sub={net().pauseRelaySub} on={v.relay_paused} onChange={(on) => save({ relay_paused: on })} />
      <Switch label={net().background} sub={net().backgroundSub} on={v.background} onChange={(on) => save({ background: on })} />
      {sliders().map((sl) => {
        const max = view.ceilings[sl.key]; const val = Math.min(v[sl.key], max); const id = `net-${sl.key}`;
        return (
          <label key={sl.key} className={s.slider} htmlFor={id}>
            <span className={s.sliderTop}><span>{sl.label}</span><output htmlFor={id}>{net().sliderValue(sl.fmt(val), sl.fmt(max))}</output></span>
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
    <DrawerFrame label={net().label} kicker={net().kicker} title={net().title} headGap="sm" closeIcon={vm.icS.x} onClose={vm.closeDrawer}>
      <p className={s.note} role="status">{pending > 0 ? net().waiting(pending) : net().synced}</p>
      {!node || !node.running ? (
        <p className={s.empty}>{net().notRunning}</p>
      ) : (
        <dl className={s.stats}>
          <div className={s.stat}><dt>{net().peers}</dt><dd>{node.peers}</dd></div>
          {node.banned > 0 && <div className={s.stat}><dt>{COPY.netBanned}</dt><dd>{node.banned}</dd></div>}
          <div className={s.stat}><dt>{net().relayingNow}</dt><dd>{node.relaying}{node.relay_paused ? net().paused : ''}</dd></div>
          <div className={`${s.stat} ${s.wide}`}><dt>{net().reachability}</dt><dd>{reach(node.reachability)}{node.nat ? ` ${net().nat(node.nat)}` : ''}</dd></div>
          <div className={s.stat}><dt>{net().bandwidth}</dt><dd>{rate(node.bandwidth.in_bps)} / {rate(node.bandwidth.out_bps)}</dd></div>
          <div className={s.stat}><dt>{net().relayTraffic}</dt><dd>{rate(node.bandwidth.relay_bps)}</dd></div>
          <div className={s.stat}><dt>{net().storedForOthers}</dt><dd>{humanSize(node.storage.for_others_bytes)}</dd></div>
          <div className={s.stat}><dt>{net().ownData}</dt><dd>{humanSize(node.storage.own_bytes)}</dd></div>
        </dl>
      )}
      <Caps />
      <h3 className={s.h}>{net().limitsTitle}</h3>
      <ul className={s.limits}>
        <li>{net().limit1}</li>
        <li>{net().limit2}</li>
        <li>{net().limit3}</li>
      </ul>
    </DrawerFrame>
  );
}
