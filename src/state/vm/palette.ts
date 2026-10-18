import { palRef } from '../domRefs';
import { paletteResults } from '../palette';
import type { InputEvt } from '../types';
import type { Ctx } from './context';
import { fgOf, mixAccent } from './css';

export function paletteVm(x: Ctx) {
  const { s, seed, I } = x;
  const raw = s.palette ? paletteResults(s, seed) : [];
  const results = raw.map((r, i) => ({
    label: r.label, sub: r.sub, group: r.group, showGroup: i === 0 || raw[i - 1].group !== r.group, iconEl: I(r.icon, 16, 1.7),
    active: i === s.pi, bg: i === s.pi ? mixAccent(12) : 'transparent', fg: fgOf(i === s.pi),
    onClick: () => s.runResult(i), onHover: () => s.setPi(i),
  }));
  return {
    palette: s.palette, q: s.q, onQ: (e: InputEvt) => s.setQ(e.target.value), results, noResults: s.palette && results.length === 0,
    openPalette: s.openPalette, closePalette: s.closePalette, palRef, stop: (e: { stopPropagation(): void }) => e.stopPropagation(),
  };
}

export function toastVm(x: Ctx) {
  const t = x.s.toast;
  return { toast: t, hasToast: !!t, toastText: t ? t.text : '', toastY: t ? '0px' : '24px', toastOp: t ? '1' : '0' };
}
