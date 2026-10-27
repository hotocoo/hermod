'use client';
import { useState } from 'react';
import { COPY } from '@/config/copy';
import { PRIVACY, TERMS } from '@/lib/legal';
import { useAppStore } from '@/state/store';
import { Markdown } from './Markdown';
import s from './screens.module.css';

const DOCS = [{ id: 'terms', doc: TERMS }, { id: 'privacy', doc: PRIVACY }] as const;

/** First launch (and every Terms version change): read, accept, and separately consent to resource sharing. */
export function TermsGate() {
  const c = COPY.ui.shell.gate.terms;
  const accept =useAppStore((x) => x.acceptLegal);
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
        <div className={s.kicker}>{c.kicker}</div>
        <h1 id="tg-title" className={s.title}>{c.title}</h1>
        <p className={s.lead}>{c.lead}</p>
      </div>
      <div role="tablist" aria-label={c.tablist} className={s.tabs}>
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
          <span>{c.accept}</span>
        </label>
        <div>
          <p className={s.note}><strong>{c.sharingRequired}</strong>{c.sharingBody}</p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <caption className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{c.tableCaption}</caption>
              <thead><tr><th scope="col">{c.colUses}</th><th scope="col">{c.colDefault}</th><th scope="col">{c.colMax}</th></tr></thead>
              <tbody>
                <tr><td>{c.rowCircuits}</td><td>8</td><td>32</td></tr>
                <tr><td>{c.rowSpeed}</td><td>{c.speedDefault}</td><td>{c.speedMax}</td></tr>
                <tr><td>{c.rowStorage}</td><td>{c.storageDefault}</td><td>{c.storageMax}</td></tr>
                <tr><td>{c.rowConnections}</td><td>64</td><td>256</td></tr>
              </tbody>
            </table>
          </div>
          <p className={s.note}>{c.sharingNote}</p>
        </div>
        <label className={s.check}>
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span>{c.agreeShare}</span>
        </label>
      </div>
      <div className={s.actions}>
        <button type="button" className="btn btn-secondary" onClick={decline}>{c.decline}</button>
        <button type="button" className="btn btn-primary" disabled={!terms || !share || busy} onClick={go}>{c.continue}</button>
      </div>
    </main>
  );
}
