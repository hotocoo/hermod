/** Structural equality of drawn data: plain objects and arrays compare field by field, functions are ignored (handlers are rebuilt every render), everything else by identity. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b || (typeof a === 'function' && typeof b === 'function')) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a); const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
