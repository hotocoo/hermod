/** True when `text` @-mentions `name` (first word compared): word-boundary, case-insensitive; `@Bobsled` and `x@Bob.com` do not count. */
export function mentionsName(text: string, name: string): boolean {
  const first = name.split(' ')[0];
  if (!first) return false;
  return new RegExp(`(^|\\s)@${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\W|$)`, 'i').test(text);
}
