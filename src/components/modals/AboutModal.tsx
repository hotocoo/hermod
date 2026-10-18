'use client';
import { useEffect, useState } from 'react';
import { getBridge } from '@/lib/bridge';
import { PRIVACY, TERMS } from '@/lib/legal';
import { useAppStore } from '@/state/store';
import { Markdown } from '@/components/gate/Markdown';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';

/** Version, legal texts and third-party notices (W-004). */
export function AboutModal() {
  const close = useAppStore((s) => s.closeModal);
  const [version, setVersion] = useState('');
  const [doc, setDoc] = useState<typeof TERMS | null>(null);
  useEffect(() => { getBridge().updateCheck().then((u) => setVersion(u.current)).catch(() => setVersion('')); }, []);
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
      <p className={f.note}>{version ? `Version ${version}. ` : ''}A peer-to-peer messenger for everything you make together. There is no central server and no telemetry.</p>
      <div className={f.row}>
        <button type="button" className="btn btn-secondary" onClick={() => setDoc(TERMS)}>Terms of Use</button>
        <button type="button" className="btn btn-secondary" onClick={() => setDoc(PRIVACY)}>Privacy notice</button>
      </div>
      <p className={f.note}>
        Hermod is open source under the Apache-2.0 license. It includes open-source components (Tauri, libp2p, React, Next.js, Three.js, SQLite and others),
        each under its own license. The full license texts ship with the application bundle and in the source repository.
      </p>
    </Dialog>
  );
}
