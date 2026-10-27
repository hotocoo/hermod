'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { STORAGE_KEYS } from '@/config/app';
import { COPY } from '@/config/copy';
import { FRAME_LIMIT } from '@/config/scene';
import { savedFrameCap } from '@/scene/frameLimit';
import { LOCALES, setLocale, useLocale } from '@/i18n';
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
import { deviceKey, type DeviceSlot } from '@/lib/media/devicePrefs';
import { getLocalMapStyle, resolveMapStyle, setLocalMapStyle, type MapStyleChoice } from '@/scene/styles/pref';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import { Switch } from '@/components/ui/Switch';
import f from '@/components/ui/form.module.css';
import { CopyField } from './CopyField';
import { RecoveryPhrase } from './RecoveryPhrase';
import { LinkedDevices } from './LinkedDevices';

const TABS = ['notifications', 'appearance', 'devices', 'storage', 'backup', 'updates', 'network', 'logs', 'identity'] as const;
type TabId = (typeof TABS)[number];
const C = () => COPY.ui.settingsModals.app;
const SCALES = [100, 115, 130, 150, 200];
const MIN_PASS = 8;
const LOG_LINES = 1000;

const useToast = () => useAppStore((s) => s.showToast);
const fail = (toast: ReturnType<typeof useToast>, e: unknown) => toast(errorMessage(e), undefined, 'error');

