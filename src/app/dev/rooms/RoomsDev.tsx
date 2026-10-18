'use client';
// Standalone render of authored-asset rooms. Query: ?room=chat&tier=high|ultra&seed=x&online=5
// window.__rooms: { ready, rooms, show(id, opts), record(ms) -> frame stats, stats() }
import { useEffect, useRef } from 'react';
import type * as T from 'three';

interface FrameStats { avgFps: number; low1pctFps: number; p99Ms: number; maxMs: number; frames: number }
declare global { interface Window { __rooms?: { ready: Promise<void>; rooms: string[]; show(id: string, o?: { online?: number; seed?: string; cam?: number[]; look?: number[] }): Promise<void>; record(ms: number): Promise<FrameStats>; debug(): unknown; hide(re: string): void; stats(): unknown; /** Seat poses of the shown room, for close-up cameras. */ seats(): { asset: string; pos: number[]; rotY: number }[]; /** Mesh and material facts of the placed asset (LOD0 first), optionally with `patch` applied to every material. */ probe(assetId: string, patch?: Record<string, unknown>): unknown; error?: string } } }

const SAMPLE = [
  { who: 'Mara', text: 'Ferry leaves at six, bring the lantern oil' }, { who: 'Tomas', text: 'Who has the key to the loft shelves?' }, { who: 'Ingrid', text: 'Soup is on, the good bread is still warm' },
  { who: 'Oskar', text: 'Snapshot of the harbour map is saved in the Loom' }, { who: 'Liv', text: 'Poster for the autumn fair is up in the Gallery' }, { who: 'Bram', text: 'Board: three cards moved to Done today' },
];

