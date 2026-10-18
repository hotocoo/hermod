/** Named timer bag: re-arming a name cancels the previous handle (replaces the prototype's __xT fields). */
type Handle = ReturnType<typeof setTimeout>;
const timeouts = new Map<string, Handle>();
const intervals = new Map<string, Handle>();

export const timer = {
  after(name: string, ms: number, fn: () => void): void {
    clearTimeout(timeouts.get(name));
    timeouts.set(name, setTimeout(fn, ms));
  },
  every(name: string, ms: number, fn: () => void): void {
    clearInterval(intervals.get(name));
    intervals.set(name, setInterval(fn, ms));
  },
  clear(name: string): void {
    clearTimeout(timeouts.get(name)); timeouts.delete(name);
    clearInterval(intervals.get(name)); intervals.delete(name);
  },
  clearAll(): void {
    timeouts.forEach((h) => clearTimeout(h)); timeouts.clear();
    intervals.forEach((h) => clearInterval(h)); intervals.clear();
  },
};
