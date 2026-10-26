'use client';
import { Attachment } from '@/components/chat/Attachment';
import type { BlobRef } from '@/lib/bridge';
import type { Seed } from '@/lib/data/types';
import { useAppStore } from '@/state/store';
import { COPY } from '@/config/copy';
import type { Ticket } from '@/state/deskTypes';
import { personOf } from '@/state/selectors';
import s from './desk.module.css';

/** Attachment chips; images open in the lightbox. */
export function Atts({ list }: { list: BlobRef[] }) {
  const open = useAppStore((st) => st.openModal);
  if (!list.length) return null;
  return <div className={s.atts}>{list.map((b) => <Attachment key={b.hash} b={{ ...b, open: () => open({ kind: 'lightbox', blob: b }) }} />)}</div>;
}

const when = (ts: number) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The request itself followed by every comment the viewer may see; internal notes are tinted and labelled. */
export function Conversation({ t, seed, numberOf }: { t: Ticket; seed: Seed; numberOf: (id: string) => number | null }) {
  const first = personOf(seed, t.requester);
  return (
    <div data-testid="conversation">
      <article className={s.msg}>
        <div className={s.face} aria-hidden="true">{first.i}</div>
        <div>
          <div className={s.msgHead}><span className={s.msgBy}>{first.name}</span><span className={s.hint}>{when(t.created)}</span></div>
          <p className={s.msgBody}>{t.body || COPY.ui.desk.conversation.noDescription}</p>
          <Atts list={t.att} />
        </div>
      </article>
      {t.comments.map((c) => {
        const p = personOf(seed, c.by);
        const from = c.ticket !== t.id ? numberOf(c.ticket) : null;
        return (
          <article key={c.id} className={s.msg} data-testid="comment" data-internal={c.internal}>
            <div className={s.face} aria-hidden="true">{p.i}</div>
            <div className={c.internal ? s.internal : undefined}>
              <div className={s.msgHead}>
                <span className={s.msgBy}>{p.name}</span><span className={s.hint}>{when(c.ts)}</span>
                {c.internal && <span className={s.internalTag}>{COPY.ui.desk.internalNote}</span>}
                {from != null && <span className={s.merged}>{COPY.ui.desk.conversation.mergedFrom(from)}</span>}
              </div>
              <p className={s.msgBody}>{c.body}</p>
              <Atts list={c.att} />
            </div>
          </article>
        );
      })}
    </div>
  );
}
