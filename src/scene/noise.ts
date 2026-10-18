import * as THREE from 'three';

// Perlin noise with a fixed permutation (seed 1337) so the world is identical on every run.
const P = new Uint8Array(512);
{ const p = Array.from({ length: 256 }, (_, i) => i); let s = 1337; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10), lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const grad = (h: number, x: number, y: number, z: number) => { const u = (h & 15) < 8 ? x : y, v = (h & 15) < 4 ? y : ((h & 15) === 12 || (h & 15) === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
export function noise(x: number, y: number, z: number): number { const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255; x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z); const u = fade(x), v = fade(y), w = fade(z); const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(lerp(lerp(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u), lerp(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v), lerp(lerp(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u), lerp(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u), v), w); }
export const fbm = (x: number, y: number, z: number, o?: number): number => { let a = 0, f = 1, amp = 0.5; for (let i = 0; i < (o || 4); i++) { a += amp * noise(x * f, y * f, z * f); f *= 2.03; amp *= 0.5; } return a; };
/** Push every vertex of a unit-ish blob along its normal by fbm noise. */
export function displace<G extends THREE.BufferGeometry>(geo: G, amp: number, freq: number, seed: number): G { const p = geo.attributes.position; const n = new THREE.Vector3(); geo.computeVertexNormals(); const nr = geo.attributes.normal; for (let i = 0; i < p.count; i++) { n.set(p.getX(i), p.getY(i), p.getZ(i)); const d = fbm(n.x * freq + seed, n.y * freq + seed * 0.7, n.z * freq - seed, 4) * amp; p.setXYZ(i, n.x + nr.getX(i) * d, n.y + nr.getY(i) * d, n.z + nr.getZ(i) * d); } geo.computeVertexNormals(); return geo; }
