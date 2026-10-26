'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { STORAGE_KEYS } from '@/config/app';
import { COPY } from '@/config/copy';
import { FRAME_LIMIT } from '@/config/scene';
import { savedFrameCap } from '@/scene/frameLimit';
import { errorMessage, getBridge, type KeyMode, type NotifySettings, type StorageUsage, type UpdateInfo } from '@/lib/bridge';
import { wallMs } from '@/lib/clock';
import { copyText } from '@/lib/clipboard';
import { readString, writeString } from '@/lib/storage';
import { applyTextScale } from '@/lib/theme';
import type { MotionMode } from '@/lib/prefs';
import { humanSize } from '@/lib/upload';
import { setNotifySettings } from '@/state/notify';
import { appendEvent } from '@/state/act';
import { spaceOf } from '@/state/helpers';
import { getTown } from '@/state/townPort';
import { getLocalMapStyle, resolveMapStyle, setLocalMapStyle, type MapStyleChoice } from '@/scene/styles/pref';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import { Switch } from '@/components/ui/Switch';
import f from '@/components/ui/form.module.css';
import { CopyField } from './CopyField';
import { RecoveryPhrase } from './RecoveryPhrase';

const TABS = [
  ['notifications', 'Notifications'], ['appearance', 'Appearance'], ['devices', 'Audio and video'], ['storage', 'Storage'], ['backup', 'Backup'],
  ['updates', 'Updates'], ['network', 'Network'], ['logs', 'Logs'], ['identity', 'Identity'],
] as const;
type TabId = (typeof TABS)[number][0];
const SCALES = [100, 115, 130, 150];
const MIN_PASS = 8;
const LOG_LINES = 1000;

const useToast = () => useAppStore((s) => s.showToast);
const fail = (toast: ReturnType<typeof useToast>, e: unknown) => toast(errorMessage(e), undefined, 'error');

export function AppSettingsModal({ tab }: { tab?: string }) {
  const close = useAppStore((s) => s.closeModal);
  const [cur, setCur] = useState<TabId>(TABS.some(([id]) => id === tab) ? (tab as TabId) : 'notifications');
  return (
    <Dialog title="App settings" kicker="Settings" onClose={close} wide>
      <div role="tablist" aria-label="Settings sections" className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={cur === id} className="seg-opt" onClick={() => setCur(id)}
            style={cur === id ? { color: 'var(--color-accent-700)', boxShadow: 'inset 0 0 0 1px var(--color-accent)' } : undefined}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {cur === 'notifications' && <Notifications />}
        {cur === 'appearance' && <Appearance />}
        {cur === 'devices' && <Devices />}
        {cur === 'storage' && <Storage />}
        {cur === 'backup' && <Backup />}
        {cur === 'updates' && <Updates />}
        {cur === 'network' && <NetworkLink />}
        {cur === 'logs' && <Logs />}
        {cur === 'identity' && <Identity />}
      </div>
    </Dialog>
  );
}

