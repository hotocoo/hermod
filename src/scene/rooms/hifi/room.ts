import * as THREE from 'three';
import type { AssetLibrary, Figure, ModelAsset } from '../../assets/loader';
import { rng } from '../../rng';
import type { ModelEntry } from '../../assets/types';
import type { InteriorPaint, InteriorRoom, PaintColumn, PaintLine } from '../../interiors';
import { paintNotes, type NoteBoard } from '../paint';
import type { ContentBind, RoomLayout } from './layoutTypes';
import { ARTWORKS, artOrder, loadArt, paintFrame, type Artwork } from './art';
import { prepare } from './prepare';
import { buildShell, WALL_ROT } from './shell';
import { occupiedSeats, seatSurface, solve, type Catalog, type Placement, type Solved } from './solver';

/** Soft scuff/grime alpha texture (value noise, dark brown): authored per room seed, tiny (256 px). */
function wearTexture(R: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!; x.clearRect(0, 0, 256, 256);
  const g = x.createRadialGradient(128, 128, 10, 128, 128, 128); g.addColorStop(0, 'rgba(40,28,18,0.55)'); g.addColorStop(0.6, 'rgba(40,28,18,0.18)'); g.addColorStop(1, 'rgba(40,28,18,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(0,0,0,${0.15 + R() * 0.5})`; x.beginPath(); x.ellipse(R() * 256, R() * 256, 1 + R() * 9, 0.6 + R() * 2.2, R() * 3.14, 0, 6.3); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const INSTANCE_MIN = 4;

/** Unique geometry + material per baked piece: UV2 moved into the piece's tile of the room's furniture atlas. */
function applyFurnitureLightmap(root: THREE.Object3D, tile: [number, number, number], map: THREE.Texture) {
  const [u0, v0, sz] = tile;
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return; const uv1 = m.geometry.getAttribute('uv1'); if (!uv1) return;
    const g = m.geometry.clone(); const a = g.getAttribute('uv1'); const out = new Float32Array(a.count * 2);
    for (let i = 0; i < a.count; i++) { out[i * 2] = u0 + (0.02 + 0.96 * a.getX(i)) * sz; out[i * 2 + 1] = v0 + (0.02 + 0.96 * a.getY(i)) * sz; }
    g.setAttribute('uv1', new THREE.BufferAttribute(out, 2)); m.geometry = g;
    const mat = (m.material as THREE.MeshStandardMaterial).clone(); mat.lightMap = map; mat.lightMapIntensity = 4; mat.aoMap = null; /* the asset's own AO lives in UV2, which the atlas tile just replaced: sampling it with atlas coordinates blackened whole pieces */ m.material = mat;
  });
}

/** Room glass is thin panes and small vessels: screen-space transmission would re-render every opaque object of the room into a second target each frame, so panes become alpha-blended glass that keeps the HDRI reflection and clearcoat-grade specular. */
function flatGlass(m: THREE.MeshPhysicalMaterial) {
  if (!m.isMeshPhysicalMaterial || !(m.transmission > 0)) return;
  m.transmission = 0; m.thickness = 0; m.transmissionMap = null; m.thicknessMap = null; m.transparent = true; m.opacity = Math.min(m.opacity, 0.3); m.depthWrite = false; m.roughness = Math.min(m.roughness, 0.08); m.specularIntensity = 1; m.needsUpdate = true;
}
const seatRay = new THREE.Raycaster(); const seatTops = new Map<string, number>();
/** Real seat-top height of a piece at local x: downward rays through its LOD0 mesh (median of three), so cushions and carved seats are measured, not guessed. Falls back to the manifest surface. */
function seatTop(a: ModelAsset, lx: number): number | undefined {
  const sf = seatSurface(a.entry); const lod = a.lods[0]; if (!sf || !lod) return sf?.y;
  const key = `${a.entry.id}|${lx.toFixed(2)}`; const hit = seatTops.get(key); if (hit !== undefined) return hit;
  lod.updateMatrixWorld(true); const zc = (sf.min[1] + sf.max[1]) / 2, dz = (sf.max[1] - sf.min[1]) * 0.2; const ys: number[] = [];
  for (const k of [-1, 0, 1]) { seatRay.set(new THREE.Vector3(lx, sf.y + 0.3, zc + k * dz), new THREE.Vector3(0, -1, 0)); seatRay.far = 0.45; const h = seatRay.intersectObject(lod, true)[0]; if (h) ys.push(h.point.y); }
  const top = ys.length ? ys.sort((p, q) => p - q)[ys.length >> 1] : sf.y; seatTops.set(key, top); return top;
}

