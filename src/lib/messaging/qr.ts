/** QR Code encoder (ISO 18004): byte mode, error correction level L, versions 1 to 40. Local only: no library, no network. */
const ECC_PER_BLOCK = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
const BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25];

const gmul = (x: number, y: number): number => { let z = 0; for (let i = 7; i >= 0; i -= 1) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
const generator = (degree: number): number[] => {
  const r = new Array<number>(degree).fill(0); r[degree - 1] = 1; let root = 1;
  for (let i = 0; i < degree; i += 1) { for (let j = 0; j < degree; j += 1) { r[j] = gmul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; } root = gmul(root, 2); }
  return r;
};
/** Reed-Solomon remainder over GF(256), polynomial 0x11d. */
export function reedSolomon(data: number[], degree: number): number[] {
  const gen = generator(degree); const rem = new Array<number>(degree).fill(0);
  for (const b of data) { const f = b ^ (rem.shift() as number); rem.push(0); gen.forEach((c, i) => { rem[i] ^= gmul(c, f); }); }
  return rem;
}

const rawModules = (v: number): number => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
};
const dataWords = (v: number): number => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v];
const bit = (n: number, i: number): boolean => ((n >>> i) & 1) !== 0;

/** Data codewords of `bytes`, with mode, count, terminator and pad bytes, for version `v`. */
function dataStream(bytes: Uint8Array, v: number): number[] {
  const bits: number[] = [];
  const push = (val: number, n: number) => { for (let i = n - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1); };
  push(0b0100, 4); push(bytes.length, v <= 9 ? 8 : 16); bytes.forEach((b) => push(b, 8));
  const cap = dataWords(v) * 8;
  push(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < dataWords(v); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Splits into blocks, adds error correction and interleaves. */
function interleave(data: number[], v: number): number[] {
  const nb = BLOCKS[v]; const eccLen = ECC_PER_BLOCK[v]; const raw = Math.floor(rawModules(v) / 8);
  const shortCount = nb - (raw % nb); const shortLen = Math.floor(raw / nb);
  const blocks: number[][] = []; let k = 0;
  for (let i = 0; i < nb; i += 1) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortCount ? 0 : 1)); k += dat.length;
    const ecc = reedSolomon(dat, eccLen); if (i < shortCount) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i += 1) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortCount) out.push(b[i]); });
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Penalty rules 1 (runs), 2 (2x2 blocks) and 4 (balance); rule 3 (finder lookalikes) is skipped, which only affects mask choice. */
function penalty(m: boolean[][]): number {
  const n = m.length; let p = 0; let dark = 0;
  for (let a = 0; a < n; a += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let b = 1; b < n; b += 1) {
        const cur = horizontal ? m[a][b] : m[b][a]; const prev = horizontal ? m[a][b - 1] : m[b - 1][a];
        if (cur === prev) { run += 1; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1;
      }
    }
    for (let b = 0; b < n; b += 1) { if (m[a][b]) dark += 1; if (a + 1 < n && b + 1 < n && m[a][b] === m[a][b + 1] && m[a][b] === m[a + 1][b] && m[a][b] === m[a + 1][b + 1]) p += 3; }
  }
  return p + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
}

/** Module matrix (true = dark) for `text` encoded as UTF-8. Throws when it does not fit version 40. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let v = 1;
  while (v <= 40 && 4 + (v <= 9 ? 8 : 16) + 8 * bytes.length > dataWords(v) * 8) v += 1;
  if (v > 40) throw new Error('Too much data for a QR code');
  const size = v * 4 + 17;
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { mod[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx; const y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  const na = v === 1 ? 0 : Math.floor(v / 7) + 2; const pos: number[] = [];
  if (na) {
    const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2; pos.push(6);
    for (let p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
  }
  pos.forEach((px, i) => pos.forEach((py, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const format = (mask: number) => {
    const d = (1 << 3) | mask; let r = d; for (let i = 0; i < 10; i += 1) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const bits = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i += 1) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6)); set(8, 8, bit(bits, 7)); set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true);
  };
  format(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i += 1) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bits = (v << 12) | r;
    for (let i = 0; i < 18; i += 1) { const a = size - 11 + (i % 3); const b = Math.floor(i / 3); set(a, b, bit(bits, i)); set(b, a, bit(bits, i)); }
  }
  const words = interleave(dataStream(bytes, v), v); let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) for (let j = 0; j < 2; j += 1) {
      const x = right - j; const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && k < words.length * 8) { mod[y][x] = bit(words[k >>> 3], 7 - (k & 7)); k += 1; }
    }
  }
  const apply = (mask: number) => { for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!fn[y][x] && MASKS[mask](x, y)) mod[y][x] = !mod[y][x]; };
  let best = 0; let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) { apply(mask); format(mask); const sc = penalty(mod); if (sc < bestScore) { best = mask; bestScore = sc; } apply(mask); }
  apply(best); format(best);
  return mod;
}
