'use client';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { COPY } from '@/config/copy';

const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
const ROWS: [string, string][] = [
  [`${MOD} K`, 'Search everything'], ['/', 'Search (when not typing)'], ['?', 'This list'],
  ['Alt 1 to 9', 'Switch building section'], ['J / K, R, I, E', 'Help Desk: next or previous ticket, reply, internal note, solve'], ['Alt Up / Down', 'Previous / next Space'], ['Esc', 'Close, step back, leave the building'],
  [`${MOD} Shift M`, 'Mute or unmute in a call'], ['P', 'Postcard mode'], ['M', 'All islands'],
  ['Enter', 'Send a message'], ['Shift Enter', 'New line in a message'],
];

export function ShortcutsModal() {
  const close = useAppStore((s) => s.closeModal);
  return (
    <Dialog title={COPY.ui.modals.shortcutsModalText.keyboardShortcuts} kicker={COPY.ui.modals.shortcutsModalText.help} onClose={close}>
      <table className={f.table}>
        <thead><tr><th scope="col">{COPY.ui.modals.shortcutsModalText.keys}</th><th scope="col">{COPY.ui.modals.shortcutsModalText.does}</th></tr></thead>
        <tbody>{ROWS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody>
      </table>
    </Dialog>
  );
}
