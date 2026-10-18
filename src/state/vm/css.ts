/** Style-token strings the template binds directly (kept as CSS variables so themes apply). */
export const ACCENT = 'var(--color-accent)';
export const ACCENT_700 = 'var(--color-accent-700)';
export const ACCENT_800 = 'var(--color-accent-800)';
export const ACCENT_100 = 'var(--color-accent-100)';
export const ACCENT_300 = 'var(--color-accent-300)';
export const DIVIDER = 'var(--color-divider)';
export const TEXT = 'var(--color-text)';

export const mixAccent = (pct: number, into = 'transparent') => `color-mix(in srgb, var(--color-accent) ${pct}%, ${into})`;
export const mixText = (pct: number, into = 'transparent') => `color-mix(in srgb, var(--color-text) ${pct}%, ${into})`;
export const ringOf = (on: boolean) => (on ? ACCENT : DIVIDER);
export const fgOf = (on: boolean) => (on ? ACCENT_700 : TEXT);

/** Toggle switch styling. */
export const switchStyle = (on: boolean) => ({
  on, bd: ringOf(on), bg: on ? mixAccent(18) : 'transparent', knob: on ? ACCENT : mixText(40), x: on ? '18px' : '0px',
});
