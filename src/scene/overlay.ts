import * as THREE from 'three';
import { GROWTH } from '@/config/scene';
import { LAYOUT } from '@/config/app';
import type { HouseActor, MiniIsle, Plots, SpaceInfo, TownMode } from './types';
import type { RavenActor } from './ravens';

type ScreenPt = { x: number; y: number; z: number };
/** Label element with per-element animation state stashed on it (stem/offset easing, cached children). */
type LabelEl = HTMLElement & { __cw?: number; __ch?: number; __card?: HTMLElement | null; __full?: boolean; __det?: HTMLElement[]; __st?: number; __dx?: number; __op?: number; __stemEl?: HTMLElement | null };
/** Live scene state read each frame. */
export interface OverlayState {
  mode: TownMode; focusId: string | null; hovered: string | null; photo: boolean; archi: boolean; current: SpaceInfo | null;
  minis: MiniIsle[]; archiK: number; photoK: number; islandY: number; camDist: number;
}
interface LabelBest { dx: number; stem: number; r: { x: number; y: number; w: number; h: number } }
interface LabelItem { le: LabelEl; id: string | null; ax: number | null; ay: number; az: number; op: number; card: HTMLElement | null; full: boolean; cw: number; ch: number; best?: LabelBest | null }
export interface OverlayDeps {
  plots: Plots; houses: () => readonly HouseActor[]; perched: RavenActor[]; state: () => OverlayState;
  /** Anchor of a plot or 'search' in the active map style (island space). */
  anchor: (id: string) => { x: number; y: number; z: number } | undefined;
  project: (x: number, y: number, z: number) => ScreenPt;
  doorWorld: (id: string, out: THREE.Vector3) => THREE.Vector3 | null;
}