export function AppSettingsModal({ tab }: { tab?: string }) {
  const close = useAppStore((s) => s.closeModal);
  const [cur, setCur] = useState<TabId>(TABS.some((id) => id === tab) ? (tab as TabId) : 'notifications');
  return (
    <Dialog title={C().title} kicker={C().kicker} onClose={close} wide>
      <div role="tablist" aria-label={C().tabsLabel} className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={cur === id} className="seg-opt" onClick={() => setCur(id)}
            style={cur === id ? { color: 'var(--color-accent-700)', boxShadow: 'inset 0 0 0 1px var(--color-accent)' } : undefined}>{C().tab[id]}</button>
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
  const N = C().notif;
  const toast = useToast();
  const spaces = useAppStore((s) => s.spaces);
  const [n, setN] = useState<NotifySettings | null>(null);
  useEffect(() => { getBridge().notifySettingsGet().then(setN).catch((e) => fail(toast, e)); }, [toast]);
  if (!n) return <p className={f.note}>{C().loading}</p>;
  const save = async (patch: Partial<NotifySettings>) => {
    try { const v = await getBridge().notifySettingsSet(patch); setN(v); setNotifySettings(v); } catch (e) { fail(toast, e); }
  };
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const sch = n.dnd_schedule;
  return (
    <>
      <Switch label={N.desktop} sub={N.desktopSub} on={n.enabled} onChange={(on) => save({ enabled: on })} />
      <Switch label={N.dm} on={n.dm} disabled={!n.enabled} onChange={(on) => save({ dm: on })} />
      <Switch label={N.mentions} on={n.mention} disabled={!n.enabled} onChange={(on) => save({ mention: on })} />
      <Switch label={N.meetings} on={n.meeting} disabled={!n.enabled} onChange={(on) => save({ meeting: on })} />
      <Switch label={N.reminders} on={n.reminder} disabled={!n.enabled} onChange={(on) => save({ reminder: on })} />
      <div className={f.row} style={{ marginTop: 12 }}>
        <span>{N.dnd}</span>
        <button type="button" className="btn btn-secondary" onClick={() => save({ dnd_until: Date.now() + 3600_000 })}>{N.dnd1h}</button>
        <button type="button" className="btn btn-secondary" onClick={() => save({ dnd_until: Date.now() + 8 * 3600_000 })}>{N.dnd8h}</button>
        {n.dnd_until && n.dnd_until > wallMs() && <button type="button" className="btn btn-secondary" onClick={() => save({ dnd_until: null })}>{N.dndOff(new Date(n.dnd_until).toLocaleTimeString())}</button>}
      </div>
      <Switch label={N.quiet} on={sch.enabled} onChange={(on) => save({ dnd_schedule: { ...sch, enabled: on } })} />
      {sch.enabled && (
        <div className={f.row}>
          <label className={f.label} htmlFor="dnd-from">{N.from}</label>
          <select id="dnd-from" className="input" style={{ width: 90 }} value={sch.from_hour} onChange={(e) => save({ dnd_schedule: { ...sch, from_hour: Number(e.target.value) } })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
          <label className={f.label} htmlFor="dnd-to">{N.to}</label>
          <select id="dnd-to" className="input" style={{ width: 90 }} value={sch.to_hour} onChange={(e) => save({ dnd_schedule: { ...sch, to_hour: Number(e.target.value) } })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </div>
      )}
      <h3 style={{ fontSize: 18, margin: '14px 0 2px' }}>{N.mutedSpaces}</h3>
      {spaces.map((sp) => (
        <Switch key={sp.id} label={sp.name} sub={N.mutedSpaceSub} on={n.muted_spaces.includes(sp.id)} onChange={() => save({ muted_spaces: toggleIn(n.muted_spaces, sp.id) })} />
      ))}
      {n.muted_channels.length > 0 && (
        <>
          <h3 style={{ fontSize: 18, margin: '14px 0 2px' }}>{N.mutedChannels}</h3>
          {n.muted_channels.map((c) => <Switch key={c} label={c} on onChange={() => save({ muted_channels: n.muted_channels.filter((x) => x !== c) })} />)}
        </>
      )}
    </>
  );
}

function Appearance() {
  const s = useAppStore();
  const locale = useLocale();
  const [scale, setScale] = useState(() => Number(readString(STORAGE_KEYS.textScale)) || 100);
  const [cap, setCap] = useState<string>(() => savedFrameCap());
  const setFrameCap = (id: string) => { setCap(id); writeString(STORAGE_KEYS.fpsCap, id); getTown()?.setFrameCap(id); };
  const set = (p: number) => { setScale(p); writeString(STORAGE_KEYS.textScale, String(p)); applyTextScale(p); };
  return (
    <>
      <Switch label={COPY.ui.settingsModals.appSettingsModalText.darkTheme} on={s.theme === 'dark'} onChange={() => s.toggleTheme()} />
      <Switch label={COPY.ui.settingsModals.appSettingsModalText.paperGrain} on={s.grain} onChange={() => s.toggleSetting('grain')} />
      <Switch label={COPY.ui.settingsModals.appSettingsModalText.themeFollowsTheSky} on={s.skyTheme} onChange={() => s.toggleSetting('skyTheme')} />
      <div className={f.field} style={{ marginTop: 12 }}>
        <label className={f.label} htmlFor="motion-mode">{COPY.ui.settingsModals.appSettingsModalText.reducedMotion}</label>
        <select id="motion-mode" className="input" value={s.motion} onChange={(e) => s.setMotion(e.target.value as MotionMode)}>
          <option value="system">{COPY.ui.settingsModals.appSettingsModalText.followTheSystem}</option>
          <option value="reduce">{COPY.ui.settingsModals.appSettingsModalText.alwaysReduce}</option>
          <option value="full">{COPY.ui.settingsModals.appSettingsModalText.alwaysFull}</option>
        </select>
      </div>
      <div className={f.field} style={{ marginTop: 12 }}>
        <label className={f.label} htmlFor="txt-scale">{COPY.ui.settingsModals.appSettingsModalText.textSize}</label>
        <select id="txt-scale" className="input" value={scale} onChange={(e) => set(Number(e.target.value))}>
          {SCALES.map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
      </div>
      <div className={f.field} style={{ marginTop: 12 }}>
        <label className={f.label} htmlFor="fps-cap">{COPY.frameRate}</label>
        <select id="fps-cap" className="input" value={cap} onChange={(e) => setFrameCap(e.target.value)} aria-describedby="fps-cap-note">
          {FRAME_LIMIT.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <span id="fps-cap-note" className={f.note}>{FRAME_LIMIT.options.find((o) => o.id === cap)?.note}</span>
      </div>
      <div className={f.field} style={{ marginTop: 12 }}>
        <label className={f.label} htmlFor="ui-locale">{COPY.language}</label>
        <select id="ui-locale" className="input" value={locale} onChange={(e) => setLocale(e.target.value)}>
          {LOCALES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </div>
      <MapStyle />
    </>
  );
}

const MAP_CHOICES: { id: MapStyleChoice; label: string; blurb: string }[] = [
  { id: 'village', get label() { return COPY.ui.settingsModals.appMore.mapVillage; }, get blurb() { return COPY.ui.settingsModals.appMore.mapVillageBlurb; } },
  { id: 'sanctuary', get label() { return COPY.ui.settingsModals.appMore.mapSanctuary; }, get blurb() { return COPY.ui.settingsModals.appMore.mapSanctuaryBlurb; } },
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
  const setDefault = async () => { if (await appendEvent(get, space, { t: 'space.update', map_style: shown })) get().showToast(COPY.ui.settingsModals.appMore.spaceDefaultSaved); };
  const def = resolveMapStyle(sp.mapStyle, null);
  const opts = [{ id: 'default' as const, label: COPY.ui.settingsModals.appMore.spaceDefaultOpt(MAP_CHOICES.find((c) => c.id === def)?.label ?? ''), blurb: COPY.ui.settingsModals.appMore.followAdmins }, ...MAP_CHOICES];
  return (
    <fieldset className={f.field} style={{ marginTop: 16, border: 0, padding: 0 }}>
      <legend className={f.label}>{COPY.ui.settingsModals.appSettingsModalText.mapStyleOnThisDevice}</legend>
      {opts.map((o) => (
        <label key={o.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', cursor: 'pointer' }}>
          <input type="radio" name="map-style" value={o.id} checked={(local ?? 'default') === o.id} onChange={() => pick(o.id)} style={{ marginTop: 4 }} />
          <span><strong>{o.label}</strong><br /><span className={f.note}>{o.blurb}</span></span>
        </label>
      ))}
      {admin && <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start', marginTop: 8 }} disabled={sp.mapStyle === shown} onClick={setDefault}>{COPY.ui.settingsModals.appMore.setDefault(MAP_CHOICES.find((c) => c.id === shown)?.label ?? '')}</button>}
    </fieldset>
  );
}

function Devices() {
  const [list, setList] = useState<MediaDeviceInfo[] | null>(null);
  const [err, setErr] = useState('');
  const [, bump] = useState(0);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(setList).catch((e) => setErr(errorMessage(e)));
  }, []);
  const shownErr = err || (navigator.mediaDevices ? '' : 'This webview exposes no media devices.');
  const pick = (kind: MediaDeviceKind, label: string, key: DeviceSlot) => {
    const opts = (list ?? []).filter((d) => d.kind === kind);
    return (
      <div className={f.field} key={key}>
        <label className={f.label} htmlFor={`dev-${key}`}>{label}</label>
        <select id={`dev-${key}`} className="input" value={readString(deviceKey(key)) ?? ''} onChange={(e) => { writeString(deviceKey(key), e.target.value); bump((x) => x + 1); }}>
          <option value="">{COPY.ui.settingsModals.appSettingsModalText.systemDefault}</option>
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
      <p className={f.note}>{COPY.ui.settingsModals.appSettingsModalText.deviceNamesAppearAfterYou}</p>
    </>
  );
}

function Storage() {
  const toast = useToast(); const confirm = useAppStore((s) => s.confirmAction);
  const [u, setU] = useState<StorageUsage | null>(null);
  const load = useCallback(() => { getBridge().storageUsage().then(setU).catch((e) => fail(toast, e)); }, [toast]);
  useEffect(load, [load]);
  if (!u) return <p className={f.note}>{C().loading}</p>;
  const clear = async () => {
    if (!(await confirm({ title: COPY.ui.settingsModals.appMore.clearTitle, body: COPY.ui.settingsModals.appMore.clearBody, confirm: COPY.ui.settingsModals.appMore.clearConfirm }))) return;
    try { const r = await getBridge().storageClearCache(); toast(COPY.ui.settingsModals.appMore.freed(humanSize(r.freed_bytes))); load(); } catch (e) { fail(toast, e); }
  };
  return (
    <>
      <p className={f.note}>{COPY.ui.settingsModals.appMore.totals(humanSize(u.total_bytes), humanSize(u.cache_for_others_bytes))}</p>
      {u.per_space.length > 0 && (
        <table className={f.table}>
          <thead><tr><th scope="col">{COPY.ui.settingsModals.appSettingsModalText.space}</th><th scope="col">{COPY.ui.settingsModals.appSettingsModalText.size}</th></tr></thead>
          <tbody>{u.per_space.map((p) => <tr key={p.space_id}><td>{p.name}</td><td>{humanSize(p.bytes)}</td></tr>)}</tbody>
        </table>
      )}
      <div className={f.actions}><button type="button" className="btn btn-secondary" onClick={clear}>{COPY.ui.settingsModals.appSettingsModalText.clearCache}</button></div>
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
    if (!isTauri()) { const v = await ask({ title: COPY.ui.settingsModals.appMore.backupTitle, submit: COPY.ui.settingsModals.appMore.exportSubmit, fields: [{ key: 'p', label: COPY.ui.settingsModals.appMore.filePath, initial: name, required: true }] }); if (!v) return; typed = v.p.trim(); }
    const path = await getBridge().backupExport(name, pass, blobs, typed);
    if (!path) return;
    return COPY.ui.settingsModals.appMore.savedTo(path);
  });

  const importBackup = () => run(async () => {
    let path: string | undefined;
    if (isTauri()) path = (await getBridge().pickFiles({ accept: ['hermodbak'] }))?.[0];
    else path = (await ask({ title: COPY.ui.settingsModals.appMore.restoreFrom, submit: COPY.ui.settingsModals.appMore.restore, fields: [{ key: 'p', label: COPY.ui.settingsModals.appMore.filePath, required: true }] }))?.p.trim();
    if (!path) return;
    if (!pass) throw new Error(COPY.ui.settingsModals.appMore.passFirst);
    if (!(await confirm({ title: COPY.ui.settingsModals.appMore.restoreTitle, body: COPY.ui.settingsModals.appMore.restoreBody, confirm: COPY.ui.settingsModals.appMore.restore, danger: true }))) return;
    await getBridge().backupImport(path, pass);
    window.location.reload();
    return COPY.ui.settingsModals.appMore.restored;
  });

  const reset = async () => {
    if (!(await confirm({ title: COPY.ui.settingsModals.appMore.resetTitle, body: COPY.ui.settingsModals.appMore.resetBody, confirm: COPY.ui.settingsModals.appMore.resetConfirm, danger: true, typed: 'DELETE' }))) return;
    try { await getBridge().appReset(); window.location.reload(); } catch (e) { fail(toast, e); }
  };
  return (
    <>
      <p className={f.note}>{COPY.ui.settingsModals.appSettingsModalText.aBackupHoldsYourIdentity}</p>
      <div className={f.field}><label className={f.label} htmlFor="bk-pass">{COPY.ui.settingsModals.appMore.passphraseMin(MIN_PASS)}</label>
        <input id="bk-pass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></div>
      <div className={f.field}><label className={f.label} htmlFor="bk-again">{COPY.passphraseRepeat}</label>
        <input id="bk-again" type="password" className="input" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></div>
      {again && pass !== again && <p className={f.error}>{COPY.ui.settingsModals.appSettingsModalText.thePassphrasesDoNotMatch}</p>}
      <Switch label={COPY.ui.settingsModals.appSettingsModalText.includeFilesAndMedia} sub={COPY.ui.settingsModals.appSettingsModalText.biggerBackupButPhotosAnd} on={blobs} onChange={setBlobs} />
      <div className={f.actions}>
        <button type="button" className="btn btn-secondary" disabled={busy || !pass} onClick={importBackup}>{COPY.ui.settingsModals.appSettingsModalText.restoreBackup}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !ok} onClick={exportBackup}>{COPY.ui.settingsModals.appSettingsModalText.exportBackup}</button>
      </div>
      <h3 style={{ fontSize: 18, margin: '18px 0 4px' }}>{COPY.ui.settingsModals.appSettingsModalText.deleteAllLocalData}</h3>
      <div className={f.actions} style={{ justifyContent: 'flex-start' }}><button type="button" className={`btn btn-secondary ${f.danger}`} onClick={reset}>{COPY.ui.settingsModals.appSettingsModalText.deleteAllLocalData2}</button></div>
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
      <p className={f.note}>{u ? COPY.ui.settingsModals.appMore.updateCurrent(u.current, u.available ? COPY.ui.settingsModals.appMore.updateAvailable(u.version ?? '') : COPY.ui.settingsModals.appMore.upToDate) : COPY.ui.settingsModals.appSettingsModalText.checking}</p>
      {u?.available && u.notes && <pre className={f.mono} style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{u.notes}</pre>}
      {msg && <p role="status" className={f.note}>{msg}</p>}
      <div className={f.actions} style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={check}>{COPY.ui.settingsModals.appSettingsModalText.checkAgain}</button>
        {u?.available && <button type="button" className="btn btn-primary" disabled={busy} onClick={install}>{COPY.ui.settingsModals.appSettingsModalText.installAndRestart}</button>}
      </div>
    </>
  );
}

function NetworkLink() {
  const toggle = useAppStore((s) => s.toggleDrawer); const closeModal = useAppStore((s) => s.closeModal);
  return (
    <>
      <p className={f.note}>{COPY.ui.settingsModals.appSettingsModalText.peersRelayingBandwidthAndHow}</p>
      <div className={f.actions} style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-primary" onClick={() => { closeModal(); toggle('net'); }}>{COPY.ui.settingsModals.appSettingsModalText.openNetworkPanel}</button>
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
      <p className={f.note}>{COPY.ui.settingsModals.appMore.logNote(LOG_LINES)}</p>
      <pre className={`${f.mono} ${f.scroll}`} tabIndex={0} aria-label={COPY.ui.settingsModals.appSettingsModalText.log} style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{lines === null ? COPY.ui.settingsModals.appSettingsModalText.loading : text || COPY.ui.settingsModals.appSettingsModalText.theLogIsEmpty}</pre>
      <div className={f.actions}><button type="button" className="btn btn-secondary" disabled={!text} onClick={async () => toast((await copyText(text)) ? 'Copied' : 'Copy failed', undefined, undefined)}>{COPY.ui.settingsModals.appSettingsModalText.copyLog}</button></div>
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
          <div className={f.field}><label className={f.label} htmlFor="key-pass">{COPY.ui.settingsModals.appMore.passphraseMin(MIN_PASS)}</label>
            <input id="key-pass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></div>
          <div className={f.field}><label className={f.label} htmlFor="key-again">{COPY.passphraseRepeat}</label>
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
  if (!me) return <p className={f.note}>{COPY.ui.settingsModals.appSettingsModalText.noIdentityLoaded}</p>;
  return (
    <>
      <CopyField id="id-handle" label={COPY.ui.settingsModals.appSettingsModalText.handle} value={me.handle} />
      <CopyField id="id-user" label={COPY.ui.settingsModals.appSettingsModalText.userId} value={me.user_id} />
      <p className={f.note}>{COPY.ui.settingsModals.appSettingsModalText.yourUserIdIsPublic}</p>
      <KeyStorage />
      <RecoveryPhrase />
      <LinkedDevices />
    </>
  );
}
