'use client';
import { useCallback, useEffect, useState } from 'react';
import { COPY } from '@/config/copy';
import { errorMessage, getBridge, type DeviceInfo, type DeviceLink } from '@/lib/bridge';
import { useAppStore } from '@/state/store';
import f from '@/components/ui/form.module.css';
import { CopyField } from './CopyField';
import { QrSvg } from './QrSvg';

const C = COPY.linkedDevices;
const SECS_PER_MIN = 60;
/** Leading characters of a device key shown in the list. */
const KEY_PREVIEW = 8;

/** Settings, Identity tab: the devices of this identity, linking a new one, and accepting a code on a fresh one. */
export function LinkedDevices() {
  const toast = useAppStore((s) => s.showToast);
  const confirm = useAppStore((s) => s.confirmAction);
  const [rows, setRows] = useState<DeviceInfo[] | null>(null);
  const [link, setLink] = useState<DeviceLink | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const fail = useCallback((e: unknown) => toast(errorMessage(e), undefined, 'error'), [toast]);
  const load = useCallback(() => { getBridge().deviceList().then(setRows).catch(fail); }, [fail]);
  useEffect(load, [load]);
  // The first row is the first device; only it may link or revoke.
  const isFirst = rows?.[0]?.this_device ?? false;

  const start = async () => {
    setBusy(true);
    try { setLink(await getBridge().deviceLinkStart()); load(); } catch (e) { fail(e); }
    setBusy(false);
  };
  const revoke = async (d: DeviceInfo) => {
    if (!(await confirm({ title: C.revokeTitle, body: C.revokeBody, confirm: C.revoke, danger: true }))) return;
    try { await getBridge().deviceRevoke(d.device_pub); toast(C.revoked_toast); load(); } catch (e) { fail(e); }
  };
  const accept = async () => {
    if (!(await confirm({ title: C.acceptConfirmTitle, body: C.acceptConfirmBody, confirm: C.acceptConfirm, danger: true }))) return;
    setBusy(true);
    try { await getBridge().deviceLinkAccept(code.trim()); window.location.reload(); } catch (e) { fail(e); setBusy(false); }
  };

  return (
    <section aria-labelledby="devices-h">
      <h3 id="devices-h" style={{ fontSize: 18, margin: '14px 0 2px' }}>{C.heading}</h3>
      <p className={f.note}>{C.intro}</p>
      {rows && (
        <ul aria-label={C.heading} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((d, i) => (
            <li key={d.device_pub} className={f.row} style={{ justifyContent: 'space-between', padding: '4px 0' }}>
              <span>
                <strong>{i === 0 ? C.first : C.linked}</strong>{' '}
                <code>{d.device_pub.slice(0, KEY_PREVIEW)}</code>
                {d.this_device && ` (${C.thisDevice})`}
                {d.revoked && ` (${C.revoked})`}
                {d.added_at > 0 && <span className={f.note}>{`, ${C.added(new Date(d.added_at).toLocaleDateString())}`}</span>}
              </span>
              {isFirst && i > 0 && !d.revoked && (
                <button type="button" className="btn btn-secondary" aria-label={C.revokeLabel(d.device_pub.slice(0, KEY_PREVIEW))} onClick={() => revoke(d)}>{C.revoke}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && !isFirst && <p className={f.note}>{C.firstOnly}</p>}
      {isFirst && (
        <div className={f.actions} style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={start}>{C.linkStart}</button>
          {link && <button type="button" className="btn btn-secondary" onClick={() => setLink(null)}>{C.hide}</button>}
        </div>
      )}
      {link && (
        <div role="region" aria-label={C.codeHeading}>
          <p className={f.note}>{C.codeNote(Math.round(link.expires_in / SECS_PER_MIN))}</p>
          <QrSvg text={link.code} label={C.codeQr} />
          <CopyField id="device-link-code" label={C.codeField} value={link.code} />
        </div>
      )}
      <h3 style={{ fontSize: 18, margin: '14px 0 2px' }}>{C.acceptHeading}</h3>
      <p className={f.note}>{C.acceptNote}</p>
      <div className={f.field}>
        <label className={f.label} htmlFor="device-accept-code">{C.acceptField}</label>
        <input id="device-accept-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <div className={f.actions} style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-secondary" disabled={busy || !code.trim()} onClick={accept}>{C.acceptSubmit}</button>
      </div>
    </section>
  );
}
