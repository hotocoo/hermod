'use client';
import { useAppStore } from '@/state/store';
import { CreateSpaceForm, JoinForm } from './SpaceForms';
import s from './screens.module.css';

/** Create a Space or join one by invite. */
export function Welcome() {
  const pending = useAppStore((x) => x.pendingCode);
  const enter = useAppStore((x) => x.enterApp);
  return (
    <main className={s.screen} style={{ width: 'min(980px, 100%)' }} aria-labelledby="wl-title">
      <div>
        <div className={s.kicker}>Welcome</div>
        <h1 id="wl-title" className={s.title}>Start an island, or join one</h1>
        <p className={s.lead}>Every Space is its own island, shared only with the people you invite.</p>
      </div>
      <div className={s.split}>
        <section aria-labelledby="wl-create" className={s.panel}>
          <h2 id="wl-create" style={{ fontSize: 26 }}>Create a Space</h2>
          <CreateSpaceForm onDone={enter} />
        </section>
        <section aria-labelledby="wl-join" className={`${s.panel} ${s.panelAlt}`}>
          <h2 id="wl-join" style={{ fontSize: 26 }}>Join with an invite</h2>
          <JoinForm initial={pending ?? undefined} focus={!!pending} onDone={enter} />
        </section>
      </div>
      <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={enter}>Skip for now</button>
    </main>
  );
}
