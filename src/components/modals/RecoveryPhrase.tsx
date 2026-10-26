'use client';
import { useEffect, useState } from 'react';
import { COPY } from '@/config/copy';
import { errorMessage, getBridge } from '@/lib/bridge';
import { useAppStore } from '@/state/store';
import f from '@/components/ui/form.module.css';

/** Settings > Identity: show the 24 word recovery phrase after an explicit warning. The words live only in this component's state and are dropped on hide or unmount. */
export function RecoveryPhrase() {
  const confirm = useAppStore((s) => s.confirmAction);
  const toast = useAppStore((s) => s.showToast);
  const [words, setWords] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => setWords(null), []);

  const show = async () => {
    if (!(await confirm({ title: COPY.phraseWarnTitle, body: COPY.phraseWarnBody, confirm: COPY.phraseWarnConfirm, danger: true }))) return;
    setBusy(true);
    try { setWords((await getBridge().identityPhrase(true)).split(/\s+/).filter(Boolean)); }
    catch (e) { toast(errorMessage(e), undefined, 'error'); }
    setBusy(false);
  };
  return (
    <fieldset className={f.field} style={{ border: 0, padding: 0 }}>
      <legend className={f.label}>{COPY.phraseTitle}</legend>
      <p className={f.note}>{COPY.phraseNote}</p>
      {words && (
        <ol aria-label={COPY.phraseWordsLabel} className={f.mono} style={{ columns: 3, margin: 0, paddingLeft: 24 }}>
          {words.map((w, i) => <li key={i}>{w}</li>)}
        </ol>
      )}
      <div className={f.actions} style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={words ? () => setWords(null) : show}>{words ? COPY.phraseHide : COPY.phraseShow}</button>
      </div>
    </fieldset>
  );
}
