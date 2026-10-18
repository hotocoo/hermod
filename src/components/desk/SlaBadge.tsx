'use client';
import { isTerminal, type Ticket } from '@/state/deskTypes';
import { slaBadge, type SlaTone } from '@/state/vm/desk';
import s from './desk.module.css';
import { useNow } from './useNow';

const TONE: Record<SlaTone, string> = { ok: s.slaOk, soon: s.slaSoon, late: s.slaLate, paused: s.slaPaused, done: s.slaDone, missed: s.slaMissed };

function Chip({ t, now }: { t: Ticket; now: number }) {
  const b = slaBadge(t, now);
  if (!b) return null;
  return <span className={`${s.sla} ${TONE[b.tone]}`} data-testid="sla-badge" data-tone={b.tone}>{b.label}</span>;
}

/** Ticks with the shared clock. Only mounted for running countdowns. */
function Live({ t }: { t: Ticket }) { return <Chip t={t} now={useNow()} />; }

/** SLA chip: a live countdown while the clock runs, a static label when paused or finished (no timer subscription then). */
export function SlaBadge({ t }: { t: Ticket }) {
  const running = !!t.sla && !t.merged_into && !t.sla.paused && !isTerminal(t.status);
  return running ? <Live t={t} /> : <Chip t={t} now={0} />;
}
