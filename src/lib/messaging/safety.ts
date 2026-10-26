/**
 * E-014: a fingerprint both DM peers can compare. User ids are base58 ed25519 public keys,
 * so hashing the sorted pair with SHA-256 gives both devices the same six groups of five digits.
 */
export async function safetyNumber(a: string, b: string): Promise<string> {
  if (!a || !b) return '';
  const [x, y] = a < b ? [a, b] : [b, a];
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`hermod-safety-v1\n${x}\n${y}`)));
  return Array.from({ length: 6 }, (_, i) =>
    String(((digest[i * 5] << 16) | (digest[i * 5 + 1] << 8) | (digest[i * 5 + 2])) % 100_000).padStart(5, '0'),
  ).join(' ');
}
