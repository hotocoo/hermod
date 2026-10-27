'use client';
import { COPY } from '@/config/copy';
import { useAppStore } from '@/state/store';
import { CreateSpaceForm, JoinForm } from './SpaceForms';
import s from './screens.module.css';

/** Create a Space or join one by invite. */
export function Welcome() {
  const c = COPY.ui.shell.gate.welcome;
  const pending =useAppStore((x) => x.pendingCode);
  const enter = useAppStore((x) => x.enterApp);
  return (
    <main className={s.screen} style={{ width: 'min(980px, 100%)' }} aria-labelledby="wl-title">
      <div>
        <div className={s.kicker}>{c.kicker}</div>
        <h1 id="wl-title" className={s.title}>{c.title}</h1>
        <p className={s.lead}>{c.lead}</p>
      </div>
      <div className={s.split}>
        <section aria-labelledby="wl-create" className={s.panel}>
          <h2 id="wl-create" style={{ fontSize: 26 }}>{c.create}</h2>
          <CreateSpaceForm onDone={enter} />
        </section>
        <section aria-labelledby="wl-join" className={`${s.panel} ${s.panelAlt}`}>
          <h2 id="wl-join" style={{ fontSize: 26 }}>{c.join}</h2>
          <JoinForm initial={pending ?? undefined} focus={!!pending} onDone={enter} />
        </section>
      </div>
      <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={enter}>{c.skip}</button>
    </main>
  );
}
