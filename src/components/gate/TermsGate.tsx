'use client';
import { useState } from 'react';
import { PRIVACY, TERMS } from '@/lib/legal';
import { useAppStore } from '@/state/store';
import { Markdown } from './Markdown';
import s from './screens.module.css';

const DOCS = [{ id: 'terms', doc: TERMS }, { id: 'privacy', doc: PRIVACY }] as const;

/** First launch (and every Terms version change): read, accept, and separately consent to resource sharing. */
export function TermsGate() {
  const accept = useAppStore((x) => x.acceptLegal);
  const decline = useAppStore((x) => x.declineLegal);
  const [tab, setTab] = useState<'terms' | 'privacy'>('terms');
  const [terms, setTerms] = useState(false);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = DOCS.find((d) => d.id === tab)!.doc;
  const go = async () => { setBusy(true); await accept(true); setBusy(false); };

  return (
    <main className={s.screen} aria-labelledby="tg-title">
      <div>
        <div className={s.kicker}>Before you start</div>
        <h1 id="tg-title" className={s.title}>Terms, privacy and sharing</h1>
        <p className={s.lead}>Hermod has no company server. Your install is also a small peer that helps other people connect. Please read both texts, then agree below.</p>
      </div>
      <div role="tablist" aria-label="Legal texts" className={s.tabs}>
        {DOCS.map((d) => (
          <button key={d.id} type="button" role="tab" id={`tg-tab-${d.id}`} aria-selected={tab === d.id} aria-controls="tg-panel" className={s.tab} onClick={() => setTab(d.id)}>
            {d.doc.title || d.id} <span className={s.note}>{d.doc.version}</span>
          </button>
        ))}
      </div>
      <div id="tg-panel" role="tabpanel" aria-labelledby={`tg-tab-${tab}`} tabIndex={0} className={s.doc}><Markdown source={current.body} /></div>
      <div className={s.consent}>
        <label className={s.check}>
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>I have read and accept the Terms of Use and the Privacy Notice.</span>
        </label>
        <div>
          <p className={s.note}><strong>Resource sharing is required.</strong> Hermod cannot start its network node without it. Your computer will help other people connect, within these limits (you can lower them later in Network settings, never raise them past the maximum):</p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <caption className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Default and maximum resource limits</caption>
              <thead><tr><th scope="col">What it uses</th><th scope="col">Default</th><th scope="col">Maximum</th></tr></thead>
              <tbody>
                <tr><td>Relay circuits (people connecting through you)</td><td>8</td><td>32</td></tr>
                <tr><td>Relay speed</td><td>256 KiB/s</td><td>2 MiB/s</td></tr>
                <tr><td>Encrypted data kept for others</td><td>512 MiB</td><td>4 GiB</td></tr>
                <tr><td>Connections</td><td>64</td><td>256</td></tr>
              </tbody>
            </table>
          </div>
          <p className={s.note}>Relaying pauses while your computer is on battery. It uses your internet connection and may count against your data plan. What you relay is encrypted: you cannot read it and neither can the network.</p>
        </div>
        <label className={s.check}>
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span>I agree to share these resources as described.</span>
        </label>
      </div>
      <div className={s.actions}>
        <button type="button" className="btn btn-secondary" onClick={decline}>Decline</button>
        <button type="button" className="btn btn-primary" disabled={!terms || !share || busy} onClick={go}>Continue</button>
      </div>
    </main>
  );
}
