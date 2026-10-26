import { useEffect, useRef, useState } from 'react';

/** Click-away and Escape for a popover that lives next to its button. */
export function usePopover() {
  const [open, setOpen] = useState(false); const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    // stopPropagation: the Escape that closes the popover must not also reach the window ladder that leaves the building.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return [root, open, setOpen] as const;
}
