'use client';
import { useViewModel } from '@/state/useViewModel';
import { COPY } from '@/config/copy';
import { Ledger } from './skein/Ledger';
import { Lines } from './skein/Lines';
import { Snapshot } from './skein/Snapshot';
import s from './skein/skein.module.css';

/** Skein (version history) section: lines, ledger and the selected snapshot; empty state with the first-snapshot action. */
export function SkeinSection() {
  const vm = useViewModel();
  if (!vm.ready) return null;
  const { skein } = vm;
  if (!skein) {
    return (
      <div className={s.fresh}>
        <div>
          <h3 className={s.title}>{COPY.ui.panel.sections.skeinEmpty}</h3>
          <p className={s.freshLine}>{vm.freshLine}</p>
          <button type="button" className={s.headBtn} onClick={vm.newSnapshot}>{vm.icS.plus} {COPY.ui.panel.sections.skeinTakeSnapshot}</button>
        </div>
      </div>
    );
  }
  return (
    <div className={s.root}>
      <header className={s.head}>
        <div className={s.headMain}>
          <div className={s.kicker}>{COPY.ui.panel.sections.skeinKicker}</div>
          <h2 className={s.title}>{skein.repo}</h2>
          <p className={s.blurb}>{skein.blurb}</p>
        </div>
        <button type="button" className={s.headBtn} onClick={skein.newLine}>{vm.icS.line} {COPY.ui.panel.sections.skeinNew(skein.T.line)}</button>
        <button type="button" className={s.headBtn} onClick={skein.newSnapshot}>{vm.icS.plus} {COPY.ui.panel.sections.skeinTake(skein.T.snapshot)}</button>
        <div role="group" aria-label={COPY.ui.panel.sections.skeinVocab} className={s.vocab}>
          <button type="button" className={s.vocabBtn} onClick={skein.setPlain} style={{ boxShadow: `inset 0 0 0 1px ${skein.plainBd}`, color: skein.plainFg }}>{COPY.ui.panel.sections.skeinPlain}</button>
          <button type="button" className={s.vocabBtn} onClick={skein.setExpert} style={{ boxShadow: `inset 0 0 0 1px ${skein.expertBd}`, color: skein.expertFg }}>{COPY.ui.panel.sections.skeinExpert}</button>
        </div>
      </header>
      <div className={s.body}>
        <div className={s.left}>
          <Lines label={skein.T.lines} lines={skein.lines} weavable={skein.weavable} weaveLabel={skein.T.weave} icLine={vm.icS.line} icWeave={vm.icS.weave} />
          <Ledger label={skein.T.ledger} snaps={skein.snaps} expert={skein.expert} />
        </div>
        <div className={s.right}>
          {skein.sel ? <Snapshot sel={skein.sel} T={skein.T} expert={skein.expert} icChat={vm.icS.chat} /> : <p className={s.freshLine}>{vm.freshLine}</p>}
        </div>
      </div>
    </div>
  );
}
