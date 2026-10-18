'use client';
import { useTrap } from '@/components/ui/useTrap';
import type { ViewModel } from '@/state/viewModel';
import s from './Profile.module.css';

export function Profile({ vm }: { vm: ViewModel }) {
  return vm.profOpen && vm.prof ? <ProfileDialog vm={vm} /> : null;
}

function ProfileDialog({ vm }: { vm: ViewModel }) {
  const { closeProfile, icS, onProfBio, onProfName, prof, profEdit, profEditLabel, profEmpty, profGrid, profTabs, profView, setAvatar, stop, toggleEditProf } = vm;
  const [trapRef, trapKeys] = useTrap<HTMLDivElement>(closeProfile);
  return (
    <div className={s.backdrop} onClick={closeProfile}>
      <div ref={trapRef} onKeyDown={trapKeys} className={s.dialog} onClick={stop} role="dialog" aria-modal="true" aria-label="Profile">
        <div className={s.cover}>
          <button className={s.closeBtn} onClick={closeProfile} aria-label="Close">{icS.x}</button>
        </div>
        <div className={s.body}>
          <div className={s.headRow}>
            <div className={s.avatar}>{prof.initials}</div>
            <div className={s.identity}>
              {profView ? (
                <>
                  <h2 className={s.name}>{prof.name}</h2>
                  <div className={s.handle}>{prof.role}</div>
                </>
              ) : null}
            </div>
            <button className={s.editBtn} onClick={setAvatar}>Change photo</button>
            <button className={s.editBtn} onClick={toggleEditProf}>{profEditLabel}</button>
          </div>
          {profEdit ? (
            <div className={s.editForm}>
              <label className={s.field}>
                Name
                <input className={s.nameInput} value={prof.name} onChange={onProfName} />
              </label>
              <label className={s.field}>
                Bio
                <textarea className={s.bioInput} onChange={onProfBio} value={prof.bio} />
              </label>
            </div>
          ) : null}
          {profView ? <p className={s.bio}>{prof.bio}</p> : null}
          <div className={s.stats}>
            {prof.stats.map((ps) => (
              <div key={ps.l}>
                <div className={s.statValue}>{ps.n}</div>
                <div className={s.statLabel}>{ps.l}</div>
              </div>
            ))}
          </div>
          <div className={s.tabs} role="tablist">
            {profTabs.map((pt) => (
              <button role="tab" className={s.tab} style={{ color: pt.fg, boxShadow: `inset 0 -2px 0 ${pt.ul}` }} onClick={pt.onClick} key={pt.label}>{pt.label}</button>
            ))}
          </div>
        </div>
        <div className={s.gridWrap}>
          {profEmpty ? <p className={s.bio}>Nothing here yet.</p> : null}
          <div className={s.grid}>
            {profGrid.map((pg, i) => (
              <div className={s.tile} style={{ aspectRatio: pg.ar, animation: pg.anim, backgroundImage: pg.url ? `url(${pg.url})` : undefined, backgroundSize: 'cover' }} key={i}>
                {pg.url ? null : <span className={s.tileLabel}>{pg.label}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
