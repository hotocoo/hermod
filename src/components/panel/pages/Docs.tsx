import type { VmProps } from '../types';
import c from '../shared.module.css';
import { DocBlock } from './DocBlock';
import s from './docs.module.css';

const ADD: { k: 'h' | 'p' | 'q' | 't'; label: string }[] = [{ k: 'h', label: 'Heading' }, { k: 'p', label: 'Paragraph' }, { k: 'q', label: 'Quote' }, { k: 't', label: 'To-do' }];

export function Docs({ vm }: VmProps) {
  const doc = vm.doc;
  return (
    <div className={s.page}>
      <nav className={s.nav} aria-label="Docs">
        <div className={`${c.kicker} ${s.navHead}`}>Docs</div>
        {vm.docsList.map((dl) => (
          <button key={dl.title} onClick={dl.onClick} className={s.docBtn} style={{ background: dl.bg, color: dl.fg }}>{vm.icS.doc}{dl.title}</button>
        ))}
        <button onClick={vm.newDoc} className={`${c.btn} ${s.add}`}>{vm.icS.plus} New doc</button>
        {doc && <div className={`${c.kicker} ${s.navHead} ${s.outline}`}>Outline</div>}
        {doc && vm.docOutline.length === 0 && <div className={`${s.outlineItem} ${c.muted}`}>Add a heading to build an outline.</div>}
        {vm.docOutline.map((ol, i) => <div key={`${ol.text}-${i}`} className={`${s.outlineItem} ${c.muted}`}>{ol.text}</div>)}
      </nav>
      {!doc ? (
        <article className={s.article}>
          <h2 className={s.h1}>No docs yet</h2>
          <p className={c.muted}>Docs are shared pages the whole Space can edit. Start the first one.</p>
          <button onClick={vm.newDoc} className={c.btnAccent}>{vm.icS.plus} Create a doc</button>
        </article>
      ) : (
        <>
          <article className={s.article}>
            <div className={c.kicker}>{doc.kicker}</div>
            <h1 className={s.h1}>{doc.title}</h1>
            <div className={`${s.people} ${c.muted}`}>
              {doc.people.map((dp) => <span key={dp.name} title={dp.name} className={`${s.person} ${c.avatar}`} style={{ borderColor: dp.ring }}>{dp.i}</span>)}
              <span>{doc.edited ? `Edited ${doc.edited} · ` : ''}every change is a snapshot in the Loom</span>
            </div>
            {doc.blocks.length === 0 && <p className={c.muted}>An empty page. Add the first line below.</p>}
            {doc.blocks.map((bk) => <DocBlock key={bk.id || bk.text} bk={bk} />)}
            <div className={s.addRow} role="group" aria-label="Add a line">
              {ADD.map((a) => <button key={a.k} onClick={() => vm.addDocBlock(a.k)} className={c.btn}>{vm.icS.plus} {a.label}</button>)}
            </div>
          </article>
          <aside className={s.aside}>
            <div className={`${c.kicker} ${s.asideHead}`}>Comments</div>
            {doc.comments.length === 0 && <p className={c.muted}>No comments yet.</p>}
            {doc.comments.map((cm2, i) => (
              <div key={i} className={s.comment}><b className={s.strong}>{cm2.name}</b> <span className={c.muted}>on “{cm2.on}”</span><div>{cm2.text}</div></div>
            ))}
            <div className={`${c.kicker} ${s.asideHead} ${s.versions}`}>Versions</div>
            {doc.versions.length === 0 && <p className={c.muted}>No versions yet.</p>}
            {doc.versions.map((dv, i) => <div key={i} className={s.version}><span>{dv.t}</span><span className={`${s.seal} ${c.mono} ${c.muted}`}>{dv.seal}</span></div>)}
          </aside>
        </>
      )}
    </div>
  );
}
