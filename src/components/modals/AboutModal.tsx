'use client';
import { useEffect, useState } from 'react';
import { COPY } from '@/config/copy';
import { LICENSES_URL } from '@/config/app';
import pkg from '../../../package.json';
import { PRIVACY, TERMS } from '@/lib/legal';
import { useAppStore } from '@/state/store';
import { Markdown } from '@/components/gate/Markdown';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';

interface Pkg { name: string; version: string; license: string }
interface Licenses { cargo: Pkg[]; npm: Pkg[] }

function ThirdParty() {
  const [l, setL] = useState<Licenses | null | undefined>(undefined);
  useEffect(() => { fetch(LICENSES_URL).then((r) => (r.ok ? (r.json() as Promise<Licenses>) : null)).then(setL).catch(() => setL(null)); }, []);
  if (l === undefined) return null;
  if (!l) return <p className={f.note}>{COPY.licensesUnavailable}</p>;
  return (
    <details>
      <summary>{COPY.licensesTitle}: {COPY.licensesSummary(l.cargo.length, l.npm.length)}</summary>
      <div className={f.scroll} style={{ maxHeight: '40dvh' }}>
        <ul aria-label={COPY.licensesTitle}>{[...l.npm, ...l.cargo].map((p) => <li key={`${p.name}@${p.version}`}>{p.name} {p.version}: {p.license}</li>)}</ul>
      </div>
    </details>
  );
}

/** Version, legal texts and third-party notices (W-004). */
export function AboutModal() {
  const close = useAppStore((s) => s.closeModal);
  const version = pkg.version;
  const [doc, setDoc] = useState<typeof TERMS | null>(null);
  if (doc) {
    return (
      <Dialog title={doc.title} kicker={`Version ${doc.version}`} onClose={() => setDoc(null)} wide>
        <div className={f.scroll} style={{ maxHeight: '60dvh' }}><Markdown source={doc.body} /></div>
        <div className={f.actions}><button type="button" className="btn btn-secondary" onClick={() => setDoc(null)}>Back</button></div>
      </Dialog>
    );
  }
  return (
    <Dialog title="About Hermod" kicker="Hermod" onClose={close}>
      <p className={f.note}>Version {version}. A peer-to-peer messenger for everything you make together. There is no central server and no telemetry.</p>
      <div className={f.row}>
        <button type="button" className="btn btn-secondary" onClick={() => setDoc(TERMS)}>Terms of Use</button>
        <button type="button" className="btn btn-secondary" onClick={() => setDoc(PRIVACY)}>Privacy notice</button>
      </div>
      <p className={f.note}>
        Hermod is open source under the Apache-2.0 license. It includes open-source components (Tauri, libp2p, React, Next.js, Three.js, SQLite and others),
        each under its own license. The full license texts ship with the application bundle and in the source repository.
      </p>
      <ThirdParty />
    </Dialog>
  );
}
