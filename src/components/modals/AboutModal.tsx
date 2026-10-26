'use client';
import { useEffect, useState } from 'react';
import { COPY } from '@/config/copy';
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
  const C = COPY.ui.modals.about;
  if (doc) {
    return (
      <Dialog title={doc.title} kicker={C.version(doc.version)} onClose={() => setDoc(null)} wide>
        <div className={f.scroll} style={{ maxHeight: '60dvh' }}><Markdown source={doc.body} /></div>
        <div className={f.actions}><button type="button" className="btn btn-secondary" onClick={() => setDoc(null)}>{C.back}</button></div>
      </Dialog>
    );
  }
  return (
    <Dialog title={C.title} kicker="Hermod" onClose={close}>
      <p className={f.note}>{version ? C.versionLead(version) : ''}{C.blurb}</p>
      <div className={f.row}>
        <button type="button" className="btn btn-secondary" onClick={() => setDoc(TERMS)}>{C.terms}</button>
        <button type="button" className="btn btn-secondary" onClick={() => setDoc(PRIVACY)}>{C.privacy}</button>
      </div>
      <p className={f.note}>{C.license}</p>
    </Dialog>
  );
}
