/** X-002: roving focus over a row of buildings. Returns the next index for a key, or null when the key does not navigate (wraps at both ends). */
export function rovingIndex(len: number, cur: number, key: string): number | null {
  if (len <= 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (cur + 1) % len;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (cur - 1 + len) % len;
  if (key === 'Home') return 0;
  if (key === 'End') return len - 1;
  return null;
}