function Notifications() {
  const toast = useToast();
  const spaces = useAppStore((s) => s.spaces);
  const [n, setN] = useState<NotifySettings | null>(null);
  useEffect(() => { getBridge().notifySettingsGet().then(setN).catch((e) => fail(toast, e)); }, [toast]);
  if (!n) return <p className={f.note}>Loading…</p>;
  const save = async (patch: Partial<NotifySettings>) => {
    try { const v = await getBridge().notifySettingsSet(patch); setN(v); setNotifySettings(v); } catch (e) { fail(toast, e); }
  };
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const sch = n.dnd_schedule;
  return (
    <>
      <Switch label="Desktop notifications" sub="Shown only while the window is not focused." on={n.enabled} onChange={(on) => save({ enabled: on })} />
      <Switch label="Direct messages" on={n.dm} disabled={!n.enabled} onChange={(on) => save({ dm: on })} />
      <Switch label="Mentions" on={n.mention} disabled={!n.enabled} onChange={(on) => save({ mention: on })} />
      <Switch label="Meetings starting" on={n.meeting} disabled={!n.enabled} onChange={(on) => save({ meeting: on })} />
      <Switch label="Calendar reminders" on={n.reminder} disabled={!n.enabled} onChange={(on) => save({ reminder: on })} />
      <div className={f.row} style={{ marginTop: 12 }}>
        <span>Do not disturb</span>
        <button type="button" className="btn btn-secondary" onClick={() => save({ dnd_until: Date.now() + 3600_000 })}>For 1 hour</button>
        <button type="button" className="btn btn-secondary" onClick={() => save({ dnd_until: Date.now() + 8 * 3600_000 })}>For 8 hours</button>
        {n.dnd_until && n.dnd_until > wallMs() && <button type="button" className="btn btn-secondary" onClick={() => save({ dnd_until: null })}>Turn off (until {new Date(n.dnd_until).toLocaleTimeString()})</button>}
      </div>
      <Switch label="Quiet hours every day" on={sch.enabled} onChange={(on) => save({ dnd_schedule: { ...sch, enabled: on } })} />
      {sch.enabled && (
        <div className={f.row}>
          <label className={f.label} htmlFor="dnd-from">From</label>
          <select id="dnd-from" className="input" style={{ width: 90 }} value={sch.from_hour} onChange={(e) => save({ dnd_schedule: { ...sch, from_hour: Number(e.target.value) } })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
          <label className={f.label} htmlFor="dnd-to">to</label>
          <select id="dnd-to" className="input" style={{ width: 90 }} value={sch.to_hour} onChange={(e) => save({ dnd_schedule: { ...sch, to_hour: Number(e.target.value) } })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </div>
      )}
      <h3 style={{ fontSize: 18, margin: '14px 0 2px' }}>Muted spaces</h3>
      {spaces.map((sp) => (
        <Switch key={sp.id} label={sp.name} sub="Still badges quietly, no notifications." on={n.muted_spaces.includes(sp.id)} onChange={() => save({ muted_spaces: toggleIn(n.muted_spaces, sp.id) })} />
      ))}
      {n.muted_channels.length > 0 && (
        <>
          <h3 style={{ fontSize: 18, margin: '14px 0 2px' }}>Muted channels</h3>
          {n.muted_channels.map((c) => <Switch key={c} label={c} on onChange={() => save({ muted_channels: n.muted_channels.filter((x) => x !== c) })} />)}
        </>
      )}
    </>
  );
}

function Appearance() {
  const s = useAppStore();
  const [scale, setScale] = useState(() => Number(readString(STORAGE_KEYS.textScale)) || 100);
  const [cap, setCap] = useState<string>(() => savedFrameCap());
  const setFrameCap = (id: string) => { setCap(id); writeString(STORAGE_KEYS.fpsCap, id); getTown()?.setFrameCap(id); };
  const set = (p: number) => { setScale(p); writeString(STORAGE_KEYS.textScale, String(p)); applyTextScale(p); };
  return (
    <>
      <Switch label="Dark theme" on={s.theme === 'dark'} onChange={() => s.toggleTheme()} />
      <Switch label="Paper grain" on={s.grain} onChange={() => s.toggleSetting('grain')} />
      <Switch label="Theme follows the sky" on={s.skyTheme} onChange={() => s.toggleSetting('skyTheme')} />
      <div className={f.field} style={{ marginTop: 12 }}>
        <label className={f.label} htmlFor="motion-mode">Reduced motion</label>
        <select id="motion-mode" className="input" value={s.motion} onChange={(e) => s.setMotion(e.target.value as MotionMode)}>
          <option value="system">Follow the system</option>
          <option value="reduce">Always reduce</option>
          <option value="full">Always full</option>
        </select>
      </div>
      <div className={f.field} style={{ marginTop: 12 }}>
        <label className={f.label} htmlFor="txt-scale">Text size</label>
        <select id="txt-scale" className="input" value={scale} onChange={(e) => set(Number(e.target.value))}>
          {SCALES.map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
      </div>
      <div className={f.field} style={{ marginTop: 12 }}>
        <label className={f.label} htmlFor="fps-cap">Frame rate</label>
        <select id="fps-cap" className="input" value={cap} onChange={(e) => setFrameCap(e.target.value)} aria-describedby="fps-cap-note">
          {FRAME_LIMIT.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <span id="fps-cap-note" className={f.note}>{FRAME_LIMIT.options.find((o) => o.id === cap)?.note}</span>
      </div>
      <MapStyle />
    </>
  );
}

const MAP_CHOICES: { id: MapStyleChoice; label: string; blurb: string }[] = [
  { id: 'village', label: 'Village', blurb: 'Cottages, lanes and greens around a gazebo hearth and a harbour.' },
  { id: 'sanctuary', label: 'Sanctuary', blurb: 'A walled temenos of marble halls on terraces, with a stadium and a river.' },
];

/** Map style: this device's choice (instant, saved locally) and, for admins, the space default everyone else gets. */
function MapStyle() {
  const get = useAppStore.getState;
  const space = useAppStore((s) => s.space);
  const sp = useAppStore((s) => spaceOf(s.spaces, s.space));
  const admin = sp.role === 'owner' || sp.role === 'admin';
  const [local, setLocal] = useState<MapStyleChoice | null>(() => getLocalMapStyle());
  const shown = resolveMapStyle(sp.mapStyle, local);
  const pick = (v: MapStyleChoice | 'default') => { const l = v === 'default' ? null : v; setLocalMapStyle(l); setLocal(l); getTown()?.setMapStyle(v); };
  const setDefault = async () => { if (await appendEvent(get, space, { t: 'space.update', map_style: shown })) get().showToast('Space default saved'); };
  const def = resolveMapStyle(sp.mapStyle, null);
  const opts = [{ id: 'default' as const, label: `Space default (${MAP_CHOICES.find((c) => c.id === def)?.label})`, blurb: 'Follow what this space\'s admins chose.' }, ...MAP_CHOICES];
  return (
    <fieldset className={f.field} style={{ marginTop: 16, border: 0, padding: 0 }}>
      <legend className={f.label}>Map style on this device</legend>
      {opts.map((o) => (
        <label key={o.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', cursor: 'pointer' }}>
          <input type="radio" name="map-style" value={o.id} checked={(local ?? 'default') === o.id} onChange={() => pick(o.id)} style={{ marginTop: 4 }} />
          <span><strong>{o.label}</strong><br /><span className={f.note}>{o.blurb}</span></span>
        </label>
      ))}
      {admin && <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start', marginTop: 8 }} disabled={sp.mapStyle === shown} onClick={setDefault}>Set {MAP_CHOICES.find((c) => c.id === shown)?.label} as space default</button>}
    </fieldset>
  );
}

const DEVICE_KEY = (k: string) => `hermodr.device.${k}`;
function Devices() {
  const [list, setList] = useState<MediaDeviceInfo[] | null>(null);
  const [err, setErr] = useState('');
  const [, bump] = useState(0);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(setList).catch((e) => setErr(errorMessage(e)));
  }, []);
  const shownErr = err || (navigator.mediaDevices ? '' : 'This webview exposes no media devices.');
  const pick = (kind: MediaDeviceKind, label: string, key: string) => {
    const opts = (list ?? []).filter((d) => d.kind === kind);
    return (
      <div className={f.field} key={key}>
        <label className={f.label} htmlFor={`dev-${key}`}>{label}</label>
        <select id={`dev-${key}`} className="input" value={readString(DEVICE_KEY(key)) ?? ''} onChange={(e) => { writeString(DEVICE_KEY(key), e.target.value); bump((x) => x + 1); }}>
          <option value="">System default</option>
          {opts.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>)}
        </select>
      </div>
    );
  };
  return (
    <>
      {shownErr && <p className={f.error}>{shownErr}</p>}
      {pick('audioinput', 'Microphone', 'mic')}
      {pick('videoinput', 'Camera', 'cam')}
      {pick('audiooutput', 'Speaker', 'spk')}
      <p className={f.note}>Device names appear after you have allowed microphone or camera access in a call.</p>
    </>
  );
}

function Storage() {
  const toast = useToast(); const confirm = useAppStore((s) => s.confirmAction);
  const [u, setU] = useState<StorageUsage | null>(null);
  const load = useCallback(() => { getBridge().storageUsage().then(setU).catch((e) => fail(toast, e)); }, [toast]);
  useEffect(load, [load]);
  if (!u) return <p className={f.note}>Loading…</p>;
  const clear = async () => {
    if (!(await confirm({ title: 'Clear the cache?', body: 'Removes encrypted data you hold only for other people. Your own spaces are untouched.', confirm: 'Clear cache' }))) return;
    try { const r = await getBridge().storageClearCache(); toast(`Freed ${humanSize(r.freed_bytes)}`); load(); } catch (e) { fail(toast, e); }
  };
  return (
    <>
      <p className={f.note}>Total on this device: {humanSize(u.total_bytes)}. Held for others: {humanSize(u.cache_for_others_bytes)}.</p>
      {u.per_space.length > 0 && (
        <table className={f.table}>
          <thead><tr><th scope="col">Space</th><th scope="col">Size</th></tr></thead>
          <tbody>{u.per_space.map((p) => <tr key={p.space_id}><td>{p.name}</td><td>{humanSize(p.bytes)}</td></tr>)}</tbody>
        </table>
      )}
      <div className={f.actions}><button type="button" className="btn btn-secondary" onClick={clear}>Clear cache</button></div>
    </>
  );
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function Backup() {
  const toast = useToast(); const ask = useAppStore((s) => s.ask); const confirm = useAppStore((s) => s.confirmAction);
  const [pass, setPass] = useState(''); const [again, setAgain] = useState(''); const [blobs, setBlobs] = useState(true); const [busy, setBusy] = useState(false);
  const ok = pass.length >= MIN_PASS && pass === again;
  // `fn` resolves to the message to show, or nothing when the person cancelled (a second toast would replace the first at once).
  const run = async (fn: () => Promise<string | undefined>) => { setBusy(true); try { const done = await fn(); if (done) toast(done); } catch (e) { fail(toast, e); } setBusy(false); };

  const exportBackup = () => run(async () => {
    const name = `hermod-backup-${new Date().toISOString().slice(0, 10)}.hermodbak`;
    let typed: string | undefined;
    if (!isTauri()) { const v = await ask({ title: 'Save backup to', submit: 'Export', fields: [{ key: 'p', label: 'File path', initial: name, required: true }] }); if (!v) return; typed = v.p.trim(); }
    const path = await getBridge().backupExport(name, pass, blobs, typed);
    if (!path) return;
    return `Saved to ${path}`;
  });

  const importBackup = () => run(async () => {
    let path: string | undefined;
    if (isTauri()) path = (await getBridge().pickFiles({ accept: ['hermodbak'] }))?.[0];
    else path = (await ask({ title: 'Restore from', submit: 'Restore', fields: [{ key: 'p', label: 'File path', required: true }] }))?.p.trim();
    if (!path) return;
    if (!pass) throw new Error('Enter the backup passphrase first.');
    if (!(await confirm({ title: 'Restore this backup?', body: 'It replaces the identity and spaces on this device.', confirm: 'Restore', danger: true }))) return;
    await getBridge().backupImport(path, pass);
    window.location.reload();
    return 'Backup restored';
  });

  const reset = async () => {
    if (!(await confirm({ title: 'Delete all local data?', body: 'Removes your identity key, every space and every file on this device. Without a backup this cannot be undone.', confirm: 'Delete everything', danger: true, typed: 'DELETE' }))) return;
    try { await getBridge().appReset(); window.location.reload(); } catch (e) { fail(toast, e); }
  };
  return (
    <>
      <p className={f.note}>A backup holds your identity, spaces and keys, encrypted with a passphrase only you know. Lose the passphrase and the backup cannot be opened.</p>
      <div className={f.field}><label className={f.label} htmlFor="bk-pass">Passphrase (at least {MIN_PASS} characters)</label>
        <input id="bk-pass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></div>
      <div className={f.field}><label className={f.label} htmlFor="bk-again">Repeat passphrase</label>
        <input id="bk-again" type="password" className="input" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></div>
      {again && pass !== again && <p className={f.error}>The passphrases do not match.</p>}
      <Switch label="Include files and media" sub="Bigger backup, but photos and videos come back too." on={blobs} onChange={setBlobs} />
      <div className={f.actions}>
        <button type="button" className="btn btn-secondary" disabled={busy || !pass} onClick={importBackup}>Restore backup…</button>
        <button type="button" className="btn btn-primary" disabled={busy || !ok} onClick={exportBackup}>Export backup…</button>
      </div>
      <h3 style={{ fontSize: 18, margin: '18px 0 4px' }}>Delete all local data</h3>
      <div className={f.actions} style={{ justifyContent: 'flex-start' }}><button type="button" className={`btn btn-secondary ${f.danger}`} onClick={reset}>Delete all local data…</button></div>
    </>
  );
}

function Updates() {
  const toast = useToast();
  const [u, setU] = useState<UpdateInfo | null>(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const check = useCallback(() => { setMsg(''); getBridge().updateCheck().then(setU).catch((e) => setMsg(errorMessage(e))); }, []);
  useEffect(() => { getBridge().updateCheck().then(setU).catch((e) => setMsg(errorMessage(e))); }, []);
  const install = async () => {
    setBusy(true); setMsg('Downloading and installing. Hermod restarts when done.');
    try { await getBridge().updateInstall(); } catch (e) { setMsg(''); fail(toast, e); }
    setBusy(false);
  };
  return (
    <>
      <p className={f.note}>{u ? `You have version ${u.current}. ${u.available ? `Version ${u.version} is available.` : 'You are up to date.'}` : 'Checking…'}</p>
      {u?.available && u.notes && <pre className={f.mono} style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{u.notes}</pre>}
      {msg && <p role="status" className={f.note}>{msg}</p>}
      <div className={f.actions} style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={check}>Check again</button>
        {u?.available && <button type="button" className="btn btn-primary" disabled={busy} onClick={install}>Install and restart</button>}
      </div>
    </>
  );
}

function NetworkLink() {
  const toggle = useAppStore((s) => s.toggleDrawer); const closeModal = useAppStore((s) => s.closeModal);
  return (
    <>
      <p className={f.note}>Peers, relaying, bandwidth and how much you share are in the network panel.</p>
      <div className={f.actions} style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-primary" onClick={() => { closeModal(); toggle('net'); }}>Open network panel</button>
      </div>
    </>
  );
}

function Logs() {
  const toast = useToast();
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => { getBridge().logTail(LOG_LINES).then(setLines).catch((e) => { setLines([]); fail(toast, e); }); }, [toast]);
  const text = (lines ?? []).join('\n');
  return (
    <>
      <p className={f.note}>The last {LOG_LINES} lines of the local log. It never leaves this device.</p>
      <pre className={`${f.mono} ${f.scroll}`} tabIndex={0} aria-label="Log" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{lines === null ? 'Loading…' : text || 'The log is empty.'}</pre>
      <div className={f.actions}><button type="button" className="btn btn-secondary" disabled={!text} onClick={async () => toast((await copyText(text)) ? 'Copied' : 'Copy failed', undefined, undefined)}>Copy log</button></div>
    </>
  );
}

const KEY_MODES: ReadonlyArray<readonly [KeyMode, string, string]> = [
  ['file', COPY.keyModeFile, COPY.keyModeFileSub],
  ['keychain', COPY.keyModeKeychain, COPY.keyModeKeychainSub],
  ['passphrase', COPY.keyModePassphrase, COPY.keyModePassphraseSub],
];

function KeyStorage() {
  const toast = useToast(); const me = useAppStore((s) => s.me);
  const [mode, setMode] = useState<KeyMode>(me?.key_mode ?? 'file');
  const [pass, setPass] = useState(''); const [again, setAgain] = useState(''); const [busy, setBusy] = useState(false);
  if (!me) return null;
  const sealing = mode === 'passphrase';
  const ok = mode !== me.key_mode && (!sealing || (pass.length >= MIN_PASS && pass === again));
  const apply = async () => {
    setBusy(true);
    try {
      const next = await getBridge().identityProtect(mode, sealing ? pass : undefined);
      useAppStore.setState({ me: next }); setPass(''); setAgain('');
      toast(COPY.keyChanged);
    } catch (e) { fail(toast, e); }
    setBusy(false);
  };
  return (
    <fieldset className={f.field} style={{ border: 0, padding: 0 }}>
      <legend className={f.label}>{COPY.keyTitle}</legend>
      <p className={f.note}>{COPY.keyNote}</p>
      {KEY_MODES.map(([id, label, sub]) => (
        <label key={id} className={f.row} style={{ alignItems: 'flex-start', gap: 8 }}>
          <input type="radio" name="key-mode" checked={mode === id} onChange={() => setMode(id)} disabled={busy} />
          <span><strong>{label}</strong><br /><span className={f.note}>{sub}</span></span>
        </label>
      ))}
      {sealing && mode !== me.key_mode && (
        <>
          <p className={f.note}>{COPY.keyPassphraseWarn}</p>
          <div className={f.field}><label className={f.label} htmlFor="key-pass">Passphrase (at least {MIN_PASS} characters)</label>
            <input id="key-pass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></div>
          <div className={f.field}><label className={f.label} htmlFor="key-again">Repeat passphrase</label>
            <input id="key-again" type="password" className="input" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></div>
          {again && pass !== again && <p className={f.error}>{COPY.keyPassMismatch}</p>}
        </>
      )}
      <div className={f.actions} style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-primary" disabled={busy || !ok} onClick={apply}>{COPY.keyApply}</button>
      </div>
    </fieldset>
  );
}

function Identity(): ReactNode {
  const me = useAppStore((s) => s.me);
  if (!me) return <p className={f.note}>No identity loaded.</p>;
  return (
    <>
      <CopyField id="id-handle" label="Handle" value={me.handle} />
      <CopyField id="id-user" label="User id" value={me.user_id} />
      <p className={f.note}>Your user id is public to the spaces you join. The secret key never leaves this device.</p>
      <KeyStorage />
      <RecoveryPhrase />
    </>
  );
}