export default function RoomsDev() {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false; let off: (() => void) | null = null;
    (async () => {
      const THREE = await import('three');
      const { AssetLibrary } = await import('@/scene/assets/loader');
      const { buildRoom } = await import('@/scene/rooms/hifi/room');
      const { LAYOUTS } = await import('@/scene/rooms/hifi/register');
      if (dead || !mount.current) return;
      const qs = new URLSearchParams(window.location.search); const tier = (qs.get('tier') ?? 'high') as 'high' | 'ultra';
      const el = mount.current; const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1); r.setSize(el.clientWidth, el.clientHeight); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = Number(qs.get("exp") ?? 0.8); r.outputColorSpace = THREE.SRGBColorSpace; el.appendChild(r.domElement);
      const lib = new AssetLibrary({ renderer: r, tier }); const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0a09);
      const camera = new THREE.PerspectiveCamera(Number(qs.get('fov') ?? 55), el.clientWidth / el.clientHeight, 0.05, 200);
      let room: T.Group | null = null; let lease = 0; const stats = { current: '', buildMs: 0 };
      const api: NonNullable<Window['__rooms']> = {
        ready: Promise.resolve(), rooms: Object.keys(LAYOUTS),
        async show(id, o = {}) {
          const my = ++lease; const t0 = performance.now(); const layout = LAYOUTS[id]; if (!layout) throw new Error('no layout ' + id);
          const next = await buildRoom(layout, lib, o.seed ?? qs.get('seed') ?? 'dev', () => o.online ?? Number(qs.get('online') ?? 6));
          if (my !== lease) { (next.userData.dispose as () => void)(); return; }
          if (room) { scene.remove(room); (room.userData.dispose as () => void)(); }
          room = next; scene.add(next); stats.current = id; stats.buildMs = Math.round(performance.now() - t0);
          const c = o.cam ?? next.userData.cam.toArray(), l = o.look ?? next.userData.look.toArray(); camera.position.set(c[0], c[1], c[2]); camera.lookAt(l[0], l[1], l[2]);
          next.traverse((n) => { const m = n as T.Mesh; if (m.isMesh) { m.receiveShadow = true; m.castShadow = true; } });
          let first = true; next.traverse((n) => { const p = n as T.PointLight; if (p.isPointLight) { p.castShadow = first && !!p.userData.shadowCandidate; if (p.castShadow) { p.shadow.mapSize.set(1024, 1024); p.shadow.bias = -0.0015; p.shadow.normalBias = 0.02; first = false; } } });
          (next.userData.paint as (d: unknown) => void)?.(SAMPLE);
          await r.compileAsync(next, camera);
        },
        record(ms) {
          return new Promise((res) => { const a: number[] = []; let last = performance.now(); const t0 = last; const f = (now: number) => { a.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else { a.shift(); const s = [...a].sort((x, y) => x - y); const avg = a.reduce((p, c) => p + c, 0) / a.length; const p99 = s[Math.floor(s.length * 0.99)]; res({ avgFps: +(1000 / avg).toFixed(1), low1pctFps: +(1000 / p99).toFixed(1), p99Ms: +p99.toFixed(1), maxMs: +s[s.length - 1].toFixed(1), frames: a.length }); } }; requestAnimationFrame(f); });
        },
        debug: () => { const out: unknown[] = []; room?.traverse((n) => { const m = n as T.Mesh; if (!m.isMesh) return; const mm = m.material as T.MeshStandardMaterial; if (/artwork/.test(mm.name)) out.push({ n: mm.name, op: mm.opacity, tp: mm.transparent, side: mm.side, vc: mm.vertexColors, nm: !!mm.normalMap, em: mm.emissive.getHexString(), env: mm.envMapIntensity, geo: m.geometry.getAttribute('position').count, uv: Array.from((m.geometry.getAttribute('uv') as T.BufferAttribute).array.slice(0, 6)), norm: Array.from((m.geometry.getAttribute('normal') as T.BufferAttribute).array.slice(0, 3)), vis: m.visible, tex: mm.map ? [mm.map.flipY, mm.map.colorSpace] : null }); }); return out; },
        hide: (re: string) => { room?.traverse((n) => { const m = n as T.Mesh; if (m.isMesh && new RegExp(re).test((m.material as T.Material).name)) m.visible = false; }); },
        probe: (assetId, patch) => { const out: unknown[] = []; room?.traverse((o) => { if ((o.userData as { assetId?: string }).assetId !== assetId) return; o.traverse((n) => { const m = n as T.Mesh; if (!m.isMesh) return; const mat = m.material as T.MeshStandardMaterial; if (patch) { Object.assign(mat, patch); mat.needsUpdate = true; } out.push({ lodVisible: m.parent?.visible, name: m.name, mat: mat.name, color: mat.color?.getHexString(), map: !!mat.map, lightMap: !!mat.lightMap, lmI: mat.lightMapIntensity, normalMap: !!mat.normalMap, tex: (['map', 'normalMap', 'metalnessMap', 'roughnessMap', 'aoMap'] as const).map((k) => { const t = mat[k] as (T.CompressedTexture & { mipmaps?: unknown[] }) | null; return k + ':' + (t ? `${t.image?.width ?? '?'}x${t.image?.height ?? '?'}/m${t.mipmaps?.length ?? 0}/f${t.format}/${t.colorSpace}/${t.isCompressedTexture ? 'c' : 'u'}/same${t === mat.map ? 1 : 0}` : 'none'); }).join(' '), side: mat.side, metal: mat.metalness, rough: mat.roughness, env: mat.envMapIntensity, uv: !!m.geometry.getAttribute('uv'), uv1: !!m.geometry.getAttribute('uv1'), normal: !!m.geometry.getAttribute('normal'), tris: (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3 }); }); }); return out; },
        seats: () => ((room?.userData.solved as { seats: { asset: string; pos: number[]; rotY: number }[] } | undefined)?.seats ?? []),
        stats: () => ({ ...stats, lib: lib.stats(), calls: r.info.render.calls, triangles: r.info.render.triangles, textures: r.info.memory.textures, geometries: r.info.memory.geometries, size: [r.domElement.width, r.domElement.height] }),
      };
      window.__rooms = api;
      const clock = new THREE.Clock(); let raf = 0;
      const frame = () => { raf = requestAnimationFrame(frame); const t = clock.getElapsedTime(); (room?.userData.tick as ((t: number) => void) | undefined)?.(t); r.render(scene, camera); };
      frame();
      const onResize = () => { r.setSize(el.clientWidth, el.clientHeight); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); }; window.addEventListener('resize', onResize);
      const first = qs.get('room'); if (first) api.show(first).catch((e: unknown) => { if (window.__rooms) window.__rooms.error = String(e); });
      off = () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); (room?.userData.dispose as (() => void) | undefined)?.(); lib.dispose(); r.dispose(); r.domElement.remove(); };
    })();
    return () => { dead = true; off?.(); };
  }, []);
  return <div ref={mount} style={{ position: 'fixed', inset: 0, background: '#0b0a09' }} />;
}
