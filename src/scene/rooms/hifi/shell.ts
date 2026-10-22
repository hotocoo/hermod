import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLibrary } from '../../assets/loader';
import type { Opening, Shell, Wall } from './layoutTypes';
import { geometryFrom, quad, sweepProfile, worldUV } from './uv';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const U_SIGN: Record<Wall, number> = { n: 1, s: -1, e: 1, w: -1 };
export const WALL_ROT: Record<Wall, number> = { n: 0, s: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 };
/** Reveal depth of window and door openings (wall thickness). */
const REVEAL = 0.28;

/** Wall-local (u along wall, v up, inward normal +z) to room coordinates. */
function wallToRoom(wall: Wall, s: Shell) {
  const rot = WALL_ROT[wall]; const c = Math.cos(rot), sn = Math.sin(rot);
  const o = wall === 'n' ? [0, -s.d / 2] : wall === 's' ? [0, s.d / 2] : wall === 'e' ? [s.w / 2, 0] : [-s.w / 2, 0];
  return (u: number, v: number, z = 0) => V(o[0] + u * c + z * sn, v, o[1] - u * sn + z * c);
}

export interface TileSizes { floor: number; wall: number; trim: number; ceiling: number; wainscot: number; beam: number }

/** Builds the empty room: floor, ceiling, walls with real openings and reveals, baseboard/crown profiles, beams. Returns meshes per material. */
/** Stored lightmap is irradiance / 4 (8-bit); this restores it. */
const LM_GAIN = 4;
export interface ShellPart { name: string; material: string; geometry: THREE.BufferGeometry }
/** Pure geometry of the empty room (world-scale UV0), one part per surface role. Used at runtime and by the offline lightmap bake. */
export function shellParts(s: Shell, tileOf: (id: string) => number): ShellPart[] {
  const parts: ShellPart[] = [];
  const tile = tileOf;
  const [floorM, wallM, trimM, ceilM, wainM, beamM] = [s.floor, s.wall, s.trim, s.ceiling, s.wainscot?.material ?? s.wall, s.beams?.material ?? s.trim];
  const addMesh = (g: THREE.BufferGeometry, m: string, t: number, name: string) => { parts.push({ name, material: m, geometry: worldUV(g, t) }); };

  // floor and ceiling (normal up / down)
  const fp: number[] = []; quad(fp, V(-s.w / 2, 0, s.d / 2), V(s.w / 2, 0, s.d / 2), V(s.w / 2, 0, -s.d / 2), V(-s.w / 2, 0, -s.d / 2)); addMesh(geometryFrom(fp), floorM, tile(s.floor), 'floor');
  const cp: number[] = []; quad(cp, V(-s.w / 2, s.h, -s.d / 2), V(s.w / 2, s.h, -s.d / 2), V(s.w / 2, s.h, s.d / 2), V(-s.w / 2, s.h, s.d / 2)); addMesh(geometryFrom(cp), ceilM, tile(s.ceiling), 'ceiling');

  // walls: a grid of cells split at every opening edge and the wainscot line; cells inside an opening are left out
  const wallPos: number[] = []; const wainPos: number[] = []; const reveals: number[] = [];
  (['n', 's', 'e', 'w'] as Wall[]).forEach((wall) => {
    const len = wall === 'n' || wall === 's' ? s.w : s.d; const to = wallToRoom(wall, s);
    const ops = s.openings.filter((o) => o.wall === wall).map((o: Opening) => ({ u0: U_SIGN[wall] * o.at - o.w / 2, u1: U_SIGN[wall] * o.at + o.w / 2, v0: o.sill, v1: o.sill + o.h }));
    const us = [...new Set([-len / 2, len / 2, ...ops.flatMap((o) => [o.u0, o.u1])])].sort((a, b) => a - b);
    const wh = s.wainscot?.h ?? 0; const vs = [...new Set([0, s.h, ...(wh ? [wh] : []), ...ops.flatMap((o) => [o.v0, o.v1])])].sort((a, b) => a - b);
    for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
      const um = (us[i] + us[i + 1]) / 2, vm = (vs[j] + vs[j + 1]) / 2;
      if (ops.some((o) => um > o.u0 && um < o.u1 && vm > o.v0 && vm < o.v1)) continue;
      quad(vm < wh ? wainPos : wallPos, to(us[i], vs[j]), to(us[i + 1], vs[j]), to(us[i + 1], vs[j + 1]), to(us[i], vs[j + 1]));
    }
    for (const o of ops) { // jambs, head and sill facing into the opening
      const A = (u: number, v: number) => to(u, v, 0), B = (u: number, v: number) => to(u, v, -REVEAL);
      quad(reveals, A(o.u0, o.v0), B(o.u0, o.v0), B(o.u0, o.v1), A(o.u0, o.v1)); quad(reveals, B(o.u1, o.v0), A(o.u1, o.v0), A(o.u1, o.v1), B(o.u1, o.v1));
      quad(reveals, A(o.u0, o.v1), B(o.u0, o.v1), B(o.u1, o.v1), A(o.u1, o.v1)); if (o.v0 > 0) quad(reveals, B(o.u0, o.v0), A(o.u0, o.v0), A(o.u1, o.v0), B(o.u1, o.v0));
    }
  });
  addMesh(geometryFrom(wallPos), wallM, tile(s.wall), 'walls');
  if (wainPos.length) addMesh(geometryFrom(wainPos), wainM, tile(s.wainscot!.material), 'wainscot');
  if (reveals.length) addMesh(geometryFrom(reveals), trimM, tile(s.trim), 'reveals');

  // moulding profiles swept along the room perimeter; skirting is cut at doors by leaving the profile in place (door leaf covers it)
  const path: [number, number][] = [[-s.w / 2, -s.d / 2], [s.w / 2, -s.d / 2], [s.w / 2, s.d / 2], [-s.w / 2, s.d / 2]];
  const inward = (mid: THREE.Vector2) => new THREE.Vector2(-mid.x, -mid.y).normalize();
  const { h: bh, d: bd } = s.baseboard;
  const base: [number, number][] = [[0, 0], [bd, 0], [bd, bh * 0.82], [bd * 0.55, bh * 0.9], [bd * 0.4, bh]];
  const baseG = sweepProfile([[0, 0], [bd, 0], [bd, bh * 0.82], [bd * 0.6, bh * 0.88], [bd * 0.45, bh], [0, bh]], path, 0, inward); void base;
  addMesh(baseG, trimM, tile(s.trim), 'baseboard');
  if (s.crown) { const { h: ch, d: cd } = s.crown; addMesh(sweepProfile([[0, 0], [cd * 0.35, 0], [cd * 0.45, ch * 0.2], [cd, ch * 0.75], [cd, ch], [0, ch]].map(([d, h]) => [d, h - ch] as [number, number]), path, s.h, inward), trimM, tile(s.trim), 'crown'); }
  if (s.wainscot) { const wh = s.wainscot.h; addMesh(sweepProfile([[0, 0], [0.035, 0], [0.04, 0.02], [0.03, 0.045], [0, 0.05]].map(([d, h]) => [d, h] as [number, number]), path, wh - 0.01, inward), trimM, tile(s.trim), 'rail'); }

  // ceiling beams: bevelled timbers with real chamfers
  if (s.beams) { // beams run along `axis` and repeat across the other one
    const { every, size, axis } = s.beams; const len = axis === 'x' ? s.w : s.d; const span = axis === 'x' ? s.d : s.w; const bparts: THREE.BufferGeometry[] = [];
    const c = 0.018; const [bw, bhh] = size; const prof = new THREE.Shape(); prof.moveTo(-bw / 2 + c, 0); prof.lineTo(bw / 2 - c, 0); prof.lineTo(bw / 2, c); prof.lineTo(bw / 2, bhh - c); prof.lineTo(bw / 2 - c, bhh); prof.lineTo(-bw / 2 + c, bhh); prof.lineTo(-bw / 2, bhh - c); prof.lineTo(-bw / 2, c); prof.closePath();
    for (let p = -span / 2 + every / 2; p < span / 2; p += every) {
      const g = new THREE.ExtrudeGeometry(prof, { depth: len - 0.1, bevelEnabled: false }); g.translate(0, s.h - bhh, -(len - 0.1) / 2);
      if (axis === 'x') { g.rotateY(Math.PI / 2); g.translate(0, 0, p); } else g.translate(p, 0, 0);
      bparts.push(g);
    }
    if (bparts.length) { const m = mergeGeometries(bparts.map((g) => g.index ? g.toNonIndexed() : g), false); bparts.forEach((g) => g.dispose()); if (m) addMesh(m, beamM, tile(s.beams.material), 'beams'); }
  }
  return parts;
}

