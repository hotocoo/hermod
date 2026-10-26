import type { VmProps } from '@/components/panel/types';
import { COPY } from '@/config/copy';
import s from './chat.module.css';
import { Face } from '@/components/ui/Face';

export function ThreadPane({ vm }: VmProps) {
  const t = vm.thread;
  return (
    <section aria-label="Thread" className={s.pane}
      style={{ transform: `translateX(${vm.threadX})`, opacity: vm.threadOp, pointerEvents: vm.threadEvents as 'auto' | 'none' }}>
      {vm.threadOpen && !t && (
        <div className={s.tHead}>
          <div className={s.tHeadMain}><div className={s.tKick}>{COPY.threadLoading}</div></div>
          <button onClick={vm.closeThread} aria-label={COPY.closeThread} className={s.tClose}>{vm.icS.x}</button>
        </div>
      )}
      {vm.threadOpen && t && (
        <>
          <div className={s.tHead}>
            <div className={s.tHeadMain}>
              <div className={s.tKick}>In the margin</div>
              <div className={s.tTitle}>Thread in #{vm.chan.name}</div>
            </div>
            <button onClick={vm.closeThread} aria-label="Close thread" className={s.tClose}>{vm.icS.x}</button>
          </div>
          <div className={s.tBody}>
            <div className={s.root}>
              <div className={s.rootBy}><span className={s.rootName}>{t.name}</span><span className={s.tTime}>{t.t}</span></div>
              <p className={s.tText}>{t.text}</p>
            </div>
            {t.replies.map((rp, i) => (
              <div key={i} className={s.reply} style={{ animation: rp.anim }}>
                <div className={s.rFace}><Face initials={rp.initials} av={rp.av} /></div>
                <div><div className={s.rBy}><span className={s.rName}>{rp.name}</span><span className={s.tTime}>{rp.t}</span></div><p className={s.rText}>{rp.text}</p></div>
              </div>
            ))}
          </div>
          <div className={s.tComposer}>
            <div className={s.tbox}>
              <input value={vm.tdraft} onChange={vm.onTDraft} onKeyDown={vm.onTKey} placeholder="Reply in the margin" aria-label="Reply in the margin" className={s.tInput} />
              <button onClick={vm.onTSend} aria-label="Send reply" className={s.tSend}>{vm.icS.send}</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
