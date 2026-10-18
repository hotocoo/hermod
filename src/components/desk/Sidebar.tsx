'use client';
import type { DeskView } from '@/state/deskTypes';
import type { DeskCounts, DeskScope } from '@/state/vm/desk';
import s from './desk.module.css';

interface Props { desk: DeskView; counts: DeskCounts; scope: DeskScope; onScope: (s: DeskScope) => void; onDeleteView: (id: string) => void; me: string }

function Item({ id, label, n, scope, onScope, late }: { id: DeskScope; label: string; n?: number; scope: DeskScope; onScope: (s: DeskScope) => void; late?: boolean }) {
  return (
    <button type="button" className={`${s.scope} ${late && n ? s.scopeLate : ''}`} aria-current={scope === id} onClick={() => onScope(id)} data-testid={`scope-${id}`}>
      <span>{label}</span>{n != null && <span className={s.scopeN}>{n}</span>}
    </button>
  );
}

/** Agent sidebar: built-in scopes, queues and saved views, each with its live count. */
export function Sidebar({ desk, counts, scope, onScope, onDeleteView, me }: Props) {
  return (
    <nav className={s.side} aria-label="Desk views">
      <Item id="all" label="All open" n={counts.all} scope={scope} onScope={onScope} />
      <Item id="mine" label="Assigned to me" n={counts.mine} scope={scope} onScope={onScope} />
      <Item id="unassigned" label="Unassigned" n={counts.unassigned} scope={scope} onScope={onScope} />
      <Item id="overdue" label="Overdue" n={counts.overdue} scope={scope} onScope={onScope} late />
      <Item id="requested" label="My requests" n={counts.requested} scope={scope} onScope={onScope} />
      {desk.config.queues.length > 0 && <div className={s.sideHead}>Queues</div>}
      {desk.config.queues.map((q) => <Item key={q.queue_id} id={`queue:${q.queue_id}`} label={q.name} n={counts.byQueue[q.queue_id] ?? 0} scope={scope} onScope={onScope} />)}
      {desk.views.length > 0 && <div className={s.sideHead}>Saved views</div>}
      {desk.views.map((v) => (
        <div key={v.id} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0 }}><Item id={`view:${v.id}`} label={v.name} scope={scope} onScope={onScope} /></div>
          {v.by === me && <button type="button" className={s.tagX} aria-label={`Delete view ${v.name}`} onClick={() => onDeleteView(v.id)}>×</button>}
        </div>
      ))}
    </nav>
  );
}
