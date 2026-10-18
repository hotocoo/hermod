import * as THREE from 'three';
import { BANNER_COLORS, BUILDING_GROWTH, NIGHT, PLOTS, SIGN, type BuildingLevel, type DressSpec } from '@/config/scene';
import type { SectionId } from '@/lib/data/types';
import { rng } from '../rng';
import { windify } from '../render/wind';
import type { Mats } from '../types';
import { B, C, lathe, merge, mtx, type Architecture, type MergePart } from './architecture';

/** Visual upgrades per building level (config BUILDING_GROWTH): level 2 adds a wing and banners, level 3 a tower, string lights and a garden. */
export function createDress(M: Mats, arch: Architecture) {
  const bannerMats = BANNER_COLORS.map((c) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide }); windify(m, 'flag'); return m; });
  const bannerGeo = (() => { const g = new THREE.PlaneGeometry(0.4, 0.9, 1, 6); g.translate(0, -0.45, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.89) p.setX(i, 0); g.computeVertexNormals(); return g; })();
  const wallOf = (n: 'plasterW' | 'brickW' | 'stoneW') => M[n];

  function banner(g: THREE.Group, i: number, x: number, y: number, z: number, ry: number) {
    const b = new THREE.Group(); b.position.set(x, y, z); b.rotation.y = ry;
    const pole = C(0.012, 0.012, 0.5, M.ink, 8, 0, 0, 0.03); pole.rotation.z = Math.PI / 2; b.add(pole);
    const cloth = new THREE.Mesh(bannerGeo, bannerMats[i % bannerMats.length]); cloth.position.set(0, -0.02, 0.04); cloth.castShadow = true; b.add(cloth);
    const trim = B(0.42, 0.03, 0.02, M.gold, 0, -0.03, 0.04); b.add(trim); g.add(b);
  }
  function wing(g: THREE.Group, s: DressSpec['wing'], rm: THREE.Material) {
    if (s.w <= 0) return; const w = new THREE.Group(); w.position.set(s.x, 0, s.z); const y0 = 0.24; const wall = wallOf(s.wall);
    w.add(B(s.w + 0.2, y0, s.d + 0.2, M.stoneW, 0, y0 / 2, 0)); w.add(B(s.w, s.h, s.d, wall, 0, y0 + s.h / 2, 0, 1));
    arch.gable(w, s.w, s.d, s.pitch, y0 + s.h, rm, { wall, ov: 0.22 });
    const sx = Math.sign(s.x) || 1;
    [-1, 1].forEach((k) => arch.windowAt(w, k * s.w * 0.24, y0 + s.h * 0.55, s.d / 2 + 0.015, 0.28, 0.46, 0, { arch: true, rows: 2 }));
    arch.windowAt(w, sx * (s.w / 2 + 0.015), y0 + s.h * 0.55, 0, 0.3, 0.46, sx * Math.PI / 2, { arch: true, rows: 2 });
    arch.chimney(w, -sx * s.w * 0.22, y0 + s.h + 0.1, -s.d * 0.18, 0.8, wall === M.brickW ? M.brickW : M.brickW); g.add(w);
  }
  function turret(g: THREE.Group, s: DressSpec['tower'], rm: THREE.Material) {
    if (s.r <= 0) return; const t = new THREE.Group(); t.position.set(s.x, 0, s.z);
    t.add(C(s.r * 1.2, s.r * 1.28, 0.3, M.stoneW, 20, 0, 0.15, 0)); t.add(C(s.r, s.r * 1.05, s.h, M.stoneW, 20, 0, 0.3 + s.h / 2, 0));
    [0.34, 0.68].forEach((f) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(s.r * 1.03, 0.03, 8, 28), M.trim); ring.rotation.x = Math.PI / 2; ring.position.y = 0.3 + s.h * f; ring.castShadow = true; t.add(ring); });
    [0.3, 0.62, 0.86].forEach((f, i) => arch.windowAt(t, Math.sin(i * 2.1) * s.r * 1.0, 0.3 + s.h * f, Math.cos(i * 2.1) * s.r * 1.0, 0.18, 0.34, i * 2.1, { arch: true, rows: 1 }));
    t.add(C(s.r * 1.28, s.r * 1.1, 0.12, M.trim, 20, 0, 0.3 + s.h + 0.06, 0));
    const roof = lathe([[s.r * 1.5, 0], [s.r * 1.3, 0.1], [s.r * 0.85, 0.5], [s.r * 0.4, 1.0], [s.r * 0.1, 1.4], [0, 1.45]], rm, 20); roof.position.y = 0.3 + s.h + 0.1; t.add(roof);
    t.add(C(0.012, 0.012, 0.4, M.gold, 8, 0, 0.3 + s.h + 1.65, 0)); const orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), M.lamp); orb.position.y = 0.3 + s.h + 1.5; t.add(orb); g.add(t);
  }
  function lights(g: THREE.Group, spec: DressSpec) {
    const parts: MergePart[] = []; const wires: THREE.BufferGeometry[] = []; const bulb = new THREE.SphereGeometry(NIGHT.bulb.size, 8, 6); const col = new THREE.Color(1, 1, 1);
    spec.lights.forEach((l) => { const pts: THREE.Vector3[] = []; for (let i = 0; i <= l.n; i++) { const t = i / l.n; pts.push(new THREE.Vector3(l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t - l.sag * 4 * t * (1 - t), l.a[2] + (l.b[2] - l.a[2]) * t)); }
      pts.forEach((p) => parts.push({ g: bulb, mtx: mtx(p.x, p.y - 0.03, p.z), col })); wires.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), l.n * 3, 0.005, 4, false)); });
    if (!parts.length) return; const bm = new THREE.Mesh(merge(parts), M.lamp); g.add(bm);
    const wm = new THREE.Mesh(merge(wires.map((w) => ({ g: w, mtx: new THREE.Matrix4(), col }))), M.ink); g.add(wm);
  }
  function garden(g: THREE.Group, id: SectionId, spec: DressSpec) {
    const R = rng('garden' + id); const parts: MergePart[] = []; const G = spec.garden; const gm = [0x55663d, 0x66794a, 0x4c5d37]; const fc = [0xe8c27a, 0xc9a0b8, 0xf2ead8, 0xd98a6a];
    const blob = new THREE.IcosahedronGeometry(0.17, 1); const flower = new THREE.IcosahedronGeometry(0.045, 1);
    const hedge = (x: number, z: number) => parts.push({ g: blob, mtx: mtx(x, 0.16, z, 0, R() * 6, 0, 0.9 + R() * 0.5, 0.8 + R() * 0.4, 0.9 + R() * 0.5), col: new THREE.Color(gm[Math.floor(R() * 3)]) });
    if (spec.kind === 'ring') {
      const dirs = [...Object.values(PLOTS), SIGN].map((p) => Math.atan2(p.z, p.x)); const n = 56;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; if (dirs.some((d) => Math.abs(Math.atan2(Math.sin(a - d), Math.cos(a - d))) < 0.3)) continue; hedge(Math.cos(a) * G.w, Math.sin(a) * G.w); if (i % 2) parts.push({ g: flower, mtx: mtx(Math.cos(a) * (G.w - 0.28), 0.1, Math.sin(a) * (G.w - 0.28)), col: new THREE.Color(fc[i % 4]) }); }
    } else {
      for (let x = -G.w / 2; x <= G.w / 2 + 0.01; x += 0.28) { hedge(G.x + x, G.z - G.d / 2); }
      for (let z = -G.d / 2; z <= G.d / 2 + 0.01; z += 0.28) { hedge(G.x - G.w / 2, G.z + z); hedge(G.x + G.w / 2, G.z + z); }
      for (let i = 0; i < 26; i++) parts.push({ g: flower, mtx: mtx(G.x + (R() - 0.5) * (G.w - 0.5), 0.1, G.z + (R() - 0.5) * (G.d - 0.4), 0, 0, 0, 0.8 + R() * 0.8), col: new THREE.Color(fc[i % 4]) });
      g.add(B(G.w - 0.4, 0.03, G.d - 0.4, M.path, G.x, 0.04, G.z, 1));
    }
    const m = new THREE.Mesh(merge(parts), M.foliage); m.castShadow = m.receiveShadow = true; g.add(m);
  }
  /** Dress a built group (already finished) for its level; returns the extra label height. */
  return function dress(g: THREE.Group, id: SectionId, level: BuildingLevel, rm: THREE.Material): number {
    const spec = BUILDING_GROWTH[id]; if (level < 2) return 0;
    wing(g, spec.wing, rm); spec.banners.forEach((b, i) => banner(g, i, b.x, b.y, b.z, b.ry));
    if (level < 3) return 0;
    turret(g, spec.tower, rm); lights(g, spec); garden(g, id, spec); return spec.anchorBoost;
  };
}
export type Dress = ReturnType<typeof createDress>;
