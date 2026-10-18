'use client';
// Standalone render of the sanctuary site plan. Query: ?tier=1..5&q=low|medium|high|ultra&night=1&cam=home|procession|temple|stadium|quarter|plan&houses=N&az=&el=&dist=
import { useEffect, useRef } from 'react';

declare global { interface Window { __site?: { calls: number; triangles: number; ready: boolean; tier: number; stats: unknown; plan: unknown; error?: string } } }

export default function SiteDev() {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let off: (() => void) | null = null; let dead = false;
    (async () => {
      const THREE = await import('three');
      const { buildSite, generateSitePlan, makeSiteMaterials, setSiteAssetRenderer } = await import('@/scene/site');
      const { CAMERAS, SITE_SECTIONS } = await import('@/scene/site/config');
      if (dead || !mount.current) return;
      const qs = new URLSearchParams(window.location.search); const tier = Math.min(5, Math.max(1, Number(qs.get('tier') ?? 3))); const q = (qs.get('q') ?? 'high') as 'low' | 'medium' | 'high' | 'ultra'; const night = qs.get('night') === '1';
      const camName = (qs.get('cam') ?? 'home') as keyof typeof CAMERAS; const cam = CAMERAS[camName] ?? CAMERAS.home; const nHouses = Number(qs.get('houses') ?? 14);
      const levels = Object.fromEntries(SITE_SECTIONS.map((s) => [s, 2])); const houses = Array.from({ length: nHouses }, (_, i) => ({ user_id: 'u' + i, plot_index: i }));
      const plan = generateSitePlan({ seed: 'ashgrove', tier, levels, houses });
      const el = mount.current; const w = () => el.clientWidth, h = () => el.clientHeight;
      const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(w(), h()); r.shadowMap.enabled = q !== 'low'; r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(r.domElement);
      const scene = new THREE.Scene(); const sky = night ? 0x141a2c : 0xcfdbe3; scene.background = new THREE.Color(sky); scene.fog = new THREE.Fog(sky, 90, 220);
      scene.add(new THREE.HemisphereLight(night ? 0x5a6a9a : 0xfff4e0, night ? 0x1a1a24 : 0x8a8f78, night ? 0.45 : 1.0));
      const sun = new THREE.DirectionalLight(night ? 0x7f95d0 : 0xfff0d2, night ? 0.5 : 2.4); sun.position.set(-26, 38, 30); sun.castShadow = r.shadowMap.enabled; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 5; sc.far = 130; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.12; scene.add(sun);
      const water = new THREE.Mesh(new THREE.CircleGeometry(150, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: night ? 0x1c2c40 : 0x7fa4ae, roughness: 0.15, metalness: 0.1 })); water.position.y = -3.4; water.receiveShadow = true; scene.add(water);
      setSiteAssetRenderer(r); const M = makeSiteMaterials(); const site = buildSite(THREE, M, plan, q); scene.add(site.group); site.setNight(night ? 1 : 0);
      // section buildings are owned by the town: stand in for it here so the dev page shows the whole sanctuary
      for (const id of SITE_SECTIONS) { const g = site.section(id, true); const a = site.plotAnchors[id]; g.position.set(a.x, a.y, a.z); g.rotation.y = a.yaw; scene.add(g); }
      const camera = new THREE.PerspectiveCamera(28, w() / h(), 0.5, 400);
      const az = Number(qs.get('az') ?? cam.az) + 0.0, elv = Number(qs.get('el') ?? cam.el), dist = Number(qs.get('dist') ?? cam.dist * Math.pow(plan.R / 12.6, 0.88)); const tg = new THREE.Vector3(...cam.target);
      const place = () => { camera.position.set(tg.x + Math.sin(az) * Math.cos(elv) * dist, tg.y + Math.sin(elv) * dist, tg.z + Math.cos(az) * Math.cos(elv) * dist); camera.lookAt(tg); };
      place(); const info = r.info; window.__site = { calls: 0, triangles: 0, ready: false, tier, stats: site.stats(), plan: { cottages: plan.cottages.length, omitted: plan.omittedHouses, capacity: plan.capacity, trees: plan.trees.length } };
      const clock = new THREE.Clock(); let raf = 0;
      const frame = () => { raf = requestAnimationFrame(frame); site.update(Math.min(0.05, clock.getDelta())); r.render(scene, camera); if (window.__site) { window.__site.calls = info.render.calls; window.__site.triangles = info.render.triangles; window.__site.stats = site.stats(); } };
      frame();
      site.ready.then(() => { if (window.__site) window.__site.ready = true; }).catch((e: unknown) => { if (window.__site) window.__site.error = String(e); });
      const onResize = () => { r.setSize(w(), h()); camera.aspect = w() / h(); camera.updateProjectionMatrix(); }; window.addEventListener('resize', onResize);
      off = () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); site.dispose(); r.dispose(); r.domElement.remove(); };
    })();
    return () => { dead = true; off?.(); };
  }, []);
  return <div ref={mount} style={{ position: 'fixed', inset: 0, background: '#cfdbe3' }} />;
}