/** The sandstone set carries lichen that reads olive under warm room light: pull green and yellow out of the albedo so the fireplace reads as plain sandstone. */
const STONE_TINT: [number, number, number] = [1, 0.9, 1.22];
function tintStone(root: THREE.Object3D) { root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.isMeshStandardMaterial && m.map) m.color.setRGB(...STONE_TINT); }); }

interface Target { bind: ContentBind; mats: THREE.MeshStandardMaterial[]; canvases: HTMLCanvasElement[]; textures: THREE.CanvasTexture[]; aspect: number; arts: Artwork[]; imgs: (HTMLImageElement | null)[] }

/** Width / height of the painted face in the object's own upright frame (x across, y up), so canvases are not stretched whichever way the face is oriented. */
function slotAspect(root: THREE.Object3D, m: THREE.Material): number {
  root.updateWorldMatrix(true, true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); const box = new THREE.Box3(); const mm = new THREE.Matrix4();
  root.traverse((o) => { const mesh = o as THREE.Mesh; if (!mesh.isMesh || mesh.material !== m) return; mesh.geometry.computeBoundingBox(); box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mm.multiplyMatrices(inv, mesh.matrixWorld))); });
  if (box.isEmpty()) return 1; const s = box.getSize(new THREE.Vector3()); return Math.min(5, Math.max(0.2, s.x / Math.max(1e-4, s.y)));
}

function poster(c: HTMLCanvasElement, text: string, who: string, hue: number) {
  const x = c.getContext('2d')!; const W = c.width, H = c.height;
  const g = x.createLinearGradient(0, 0, W * 0.3, H); g.addColorStop(0, `hsl(${hue},26%,70%)`); g.addColorStop(1, `hsl(${(hue + 34) % 360},30%,38%)`); x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,.88)'; const fs = Math.round(W / 14); x.font = `600 ${fs}px "Cormorant Garamond", Georgia, serif`;
  const words = text.split(' '); const lines: string[] = []; let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (x.measureText(t).width > W * 0.84 && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  lines.slice(0, 5).forEach((l, i) => x.fillText(l, W * 0.08, H * 0.2 + i * fs * 1.18));
  x.font = `500 ${Math.round(fs * 0.55)}px Lora, Georgia, serif`; x.fillStyle = 'rgba(255,255,255,.7)'; x.fillText(who.toUpperCase(), W * 0.08, H * 0.92);
}

/** First paint before real data arrives: an honest empty surface (cork, plain wall tone, slate), never a black hole. */
function defaultFace(feed: ContentBind['feed'], c: HTMLCanvasElement) {
  const x = c.getContext('2d')!; x.fillStyle = feed === 'chalk' ? '#23282a' : feed === 'frames' ? '#cfc4b0' : '#b8956a'; x.fillRect(0, 0, c.width, c.height);
}
function chalk(c: HTMLCanvasElement, lines: string[]) {
  const x = c.getContext('2d')!; x.fillStyle = '#23282a'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = 'rgba(240,238,228,.9)'; const fs = Math.round(c.width / 16); x.font = `${fs}px "Cormorant Garamond", Georgia, serif`;
  lines.slice(0, 9).forEach((l, i) => x.fillText(l, c.width * 0.07, c.height * 0.14 + i * fs * 1.25, c.width * 0.86));
}

/**
 * Turns a solved layout into a live room: PBR shell, authored assets (instanced where repeated), practical lights from
 * asset emitters, content canvases in manifest slots, and seats filled with the real online count.
 */
