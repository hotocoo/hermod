/** DOM theming: data attributes on <html> (palettes live in src/styles/themes.css). */
export type Theme = 'light' | 'dark';
export type Palette = 'parchment' | undefined;

export function applyTheme(theme: Theme, palette?: Palette): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (palette) root.dataset.palette = palette; else delete root.dataset.palette;
  root.style.colorScheme = theme;
}

export function applyGrain(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--h-grain-on', on ? '1' : '0');
}

/** Text size as a percentage of the browser default; every rem and inherited size follows. */
export function applyTextScale(percent: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.fontSize = percent === 100 ? '' : `${percent}%`;
  // Fixed HUD offsets (px) multiply by this so the chrome clears text that has grown.
  root.style.setProperty('--text-scale', String(percent / 100));
}
