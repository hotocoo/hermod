/** localStorage that never throws (private windows, blocked storage, SSR). */
export function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
export function writeFlag(key: string): void {
  try { localStorage.setItem(key, '1'); } catch { /* storage unavailable: flag simply does not persist */ }
}
export function readString(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeString(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: the value simply does not persist */ }
}
