/** Tiny typed emitter. `Events` maps event name to payload type. */
export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  private handlers = new Map<keyof Events, Set<(p: never) => void>>();

  on<K extends keyof Events>(name: K, fn: (payload: Events[K]) => void): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn as (p: never) => void);
    return () => { set.delete(fn as (p: never) => void); };
  }

  protected emit<K extends keyof Events>(name: K, payload: Events[K]): void {
    for (const fn of [...(this.handlers.get(name) ?? [])]) {
      try { (fn as (p: Events[K]) => void)(payload); } catch (e) { console.error(`media listener for "${String(name)}" threw`, e); }
    }
  }

  protected clearListeners(): void { this.handlers.clear(); }
}
