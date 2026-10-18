/** Critically-tunable damped spring, sub-stepped at 120Hz. */
export class Spring {
  x: number; v = 0; t: number; k: number; c: number;
  constructor(x: number, k: number, z: number) { this.x = x; this.t = x; this.k = k; this.c = 2 * Math.sqrt(k) * z; }
  step(dt: number): void {
    if (!(dt > 0)) return;
    if (!isFinite(this.x) || !isFinite(this.v)) { this.x = this.t; this.v = 0; }
    const n = Math.max(1, Math.ceil(dt / (1 / 120))); const h = dt / n;
    for (let i = 0; i < n; i++) { const a = -this.k * (this.x - this.t) - this.c * this.v; this.v += a * h; this.x += this.v * h; }
  }
  snap(v: number): void { this.x = this.t = v; this.v = 0; }
  tune(k: number, z: number): void { this.k = k; this.c = 2 * Math.sqrt(k) * z; }
}
/** Build a spring from a [stiffness, damping ratio] config pair. */
export const spring = (x: number, kz: readonly [number, number] | readonly number[]): Spring => new Spring(x, kz[0], kz[1]);
