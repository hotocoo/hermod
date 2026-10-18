import type { useViewModel } from '@/state/useViewModel';

/** The ready (post-seed) view model, shared by panel and chat components. */
export type Vm = Extract<ReturnType<typeof useViewModel>, { ready: true }>;
export interface VmProps { vm: Vm }
