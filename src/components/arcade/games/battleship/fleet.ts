/** Fleet layout helpers for battleship placement (UI side only; the core validates the sealed layout). */
export const SIDE = 10;
export const FLEET = [
  { id: 'a', name: 'carrier', size: 5 }, { id: 'b', name: 'battleship', size: 4 }, { id: 'c', name: 'cruiser', size: 3 },
  { id: 'd', name: 'submarine', size: 3 }, { id: 'e', name: 'destroyer', size: 2 },
] as const;

export type Ships = (number[] | null)[];

/** Cells a ship of `size` covers from `cell`, or null when it leaves the grid. */
export function span(cell: number, size: number, horizontal: boolean): number[] | null {
  const r = Math.floor(cell / SIDE); const c = cell % SIDE;
  if (horizontal ? c + size > SIDE : r + size > SIDE) return null;
  return Array.from({ length: size }, (_, k) => (horizontal ? cell + k : cell + k * SIDE));
}

/** Places ship `idx` (replacing its earlier position); null when it would overlap another ship or leave the grid. */
export function placeShip(ships: Ships, idx: number, cell: number, horizontal: boolean): Ships | null {
  const cells = span(cell, FLEET[idx].size, horizontal);
  if (!cells) return null;
  const taken = new Set(ships.flatMap((x, k) => (k === idx || !x ? [] : x)));
  if (cells.some((c) => taken.has(c))) return null;
  return ships.map((x, k) => (k === idx ? cells : x));
}

export function boardString(ships: Ships): string {
  const b = Array<string>(SIDE * SIDE).fill('.');
  ships.forEach((cells, k) => cells?.forEach((c) => { b[c] = FLEET[k].id; }));
  return b.join('');
}

/** Random legal fleet using the browser's secure randomness. */
export function randomFleet(): Ships {
  const rnd = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  let ships: Ships = FLEET.map(() => null);
  for (let k = 0; k < FLEET.length; k += 1) {
    for (let tries = 0; tries < 500; tries += 1) {
      const next = placeShip(ships, k, rnd(SIDE * SIDE), rnd(2) === 0);
      if (next) { ships = next; break; }
    }
  }
  return ships.every(Boolean) ? ships : randomFleet();
}

/** Result of the shot at `cell` against my own board, given every shot fired at it so far (for drawing hits). */
export function shotResult(board: string, shots: { cell: number }[], cell: number): 'miss' | 'hit' {
  return board[cell] === '.' || !shots.some((x) => x.cell === cell) ? 'miss' : 'hit';
}