/** Positions the HTML labels (building cards, door prompts, raven and isle tags) over the 3D scene each frame. */
export function createOverlay(overlay: HTMLElement, { plots, houses, perched, state, project, doorWorld, anchor }: OverlayDeps) {
  let obstRects: { x: number; y: number; w: number; h: number }[] = [], obstScan = 0; let labelEls: LabelEl[] = []; let isleEls: LabelEl[] = []; let perchEls: LabelEl[] = []; let doorEls: LabelEl[] = []; let labelScan = 0;
  const pv3 = new THREE.Vector3();
  /** Cottage labels keyed by user id: an app-supplied [data-house] element if present, else a badge the scene creates (and removes). */
  const houseEls = new Map<string, { el: HTMLElement; own: boolean }>(); let houseScan = 0;
  const BADGE = 'position:absolute;left:0;top:0;pointer-events:none;opacity:0;will-change:transform,opacity;white-space:nowrap;font:600 10px/1 var(--font-body,system-ui,sans-serif);letter-spacing:.05em;padding:3px 6px;border-radius:999px;background:rgba(34,27,20,.8);color:#f4e8cc;border:1px solid rgba(217,169,95,.8);box-shadow:0 1px 5px rgba(0,0,0,.35)';
  function syncHouses(list: readonly HouseActor[]) {
    const ids = new Set(list.map((h) => h.userId));
    list.forEach((h) => { if (houseEls.has(h.userId)) return; const found = Array.from(overlay.querySelectorAll<HTMLElement>('[data-house]')).find((e) => e.getAttribute('data-house') === h.userId); if (found) { houseEls.set(h.userId, { el: found, own: false }); return; } const el = document.createElement('div'); el.setAttribute('data-house', h.userId); el.setAttribute('title', h.name); el.setAttribute('aria-label', h.name); el.style.cssText = BADGE; el.textContent = h.initials; overlay.appendChild(el); houseEls.set(h.userId, { el, own: true }); });
    houseEls.forEach((v, id) => { if (ids.has(id)) return; if (v.own) v.el.remove(); houseEls.delete(id); });
  }
  function update(now: number) {
    const { mode, focusId, hovered, photo, archi, current, minis, archiK, photoK, islandY, camDist } = state();
    const remeasure = now - labelScan > 400;
    if (remeasure) { labelEls = Array.from(overlay.querySelectorAll<LabelEl>('[data-bld]')); isleEls = Array.from(overlay.querySelectorAll<LabelEl>('[data-isle]')); perchEls = Array.from(overlay.querySelectorAll<LabelEl>('[data-perch]')); doorEls = Array.from(overlay.querySelectorAll<LabelEl>('[data-door]')); labelScan = now; }
    doorEls.forEach((le) => { if (mode !== 'door' || !focusId) { le.style.opacity = '0'; le.style.pointerEvents = 'none'; return; } const dp = doorWorld(focusId, pv3); if (!dp) return; const pp = project(dp.x, dp.y + (focusId === 'hearth' ? 1.4 : 1.1), dp.z); le.style.transform = 'translate3d(' + pp.x.toFixed(1) + 'px,' + pp.y.toFixed(1) + 'px,0)'; le.style.opacity = '1'; le.style.pointerEvents = 'auto'; });
    perchEls.forEach((le) => { const kind = le.getAttribute('data-perch'); const list = perched.filter((r) => r.kind === kind); if (!list.length || focusId || photo || archi) { le.style.opacity = '0'; le.style.pointerEvents = 'none'; return; } const c = new THREE.Vector3(); list.forEach((r) => c.add(r.g.position)); c.multiplyScalar(1 / list.length); const pp = project(c.x, c.y + 0.75, c.z); le.style.transform = 'translate3d(' + pp.x.toFixed(1) + 'px,' + pp.y.toFixed(1) + 'px,0) translate(-50%,-100%)'; le.style.opacity = pp.y < 96 ? '0' : '1'; le.style.pointerEvents = 'auto'; });
    isleEls.forEach((le) => { const id = le.getAttribute('data-isle'); const m = minis.find((x) => x.id === id); let pp, s; if (current && id === current.id) { pp = project(0, 7, 0); s = archiK; } else if (m) { pp = project(m.g.position.x, m.g.position.y + 3.2, m.g.position.z); s = Math.min(1, m.s.x) * archiK; } else { le.style.opacity = '0'; return; } le.style.transform = 'translate3d(' + pp.x.toFixed(1) + 'px,' + pp.y.toFixed(1) + 'px,0) translate(-50%,-100%)'; le.style.opacity = s.toFixed(3); le.style.pointerEvents = s > 0.6 ? 'auto' : 'none'; });
    if (now - obstScan > 400) { obstScan = now; obstRects = Array.from(document.querySelectorAll('[data-obstacle]')).filter((e) => parseFloat(getComputedStyle(e).opacity) > 0.1).map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }).filter((r) => r.w > 0 && r.h > 0); }
    const hs = houses(); if (now - houseScan > 400 || houseEls.size !== hs.length) { houseScan = now; syncHouses(hs); }
    const show = mode === 'island' && !focusId && !photo && !archi; const near = Math.max(0, Math.min(1, (GROWTH.label.fadeDist - camDist) / 10 + 1));
    hs.forEach((h) => { const v = houseEls.get(h.userId); if (!v) return; const pp = project(h.x, GROWTH.cottage.labelY * Math.max(0.01, h.s.x), h.z); const on = show && !h.dying && pp.z < 1; v.el.style.transform = 'translate3d(' + pp.x.toFixed(1) + 'px,' + pp.y.toFixed(1) + 'px,0) translate(-50%,-100%)'; v.el.style.opacity = on ? (Math.min(1, h.s.x) * near * (1 - archiK)).toFixed(2) : '0'; });
    const VW = window.innerWidth;
    const items: LabelItem[] = labelEls.map((le) => { const id = le.getAttribute('data-bld')!; let ax = null, ay = 0, az = 1, s = 1;
      if (id === 'search') { const sg = anchor('search'); const q = sg ? project(sg.x, sg.y + 3.7, sg.z) : { x: 0, y: 0, z: 1 }; ax = q.x; ay = q.y; az = q.z; s = Math.min(1, Math.max(0, (islandY + 5) / 5)); }
      else if (plots[id]) { const pl = plots[id]; const q = anchor(id) ?? { x: 0, y: 0, z: 0 }; const pp = project(q.x, q.y + (pl.g.userData.anchorY || 3) * pl.scale.x + pl.hover.x * 0.22, q.z); ax = pp.x; ay = pp.y; az = pp.z; s = Math.min(1, Math.max(0, pl.scale.x)); }
      const hide = ax == null || (focusId && focusId !== id) || mode !== 'island'; const op = hide ? 0 : s * (1 - archiK) * (1 - photoK);
      const card = le.__card || (le.__card = le.querySelector<HTMLElement>('[data-card]')); const full = hovered === id; if (le.__full !== full) { le.__full = full; (le.__det || (le.__det = Array.from(le.querySelectorAll<HTMLElement>('[data-detail]')))).forEach((d) => { d.style.display = full ? '' : 'none'; }); } return { le, id, ax, ay, az, op, card, full, cw: card ? (remeasure || le.__cw == null ? (le.__cw = card.offsetWidth) : le.__cw) : 120, ch: card ? (remeasure || le.__ch == null ? (le.__ch = card.offsetHeight) : le.__ch) : 32 }; });
    const placed = obstRects.slice();
    const nObst = obstRects.length;
    items.filter((o) => o.op > 0.01 && o.az < 1).sort((a, b) => (a.full ? -1 : b.full ? 1 : a.id === 'hearth' ? -1 : b.id === 'hearth' ? 1 : b.ay - a.ay)).forEach((o) => { const DOT = 12; let best: LabelBest | null = null, bestScore = Infinity;
      for (const k of [0, -0.6, 0.6, -1.1, 1.1, -1.6, 1.6, -2.2, 2.2]) { for (const stem of [18, 40, 62, 86, 112, -10, -40, -70]) { const r = { x: o.ax! + k * o.cw - o.cw / 2, y: o.ay - DOT - stem - o.ch, w: o.cw, h: o.ch };
          const edge = Math.max(0, 80 - r.y) + Math.max(0, 8 - r.x) + Math.max(0, r.x + r.w - (VW - 8)) + Math.max(0, r.y + r.h - (window.innerHeight - 8));
          let score = edge * 1e5 + Math.abs(k) * 6 + Math.abs(stem - 18) * 0.15; placed.forEach((p, pi) => { const ox = Math.min(r.x + r.w + 6, p.x + p.w + 6) - Math.max(r.x, p.x); const oy = Math.min(r.y + r.h + 6, p.y + p.h + 6) - Math.max(r.y, p.y); if (ox > 0 && oy > 0) score += 1e4 + ox * oy * (pi < nObst ? 60 : 30); });
          if (score < bestScore) { bestScore = score; best = { dx: k * o.cw, stem, r }; } if (score < 40) break; } if (bestScore < 40) break; }
      o.best = best; if (best) placed.push(best.r); });
    items.forEach((o) => { const le = o.le; if (o.ax == null) { le.style.opacity = '0'; le.style.pointerEvents = 'none'; return; }
      const b = o.best; const tStem = b ? b.stem : (le.__st == null ? 18 : le.__st), tDx = b ? b.dx : (le.__dx || 0);
      le.__st = le.__st == null ? tStem : le.__st + (tStem - le.__st) * 0.22; le.__dx = le.__dx == null ? tDx : le.__dx + (tDx - le.__dx) * 0.22;
      le.style.transform = 'translate3d(' + o.ax.toFixed(1) + 'px,' + o.ay.toFixed(1) + 'px,0) translate(-50%,-100%)';
      const stem = le.__stemEl || (le.__stemEl = le.querySelector<HTMLElement>('[data-stem]')); if (stem) { stem.style.height = Math.max(0, le.__st).toFixed(1) + 'px'; stem.style.opacity = le.__st > 2 ? '1' : '0'; stem.style.transformOrigin = 'bottom'; stem.style.transform = 'skewX(' + (-Math.atan2(le.__dx, Math.max(8, le.__st)) * 57.3).toFixed(1) + 'deg)'; }
      if (o.card) o.card.style.transform = 'translate(' + le.__dx.toFixed(1) + 'px,' + Math.max(0, -le.__st).toFixed(1) + 'px)';
      le.__op = (le.__op == null ? 0 : le.__op) + (((b && b.r.y > LAYOUT.labelTopClearPx ? o.op : 0)) - (le.__op || 0)) * 0.25; /* no room below the top bar: fade out rather than slide under the HUD pills */ le.style.opacity = le.__op.toFixed(3); le.style.pointerEvents = le.__op > 0.5 ? 'auto' : 'none'; le.style.zIndex = String(Math.max(1, Math.min(20, Math.round((1 - o.az) * 400)))); });
  }
  return { update };
}
