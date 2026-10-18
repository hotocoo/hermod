'use client';
// Harness for the village ground (plan, terrain, paths, water). Buildings and props are colour-coded stand-ins (harness only).
// Query: ?tier=1..5&night=1&season=0..3&houses=N&az=&el=&dist=&cam=home|market|harbour|green|plan
import { useEffect, useRef } from 'react';

declare global { interface Window { __village?: { calls: number; triangles: number; ready: boolean; tier: number; plan: unknown; error?: string } } }

export default function VillageDev() {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let off: (() => void) | null = null; let dead = false;
    (async () => {
      try {
        const THREE = await import('three');
        const { generateVillagePlan } = await import('@/scene/styles/village/plan');
        const { buildVillageTerrain } = await import('@/scene/styles/village/terrain');
        const { buildVillagePaths } = await import('@/scene/styles/village/paths');
        const { buildVillageWater } = await import('@/scene/styles/village/water');
        const { fallbackTextureSet } = await import('@/scene/styles/village/tex');
        const { PLOT_IDS } = await import('@/scene/styles/village/config');
        if (dead || !mount.current) return;
        const qs = new URLSearchParams(window.location.search); const tier = Math.min(5, Math.max(1, Number(qs.get('tier') ?? 3))); const night = qs.get('night') === '1'; const season = Number(qs.get('season') ?? 1);
        const nHouses = Number(qs.get('houses') ?? 24); const plan = generateVillagePlan({ seed: 'ashgrove', tier, levels: Object.fromEntries(PLOT_IDS.map((s) => [s, 2])), houses: Array.from({ length: nHouses }, (_, i) => ({ user_id: 'u' + i, plot_index: i })), season });
        const el = mount.current; const w = () => el.clientWidth, h = () => el.clientHeight;
        const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(w(), h()); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; el.appendChild(r.domElement);
        const scene = new THREE.Scene(); const sky = night ? 0x141a2c : 0xcfdbe3; scene.background = new THREE.Color(sky); scene.fog = new THREE.Fog(sky, 90, 220);
        scene.add(new THREE.HemisphereLight(night ? 0x5a6a9a : 0xfff4e0, night ? 0x1a1a24 : 0x8a8f78, night ? 0.45 : 1.0));
        const sun = new THREE.DirectionalLight(night ? 0x7f95d0 : 0xfff0d2, night ? 0.5 : 2.4); sun.position.set(-26, 38, 30); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 5; sc.far = 130; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.12; scene.add(sun);
        const tex = fallbackTextureSet(256); const terrain = buildVillageTerrain(plan, tex, { grass: 7000 }); scene.add(terrain.group);
        const paths = buildVillagePaths(plan, terrain.heightAt, tex); if (paths.mesh) scene.add(paths.mesh);
        const water = buildVillageWater(plan, terrain.heightAt, tex); scene.add(water.group);
        // stand-ins
        const stand = new THREE.Group(); scene.add(stand); const colors: Record<string, number> = { oak: 0x3f6a30, birch: 0x7fa04a, poplar: 0x4a7a3a, pine: 0x24503a, apple: 0x8aa84f, shrub: 0x557a3a, rock: 0x8a857a, boulder: 0x6c685f, reed: 0xb2a65a, 'flower-patch': 0xd878a0, lamp: 0xffd24a };
        const boxG = new THREE.BoxGeometry(1, 1, 1); const coneG = new THREE.ConeGeometry(0.5, 1, 7);
        for (const p of plan.placements) { const c = colors[p.kind]; const tall = p.kind === 'oak' || p.kind === 'birch' || p.kind === 'poplar' || p.kind === 'pine' || p.kind === 'apple'; const s = tall ? 1.1 * p.scale : p.kind === 'flower-patch' ? 0.25 : p.kind === 'lamp' ? 0.9 : 0.5 * p.scale; const m = new THREE.Mesh(tall ? coneG : boxG, new THREE.MeshStandardMaterial({ color: c ?? 0x7a5a3d, roughness: 0.9 })); m.scale.set(tall ? s * 0.8 : s, s, tall ? s * 0.8 : s); m.position.set(p.x, terrain.heightAt(p.x, p.z) + s / 2, p.z); m.rotation.y = p.yaw; m.castShadow = true; stand.add(m); }
        for (const pl of plan.plotList) { const m = new THREE.Mesh(boxG, new THREE.MeshStandardMaterial({ color: 0xc8b8a0 })); m.scale.set(3, 2, 2.4); m.position.set(pl.x, terrain.heightAt(pl.x, pl.z) + 1, pl.z); m.rotation.y = pl.yaw; m.castShadow = true; stand.add(m); }
        for (const c of plan.cottages) { const m = new THREE.Mesh(boxG, new THREE.MeshStandardMaterial({ color: 0xb4623f })); m.scale.set(1.5, 1.0, 1.25); m.position.set(c.x, terrain.heightAt(c.x, c.z) + 0.5, c.z); m.rotation.y = c.yaw; m.castShadow = true; stand.add(m); }
        const camera = new THREE.PerspectiveCamera(28, w() / h(), 0.5, 400); const cam = plan.cameras[qs.get('cam') ?? 'home'] ?? plan.cameras.home;
        const az = Number(qs.get('az') ?? cam.az), elv = Number(qs.get('el') ?? cam.el), dist = Number(qs.get('dist') ?? cam.dist * Math.pow(plan.R / 12.6, 0.88)); const tg = new THREE.Vector3(...cam.target);
        camera.position.set(tg.x + Math.sin(az) * Math.cos(elv) * dist, tg.y + Math.sin(elv) * dist, tg.z + Math.cos(az) * Math.cos(elv) * dist); camera.lookAt(tg);
        window.__village = { calls: 0, triangles: 0, ready: true, tier, plan: { cottages: plan.cottages.length, omitted: plan.omittedHouses, placements: plan.placements.length } };
        const clock = new THREE.Clock(); let raf = 0; const info = r.info;
        const frame = () => { raf = requestAnimationFrame(frame); const t = clock.getElapsedTime(); water.update(t, night ? 1 : 0); r.render(scene, camera); if (window.__village) { window.__village.calls = info.render.calls; window.__village.triangles = info.render.triangles; } };
        frame();
        const onResize = () => { r.setSize(w(), h()); camera.aspect = w() / h(); camera.updateProjectionMatrix(); }; window.addEventListener('resize', onResize);
        off = () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); terrain.dispose(); paths.dispose(); water.dispose(); tex.dispose(); r.dispose(); r.domElement.remove(); };
      } catch (e) { window.__village = { calls: 0, triangles: 0, ready: false, tier: 0, plan: null, error: String((e as Error).stack || e) }; }
    })();
    return () => { dead = true; off?.(); };
  }, []);
  return <div ref={mount} style={{ position: 'fixed', inset: 0, background: '#cfdbe3' }} />;
}
