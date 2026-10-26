'use client';
import { useState } from 'react';
import type { Seed } from '@/lib/data/types';
import { PRIORITY_LABEL, STATUS_LABEL, isTerminal, type DeskView, type Ticket } from '@/state/deskTypes';
import { COPY } from '@/config/copy';
import { personOf } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import { queueName } from '@/state/vm/desk';
import { Conversation } from './Conversation';
import { Composer } from './Composer';
import { CsatPrompt } from './CsatPrompt';
import s from './desk.module.css';
import { MergeDialog } from './MergeDialog';
import { Properties } from './Properties';
import { SlaBadge } from './SlaBadge';

interface Props { desk: DeskView; t: Ticket; seed: Seed; me: string; onBack: () => void }

/** One ticket: conversation, composer, CSAT prompt for the requester and (for agents) the properties panel. */
export function TicketDetail({ desk, t, seed, me, onBack }: Props) {
  const st = useAppStore.getState();
  const internal = useAppStore((x) => x.deskInternal);
  const [merging, setMerging] = useState(false);
  const requester = t.requester === me;
  const numberOf = (id: string) => desk.tickets.find((x) => x.id === id)?.number ?? null;
  const showCsat = requester && isTerminal(t.status) && desk.config.csat && !t.csat;
  return (
    <section className={s.detail} aria-label={COPY.ui.desk.detail.label(t.number)} data-testid="ticket-detail" data-ticket={t.id}>
      <div className={s.detailScroll}>
        <div className={s.thread}>
          <button type="button" className={`btn btn-secondary ${s.back}`} onClick={onBack}>{COPY.ui.desk.detail.back}</button>
          <h3 className={s.subject} data-testid="ticket-subject">{t.subject}</h3>
          <div className={s.byline}>
            <span>#{t.number}</span>
            <span className={s.chip} data-testid="ticket-status">{STATUS_LABEL[t.status]}</span>
            <span className={s.chip}>{PRIORITY_LABEL[t.priority]}</span>
            <span>{queueName(desk, t.queue)}</span>
            <span>{COPY.ui.desk.detail.by(personOf(seed, t.requester).name)}</span>
            {t.assignee && <span>{COPY.ui.desk.detail.for(personOf(seed, t.assignee).name)}</span>}
            {desk.agent && <SlaBadge t={t} />}
          </div>
          {t.csat && <p className={s.hint} data-testid="csat-result">{COPY.ui.desk.detail.rated(t.csat.score, t.csat.comment)}</p>}
          <Conversation t={t} seed={seed} numberOf={numberOf} />
          {showCsat && <CsatPrompt onRate={(score, comment) => st.deskRate(t.id, score, comment)} />}
        </div>
        {desk.agent && (
          <Properties desk={desk} t={t} seed={seed} me={me} update={(p) => { void st.deskUpdate([t.id], p); }}
            onLink={(kind, target) => st.deskLink(t.id, kind, target)} onMerge={() => setMerging(true)} onOpenTicket={st.deskSelect} />
        )}
      </div>
      <Composer agent={desk.agent} closed={t.status === 'closed'} internal={internal} macros={desk.macros}
        onInternal={(on) => st.deskSet({ deskInternal: on })} onSend={(body, internal, att) => st.deskComment(t.id, body, internal, att)}
        onMacro={(m) => { void st.deskApplyMacro([t.id], m); }} />
      {merging && <MergeDialog desk={desk} from={t} onClose={() => setMerging(false)} onMerge={(into) => st.deskMerge(t.id, into)} />}
    </section>
  );
}