export async function buildRoom(layout: RoomLayout, lib: AssetLibrary, seed: string, online: () => number): Promise<InteriorRoom> {
  const lease = lib.lease(); const man = await lib.manifest(); const catalog = man.models as unknown as Catalog;
  const L = prepare(layout, catalog); const solved: Solved = solve(L, catalog, seed);
  if (solved.rejected.length) console.warn(`room ${L.id}: ${solved.rejected.length} placements found no valid spot`);
  const group = new THREE.Group(); const disposables: (() => void)[] = [];
  try {
    const ids = [...new Set([...solved.placements.map((p) => p.asset), ...L.shell.openings.flatMap((o) => (o.asset ? [o.asset] : [])), ...L.presence.traces, ...L.presence.figures])];
    const assets = new Map<string, ModelAsset>(await Promise.all(ids.map(async (id) => [id, await lease.model(id)] as [string, ModelAsset])));
    const baked = await lib.bakedRoom(L.section, lease.signal);
    const lmIdx = new Map<string, number>(); { let n = 0; for (const p of solved.placements) if (p.kind !== 'surface' && (catalog[p.asset] as unknown as { source?: { lightmap?: boolean } }).source?.lightmap) lmIdx.set(p.key, n++); } const shell = await buildShell(L.shell, lib, lease.signal, baked ?? undefined); group.add(shell.group); disposables.push(shell.dispose);

    // environment: the room's HDRI as reflections and as the view through windows
    const hdr = await lib.hdri(L.shell.hdri, lease.signal); const pm = new THREE.PMREMGenerator(lib.renderer); const env = pm.fromEquirectangular(hdr).texture; pm.dispose();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), new THREE.MeshBasicMaterial({ map: hdr, side: THREE.BackSide, depthWrite: false, fog: false }));
    dome.renderOrder = -1; dome.position.y = L.shell.h * 0.5; group.add(dome); disposables.push(() => { dome.geometry.dispose(); (dome.material as THREE.Material).dispose(); hdr.dispose(); env.dispose(); });

    const targets: Target[] = []; const slotHolders = new Map<string, THREE.Object3D[]>();
    const place = (o: THREE.Object3D, p: { pos: [number, number, number]; rotY: number }) => { o.position.set(...p.pos); o.rotation.y = p.rotY; group.add(o); };

    // openings: window / door assets sit in their reveal
    for (const o of L.shell.openings) {
      if (!o.asset) continue; const a = assets.get(o.asset)!; const { object } = lib.spawn(a); const rot = WALL_ROT[o.wall]; const sgn = o.wall === 's' || o.wall === 'w' ? -1 : 1;
      const u = sgn * o.at; const c = Math.cos(rot), s = Math.sin(rot); const wx = o.wall === 'e' ? L.shell.w / 2 : o.wall === 'w' ? -L.shell.w / 2 : 0; const wz = o.wall === 'n' ? -L.shell.d / 2 : o.wall === 's' ? L.shell.d / 2 : 0;
      const depth = -a.entry.footprint.d / 2;
      object.position.set(wx + u * c + depth * s, o.sill, wz - u * s + depth * c); object.rotation.y = rot; group.add(object);
    }

    // placements: instanced where an asset repeats and has no content slot, otherwise LOD objects
    const by = new Map<string, Placement[]>(); solved.placements.forEach((p) => by.set(p.asset, [...(by.get(p.asset) ?? []), p]));
    const objectOf = new Map<string, THREE.Object3D>(); const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
    for (const [id, list] of by) {
      const a = assets.get(id)!;
      if (list.length >= INSTANCE_MIN && !a.slotNames.length && !list.some((p) => lmIdx.has(p.key))) {
        const mats = list.map((p) => m4.clone().compose(new THREE.Vector3(...p.pos), q.setFromEuler(e.set(0, p.rotY, 0)), new THREE.Vector3(1, 1, 1)));
        const g = lib.instanced(a, mats); group.add(g); continue;
      }
      for (const p of list) { const sp = lib.spawn(a); if (id === 'hearth_stone') tintStone(sp.object); const ti = baked?.furnitureMap ? baked.tiles.get(lmIdx.get(p.key) ?? -1) : undefined; if (ti) applyFurnitureLightmap(sp.object, ti, baked!.furnitureMap!); place(sp.object, p); objectOf.set(p.key, sp.object); for (const n of Object.keys(sp.slots)) { const k = `${id}:${n}`; slotHolders.set(k, [...(slotHolders.get(k) ?? []), sp.object]); } void sp.slots; (sp.object.userData.slots = sp.slots); }
    }

    // content slots (named in the manifest, bound in the layout)
    const artSeq = artOrder(`${seed}|${L.id}`); const artCount = ARTWORKS.length; let artN = 0; let lastLines: PaintLine[] = []; let roomGone = false; disposables.push(() => { roomGone = true; });
      let hasNotes = false; // a notice board with nothing pinned yet hangs a painting; real notes replace it the moment they arrive
      const drawFrame = (t: Target, i: number) => { const img = t.imgs[i]; if (!img) return; const it = lastLines[i]; const ar = t.arts[i]; paintFrame(t.canvases[i], img, ar, t.bind.feed === 'notes' ? `${ar.artist}, ${ar.title}` : it ? it.text || it.label || '' : ''); t.textures[i].needsUpdate = true; };
      for (const bind of L.content) {
      const list = (by.get(bind.asset) ?? []).map((p) => objectOf.get(p.key)).filter((o): o is THREE.Object3D => !!o);
      if (!list.length) continue; const entry = catalog[bind.asset] as unknown as ModelEntry;
      if (!entry.slots?.[bind.slot]) throw new Error(`layout ${L.id}: ${bind.asset} has no slot ${bind.slot} in the manifest`);
      const t: Target = { bind, mats: [], canvases: [], textures: [], aspect: 1, arts: [], imgs: [] };
      list.forEach((o) => {
        const sm = (o.userData.slots as Record<string, THREE.MeshStandardMaterial>)[bind.slot]; if (!sm) return;
        t.aspect = slotAspect(o, sm); const cv = document.createElement('canvas'); const cw = bind.feed === 'frames' ? Math.min(bind.px, 1024) : bind.px; cv.width = cw; cv.height = Math.max(64, Math.round(cw / t.aspect));
        const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.flipY = false; tx.anisotropy = lib.renderer.capabilities.getMaxAnisotropy();
        defaultFace(bind.feed, cv); tx.needsUpdate = true;
          if (bind.feed === 'frames' || bind.feed === 'notes') { // real painting per frame; live text (when present) rides on a caption plaque
            const i = t.canvases.length; const art = artSeq[artN++ % artCount]; t.arts.push(art); t.imgs.push(null);
            void loadArt(lib.highUrl(`rooms/art/${art.file}`)).then((img) => { if (!img || roomGone) return; t.imgs[i] = img; if (bind.feed === 'frames' || !hasNotes) drawFrame(t, i); });
          }
        sm.map = tx; sm.side = THREE.DoubleSide; sm.color.set(0xffffff); sm.metalness = 0; sm.roughness = 0.85; sm.metalnessMap = null; sm.roughnessMap = null; sm.normalMap = null; sm.aoMap = null; sm.needsUpdate = true; t.mats.push(sm); t.canvases.push(cv); t.textures.push(tx);
      });
      targets.push(t); disposables.push(() => t.textures.forEach((x) => x.dispose()));
    }

    // environment on every PBR material in the room
      // anisotropic filtering on every model map: GLTFLoader leaves it at 1, which turns the rug weave and plank grain into moire at grazing angles
      const aniso = Math.min(8, lib.renderer.capabilities.getMaxAnisotropy()); // 8x kills the moire; 16x costs more fill for no visible gain at room camera angles
      const sharpen = (m: THREE.MeshStandardMaterial) => { for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'] as const) { const tx = m[k]; if (tx && tx.anisotropy < aniso) { tx.anisotropy = aniso; tx.needsUpdate = true; } } };
    const applyEnv = (root: THREE.Object3D) => root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => { const s = mm as THREE.MeshStandardMaterial; if (s.isMeshStandardMaterial) { s.envMap = env; s.envMapIntensity = L.lights.env; sharpen(s); flatGlass(s as THREE.MeshPhysicalMaterial); } }); });
    applyEnv(group);

    // practical lights from asset emitters
    const kinds = Object.keys(L.lights.kinds); const lights: { l: THREE.Light; base: number; flick: number; seed: number }[] = [];
    const picked = [...solved.emitters].filter((e2) => L.lights.kinds[e2.kind]).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || (a.key < b.key ? -1 : 1)).slice(0, L.lights.maxLights);
    let shadows = 0;
    picked.forEach((em, i) => {
      const k = L.lights.kinds[em.kind]; const l = new THREE.PointLight(new THREE.Color(k.color), k.intensity, k.distance, k.decay);
      l.position.set(...em.pos); if (k.cast && shadows < L.lights.shadowLights) { l.userData.shadowCandidate = true; shadows++; } group.add(l); lights.push({ l, base: k.intensity, flick: k.flicker ?? 0, seed: i * 1.7 });
    });
    for (const o of baked ? [] : L.shell.openings.filter((x) => x.kind === 'window')) {
      const w = L.lights.window; const sgn = o.wall === 's' || o.wall === 'w' ? -1 : 1; const u = sgn * o.at; const rot = WALL_ROT[o.wall]; const c = Math.cos(rot), s = Math.sin(rot);
      const wx = o.wall === 'e' ? L.shell.w / 2 : o.wall === 'w' ? -L.shell.w / 2 : 0; const wz = o.wall === 'n' ? -L.shell.d / 2 : o.wall === 's' ? L.shell.d / 2 : 0;
      const sp = new THREE.SpotLight(new THREE.Color(w.color), w.intensity, w.distance, 1.0, 0.8, 1.2); sp.position.set(wx + u * c - 0.5 * s, o.sill + o.h / 2, wz - u * s - 0.5 * c);
      sp.target.position.set(wx + u * c + 3 * s, 0.4, wz - u * s + 3 * c); group.add(sp, sp.target);
    }
    group.add(new THREE.HemisphereLight(new THREE.Color(L.lights.fill.sky), new THREE.Color(L.lights.fill.ground), L.lights.fill.intensity));

    // wear: deterministic scuff and grime decals where feet and chairs travel (under tables, in front of hearth/doors), soft transparent planes just above the floor
    { const R2 = rng(`wear|${seed}|${L.id}`); const tex = wearTexture(R2); const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0.55, fog: false });
      const spots: [number, number, number][] = []; solved.placements.filter((p) => p.kind === 'floor' && !p.under && /table|desk|bench|sofa|hearth|chair|loom/i.test(p.asset)).forEach((p) => spots.push([p.pos[0], p.pos[2], Math.max(catalog[p.asset].footprint.w, catalog[p.asset].footprint.d) * 1.5 + 0.6]));
      L.shell.openings.filter((o) => !o.asset).forEach(() => undefined);
      spots.forEach(([x, z, sz]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), mat); m.rotation.set(-Math.PI / 2, 0, R2() * Math.PI * 2); m.position.set(x, 0.006 + R2() * 0.002, z); m.renderOrder = 1; group.add(m); disposables.push(() => m.geometry.dispose()); });
      disposables.push(() => { tex.dispose(); mat.dispose(); }); }

    // presence: figure or trace props at occupied seats; refilled live
    let traces: THREE.Object3D[] = []; let figs: Figure[] = [];
    const camPos = new THREE.Vector3(...L.cam.cam);
    const presence = (n: number) => {
      traces.forEach((t) => t.removeFromParent()); figs.forEach((f) => { f.object.removeFromParent(); f.dispose(); }); traces = []; figs = [];
      const R = rng(`pose|${seed}|${L.id}`);
      occupiedSeats(solved, n, seed).forEach((s, i) => {
        const fa = assets.get(L.presence.figures[i % Math.max(1, L.presence.figures.length)]);
        if (fa?.figure) {
          const f = lib.spawnFigure(fa); const pool = s.tableY ? L.presence.clips.table : L.presence.clips.free; f.play(pool[Math.floor(R() * pool.length)], 0);
          const depthC = catalog[s.asset]?.footprint.d ?? 0.5; const back = Math.max(0, Math.min(0.2, 0.05 + 0.18 * (depthC - 0.5))); // deeper seats: sit further forward off the backrest
          const ca = assets.get(s.asset); const sf = seatSurface(catalog[s.asset]); const top = ca && sf ? (seatTop(ca, s.lx) ?? sf.y) : s.pos[1]; const sitY = s.pos[1] - (sf?.y ?? 0) + top; f.object.position.set(s.pos[0] + Math.sin(s.rotY) * back, sitY - (fa.entry.figure?.seatHeight ?? 0.45) - (catalog[s.asset]?.tags.includes('soft') ? 0.03 : 0), s.pos[2] + Math.cos(s.rotY) * back); f.object.rotation.y = s.rotY; group.add(f.object); applyEnv(f.object); figs.push(f);
        }
        const id = L.presence.traces[i % Math.max(1, L.presence.traces.length)]; const a = id ? assets.get(id) : undefined; if (!a || !s.tableY) return;
        const f = [Math.sin(s.rotY), Math.cos(s.rotY)]; const o = lib.spawn(a).object; const reach = 0.42;
        o.position.set(s.pos[0] + f[0] * reach, s.tableY, s.pos[2] + f[1] * reach); o.rotation.y = s.rotY + (i % 3) * 0.7; group.add(o); applyEnv(o); traces.push(o);
      });
    };

    const paint = (data: InteriorPaint) => {
      const arr = data as (PaintLine & Partial<PaintColumn>)[]; const cols = arr.length && arr[0].cards ? (data as PaintColumn[]) : null; const lines = (cols ? [] : (data as PaintLine[])); if (!cols) hasNotes = lines.length > 0;
      for (const t of targets) {
        t.canvases.forEach((cv, i) => {
          const tx = t.textures[i];
          if (t.bind.feed === 'notes' && !cols) { if (!lines.length && t.imgs[i]) drawFrame(t, i); else paintNotes({ c: cv, tx } as unknown as NoteBoard, lines, { grid: 3 }); }
          else if (t.bind.feed === 'columns' && cols) paintNotes({ c: cv, tx } as unknown as NoteBoard, [], { cols });
          else if (t.bind.feed === 'frames' && !cols) { lastLines = lines; const it = lines[i]; if (t.imgs[i]) drawFrame(t, i); else if (it) poster(cv, it.text || it.label || '', it.who || '', 20 + i * 47); }
          else if (t.bind.feed === 'chalk' && !cols) chalk(cv, lines.map((l) => l.text || l.label || ''));
          tx.needsUpdate = true;
        });
      }
    };

    let lastT = 0, acc = 0, tickN = 0; const frus = new THREE.Frustum(), pv = new THREE.Matrix4(), inv = new THREE.Matrix4(), ball = new THREE.Sphere(new THREE.Vector3(), 1.25); const room = group as unknown as InteriorRoom;
    room.userData = {
      cam: new THREE.Vector3(...L.cam.cam), look: new THREE.Vector3(...L.cam.look), paint, presence,
      tick: (t: number, cam?: THREE.Camera) => { acc += Math.min(0.1, Math.max(0, t - lastT)); lastT = t; if (++tickN % 2 === 0) { const dt = acc; acc = 0; // idle clips need 30 Hz at most
        if (cam) { cam.updateMatrixWorld(); frus.setFromProjectionMatrix(pv.multiplyMatrices(cam.projectionMatrix, inv.copy(cam.matrixWorld).invert())); }
        // figures outside the view are hidden (their skinned meshes are never frustum culled) and their mixer is frozen
        group.updateWorldMatrix(true, false); figs.forEach((f) => { const p = f.object.position; ball.center.set(p.x, p.y + 0.9, p.z).applyMatrix4(group.matrixWorld); const seen = !cam || frus.intersectsSphere(ball); f.object.visible = seen; if (seen) f.update(dt, cam ? ball.center.distanceTo(cam.position) : p.distanceTo(camPos)); }); }
         lights.forEach((x) => { if (x.flick) (x.l as THREE.PointLight).intensity = x.base * (1 + x.flick * (Math.sin(t * 9 + x.seed) * 0.5 + Math.sin(t * 23.7 + x.seed * 3) * 0.3 + (Math.random() - 0.5) * 0.4)); }); },
      dispose: () => { figs.forEach((f) => f.dispose()); lease.release(); disposables.forEach((d) => d()); targets.length = 0; },
      solved,
    };
    presence(online());
    return room;
  } catch (err) { lease.release(); disposables.forEach((d) => d()); throw err; }
}