/** Runtime shell: baked glb (with UV2 lightmap) when the room has one, else live geometry. Materials come from the shared PBR cache. */
/** Strips a few centimetres wide: their lightmap islands are smaller than a texel margin, so they pick up light from neighbouring islands (ragged white streaks along the crown). They are lit by the room lights only. */
const THIN_TRIM = /crown|baseboard|rail|cap|reveal/i;
export async function buildShell(s: Shell, lib: AssetLibrary, signal?: AbortSignal, baked?: { parts: ShellPart[]; lightMap?: THREE.Texture }): Promise<{ group: THREE.Group; dispose: () => void }> {
  const man = await lib.manifest(); const tile = (id: string) => man.materials[id]?.tileM || 1;
  // the baked shell predates the beam fix (beams hung outside the walls, coplanar with them, and stopped short of the end walls): always rebuild them from the layout; they carry no lightmap
  const fresh = baked ? shellParts(s, tile).find((p) => p.name === 'beams') : undefined;
  const parts = baked ? baked.parts.map((p) => (p.name === 'beams' && fresh ? fresh : p)) : shellParts(s, tile); const ids = [...new Set(parts.map((p) => p.material))];
  const mats = new Map(await Promise.all(ids.map(async (id) => [id, await lib.material(id, {}, signal)] as const)));
  const group = new THREE.Group(); const geos: THREE.BufferGeometry[] = []; const own: THREE.Material[] = [];
  for (const p of parts) {
    let m = mats.get(p.material)!;
    if (baked?.lightMap && p.geometry.getAttribute('uv1') && !THIN_TRIM.test(p.name)) { m = m.clone(); m.lightMap = baked.lightMap; m.lightMapIntensity = LM_GAIN; own.push(m); }
    geos.push(p.geometry); const mesh = new THREE.Mesh(p.geometry, m); mesh.name = p.name; mesh.receiveShadow = true; group.add(mesh);
  }
  return { group, dispose: () => { geos.forEach((g) => g.dispose()); own.forEach((m) => m.dispose()); mats.forEach((m) => lib.releaseMaterial(m)); } };
}

