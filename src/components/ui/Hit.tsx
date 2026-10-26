import { splitHit } from '@/lib/searchHit';

const MARK_STYLE = { background: 'color-mix(in srgb, var(--color-accent) 28%, transparent)', color: 'inherit' } as const;

/** Text with search matches highlighted; only React text nodes are produced (never innerHTML). */
export function Hit({ text, q }: { text: string; q: string }) {
  return <>{splitHit(text, q).map((p, i) => (p.hit ? <mark key={i} style={MARK_STYLE}>{p.text}</mark> : p.text))}</>;
}
