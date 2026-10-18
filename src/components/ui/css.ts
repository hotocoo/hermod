import type { CSSProperties } from 'react';

/** View-model pointer-events values are plain strings ('auto' | 'none'); narrow them for the style prop. */
export const pe = (v: string) => v as CSSProperties['pointerEvents'];
