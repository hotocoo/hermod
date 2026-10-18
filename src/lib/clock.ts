/** Wall and monotonic clocks for event handlers and timers (kept out of component bodies so render stays pure). */
export const wallMs = (): number => Date.now();
export const monoMs = (): number => performance.now();
