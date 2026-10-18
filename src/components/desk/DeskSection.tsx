'use client';
import { useShallow } from 'zustand/react/shallow';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { getBridge } from '@/lib/bridge';
import { meId, personOf } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import { counts, deskOf, fmtSpan, listTickets, ticketById } from '@/state/vm/desk';
import { isTerminal } from '@/state/deskTypes';
import { Icon } from '@/components/ui/Icon';
import s from './desk.module.css';
import { MacroMenu } from './MacroMenu';
import { NewTicketDialog } from './NewTicketDialog';
import { Sidebar } from './Sidebar';
import { TicketDetail } from './TicketDetail';
import { TicketList } from './TicketList';

const DeskSettings = lazy(() => import('./DeskSettings').then((m) => ({ default: m.DeskSettings })));
const SEARCH_DEBOUNCE_MS = 200;
const MIN_QUERY = 2;
const AGE_REFRESH_MS = 30_000;

const isTyping = (t: EventTarget | null) => /INPUT|TEXTAREA|SELECT/.test((t as HTMLElement | null)?.tagName ?? '') || !!(t as HTMLElement | null)?.isContentEditable;

/** The Help Desk panel: queue sidebar, virtualized ticket list and the open ticket. Lazy-loaded from the panel. */
export default function DeskSection() {
  const seed = useAppStore((st) => st.seed);
  const space = useAppStore((st) => st.space);
  const me = useAppStore(meId);
  const { deskScope: scope, deskStatus: status, deskSort: sort, deskQ: q, deskSel: sel, deskBulk: bulk, deskPane: pane, deskMatchIds: matchIds } = useAppStore(useShallow((st) => ({
    deskScope: st.deskScope, deskStatus: st.deskStatus, deskSort: st.deskSort, deskQ: st.deskQ, deskSel: st.deskSel, deskBulk: st.deskBulk, deskPane: st.deskPane, deskMatchIds: st.deskMatchIds,
  })));
  const act = useAppStore.getState();
  const [newOpen, setNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), AGE_REFRESH_MS); return () => clearInterval(id); }, []);

  const desk = deskOf(seed, space);
  const agent = !!desk?.agent;
  const effectiveScope = agent ? scope : 'requested';

  // Full-text search through the core index (respects guest visibility); the list also filters locally while it answers.
  useEffect(() => {
    const term = q.trim();
    if (term.length < MIN_QUERY) { useAppStore.getState().deskSet({ deskMatchIds: null }); return undefined; }
    let live = true;
    const h = setTimeout(() => {
      getBridge().searchQuery(term, { space, kinds: ['ticket'], limit: 200 })
        .then((hits) => { if (live) useAppStore.getState().deskSet({ deskMatchIds: hits.map((x) => x.id) }); })
        .catch(() => { if (live) useAppStore.getState().deskSet({ deskMatchIds: null }); });
    }, SEARCH_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(h); };
  }, [q, space, desk?.tickets.length]);

  const tickets = useMemo(() => (desk && seed ? listTickets(desk, me, seed, { scope: effectiveScope, status, sort, text: q, matchIds: matchIds ? new Set(matchIds) : null }) : []), [desk, seed, me, effectiveScope, status, sort, q, matchIds]);
  const c = useMemo(() => (desk ? counts(desk, me) : null), [desk, me]);
  const current = desk ? ticketById(desk, sel) : null;
  const macros = desk?.macros ?? [];

  // j / k / r / i / e keyboard shortcuts, only when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || newOpen || settingsOpen) return;
      const st = useAppStore.getState();
      if (st.modal || st.prompt || st.confirm || st.palette) return;
      const i = tickets.findIndex((t) => t.id === st.deskSel);
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const next = tickets[Math.min(tickets.length - 1, Math.max(0, i + (e.key === 'j' ? 1 : -1)))];
        if (next) st.deskSelect(next.id);
      } else if (current && (e.key === 'r' || e.key === 'i')) {
        if (e.key === 'i' && !desk?.agent) return;
        e.preventDefault(); st.deskSet({ deskInternal: e.key === 'i' });
        requestAnimationFrame(() => document.getElementById('desk-composer')?.focus());
      } else if (current && desk?.agent && e.key === 'e' && !isTerminal(current.status)) {
        e.preventDefault(); void st.deskUpdate([current.id], { status: 'solved' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tickets, current, desk?.agent, newOpen, settingsOpen]);

  if (!seed || !desk || !c) return null;
  const name = (id: string) => personOf(seed, id).name;
  const bulkIds = Object.keys(bulk);
  const stats = desk.stats;

  return (
    <div className={s.root} data-testid="desk-root">
      <header className={s.head}>
        <div className={s.headMain}>
          <div className={s.kicker}>Help Desk</div>
          <h2 className={s.title}>{agent ? 'Tickets' : 'Your tickets'}</h2>
        </div>
        {stats && (
          <div className={s.stats} aria-label="Desk statistics" data-testid="desk-stats">
            <div className={s.stat}><span className={s.statN} data-testid="stat-open">{stats.open}</span><span className={s.statL}>Open</span></div>
            <div className={`${s.stat} ${stats.overdue ? s.statLate : ''}`}><span className={s.statN}>{stats.overdue}</span><span className={s.statL}>Overdue</span></div>
            <div className={s.stat}><span className={s.statN}>{stats.median_first_response_ms == null ? 'n/a' : fmtSpan(stats.median_first_response_ms)}</span><span className={s.statL}>Median reply</span></div>
            <div className={s.stat}><span className={s.statN}>{stats.csat_avg == null ? 'n/a' : stats.csat_avg.toFixed(1)}</span><span className={s.statL}>CSAT</span></div>
          </div>
        )}
        <input className={`input ${s.search}`} type="search" placeholder="Search tickets" aria-label="Search tickets" value={q} data-testid="desk-search"
          onChange={(e) => act.deskSet({ deskQ: e.target.value })} />
        <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)} data-testid="new-ticket"><Icon name="plus" size={14} /> New ticket</button>
        {agent && <button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(true)} data-testid="desk-settings-open" aria-label="Desk settings"><Icon name="sliders" size={14} /> Settings</button>}
      </header>
      <div className={s.body} data-guest={!agent} data-pane={pane}>
        {agent && <Sidebar desk={desk} counts={c} scope={effectiveScope} me={me} onScope={(sc) => act.deskSet({ deskScope: sc })} onDeleteView={(id) => { void act.deskDeleteView(id); }} />}
        <div className={s.listCol}>
          <div className={s.tools}>
            {agent && (
              <select className={`input ${s.scopeSelect}`} aria-label="Scope" value={effectiveScope} onChange={(e) => act.deskSet({ deskScope: e.target.value })}>
                <option value="all">All open</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option><option value="overdue">Overdue</option><option value="requested">My requests</option>
                {desk.config.queues.map((qq) => <option key={qq.queue_id} value={`queue:${qq.queue_id}`}>{qq.name}</option>)}
                {desk.views.map((v) => <option key={v.id} value={`view:${v.id}`}>{v.name}</option>)}
              </select>
            )}
            <select className="input" aria-label="Show" value={status} onChange={(e) => act.deskSet({ deskStatus: e.target.value as 'active' | 'all' | 'solved' })} data-testid="desk-status">
              <option value="active">Active</option><option value="solved">Solved and closed</option><option value="all">Everything</option>
            </select>
            <select className="input" aria-label="Sort" value={sort} onChange={(e) => act.deskSet({ deskSort: e.target.value as 'updated' | 'created' | 'priority' | 'sla' })}>
              <option value="updated">Recently updated</option><option value="created">Newest</option><option value="priority">Priority</option>{agent && <option value="sla">Next SLA</option>}
            </select>
            {agent && (scope !== 'all' || !!q.trim()) && <button type="button" className="btn btn-ghost" aria-label="Save this filter as a view" onClick={() => { void saveView(act, me, effectiveScope, status, sort, q); }}>Save view</button>}
          </div>
          {bulkIds.length > 0 && agent && (
            <div className={s.bulk} role="toolbar" aria-label="Bulk actions" data-testid="bulk-bar">
              <strong>{bulkIds.length} selected</strong>
              <button type="button" className="btn btn-secondary" onClick={() => { void act.deskUpdate(bulkIds, { assignee: me }).then(() => act.deskClearBulk()); }}>Assign to me</button>
              <button type="button" className="btn btn-secondary" onClick={() => { void act.deskUpdate(bulkIds, { status: 'solved' }).then(() => act.deskClearBulk()); }}>Solve</button>
              <button type="button" className="btn btn-secondary" onClick={() => { void act.deskUpdate(bulkIds, { priority: 'high' }).then(() => act.deskClearBulk()); }}>High priority</button>
              <MacroMenu macros={macros} label="Macro" onPick={(m) => { void act.deskApplyMacro(bulkIds, m).then(() => act.deskClearBulk()); }} />
              <button type="button" className="btn btn-ghost" onClick={act.deskClearBulk}>Clear</button>
            </div>
          )}
          {tickets.length === 0 ? (
            <div className={s.empty} data-testid="desk-empty">
              <div>
                <h3 className={s.emptyTitle}>{q ? 'No ticket matches' : agent ? 'Nothing waiting' : 'No tickets yet'}</h3>
                <p className={s.emptyLine}>{q ? 'Try another word, or switch the filter to Everything.' : agent ? 'New requests from members and guests land here.' : 'Need help? Open a ticket and the team will reply here.'}</p>
                {!q && <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>New ticket</button>}
              </div>
            </div>
          ) : <TicketList tickets={tickets} selected={sel} bulk={bulk} agent={agent} now={tick} name={name} onOpen={act.deskSelect} onCheck={act.deskToggleBulk} />}
        </div>
        {current ? <TicketDetail key={current.id} desk={desk} t={current} seed={seed} me={me} onBack={() => act.deskSet({ deskPane: 'list' })} /> : (
          <div className={`${s.detail} ${s.empty}`}><div><h3 className={s.emptyTitle}>{tickets.length ? 'Pick a ticket' : ' '}</h3><p className={s.emptyLine}>{tickets.length ? 'Use j and k to move, r to reply, i for an internal note, e to solve.' : ''}</p></div></div>
        )}
      </div>
      {newOpen && <NewTicketDialog desk={desk} onClose={() => setNewOpen(false)} />}
      {settingsOpen && <Suspense fallback={null}><DeskSettings config={desk.config} macros={desk.macros} admin={desk.admin} onClose={() => setSettingsOpen(false)} /></Suspense>}
    </div>
  );
}

/** Saves the current scope, status filter and search as a named view for the team. */
async function saveView(act: ReturnType<typeof useAppStore.getState>, me: string, scope: string, status: string, sort: string, q: string) {
  const name = await act.ask({ title: 'Save view', kicker: 'Help Desk', submit: 'Save', fields: [{ key: 'name', label: 'Name', required: true }] });
  if (!name) return;
  const filter = { status: status === 'solved' ? ['solved', 'closed'] : status === 'active' ? ['new', 'open', 'pending', 'on_hold'] : [], priority: [], queue: scope.startsWith('queue:') ? [scope.slice(6)] : [], assignee: scope === 'unassigned' ? [''] : scope === 'mine' ? [me] : [], tags: [], text: q.trim() || undefined };
  await act.deskSaveView({ name: name.name.trim(), filter, sort, shared: true });
}

