import * as THREE from 'three';
import { CAMERA, COLORS, DIRECTOR, ENV, GAMES_HALL, GI, GROWTH, LIGHTS, MATERIAL_BASE, NIGHT, PLOTS, QUALITY, QUALITY_DETECT, QUALITY_ORDER, RENDER, CLOUDS, SECTION_ORDER, SPRINGS, THEME_HOURS, TIMING, CLOCK, ISLAND, ROOM_RESIDENCY, STILL, WATER, type BuildingLevel, type MatSpec, type PlotPos, type QualitySpec, type QualityTier } from '@/config/scene';
import type { SectionId } from '@/lib/data/types';
import { createInteriors, type InteriorRoom } from './interiors';
import { createOverlay } from './overlay';
import { createRavens } from './ravens';
import { rng, type Rng } from './rng';
import { createSkyBodies, sampleSky } from './sky';
import { spring } from './spring';
import type {
  ArcadeHints, BaseMats, ClockMode, Fx, Hints, HouseActor, MiniIsle, PersonActor, PickId, Plot, Plots, RavenSource, RingFn, RingFx, SpaceInfo, ThreadActor, TownApi, TownMode, TownOptions, Visitor,
} from './types';
import { isMesh } from './util';
import { createWeather } from './weather';
import { disposeTree, sharedOf } from './dispose';
import { createWorld } from './world';
import type { SkySample } from './sky';
import { createAdaptive, detectTier, gpuName, lowerTier, savedQuality } from './render/quality';
import { createPipeline } from './render/pipeline';
import { createWaterPlanar } from './render/waterReflect';
import { createWindowLights } from './render/windowLights';
import { aimDown, applyShadowTier, lanternLight, lfxOn } from './render/lightFx';
import { createProbeGI } from './render/gi';
import { createPuffs } from './render/puffs';
import { createStill } from './render/still';
import { createDirector, handheld, type Obstacle, type Pose, type ShotKind } from './camera/director';
import { mergeStatic } from './world/staticMerge';
import { createEnvironment } from './render/env';
import { windU } from './render/wind';
import { surfaceU, surfaceFxTree, fxStats } from './render/surfaceFx';
import { fxU, waterFx, parallaxFx } from './render/materialFx';
import { growthKey, resolveGrowth, type GrowthState } from './growth/layout';
import { getMapStyle } from './styles';
import { PLOT_SPEC } from './site/config';
import { getLocalMapStyle, resolveMapStyle, setLocalMapStyle, type MapStyleChoice } from './styles/pref';
import { LIGHT_UNIT_METERS, type AnchorId, type HousePlace, type LightSpec, type PlotAnchor, type StyleGrowth, type StyleSite } from './styles/types';

const PP: Readonly<Record<string, PlotPos>> = PLOTS;

/**
 * Build the 3D town: one island per Space whose buildings are the Space's sections.
 * Client only (touches window/document); import it from a client component via dynamic import.
 */
/** The panel's open animation (clip-path 820ms) keeps the canvas visible this long. */
const COVERED_RENDER_MS = 1100;

export async function createTown(opts: TownOptions): Promise<TownApi> {
  const { mount, overlay, onPick, onHover } = opts;
  const reduced = !!opts.reduced;
  const probe = document.createElement('canvas');
  const probeGl = (probe.getContext('webgl2') || probe.getContext('webgl')) as WebGLRenderingContext | null;
  if (!probeGl) throw new Error('WebGL unavailable');
  const gpu = gpuName(probeGl); const soft = QUALITY_DETECT.softwareGpu.test(gpu); probeGl.getExtension('WEBGL_lose_context')?.loseContext(); // only needed to read the GPU string: free the context
  const autoTier = () => detectTier(gpu, navigator.hardwareConcurrency || 0, window.devicePixelRatio || 1, Math.min(window.innerWidth, window.innerHeight), 'ontouchstart' in window);
  const saved = savedQuality(); let autoQ = !saved; let tier: QualityTier = saved ?? autoTier(); let Q: QualitySpec = QUALITY[tier];

  const renderer = new THREE.WebGLRenderer({ antialias: !soft, alpha: true, powerPreference: 'high-performance' }); renderer.info.autoReset = false; // one reset per frame: calls cover every pass
  renderer.shadowMap.enabled = !soft; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = RENDER.exposure;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  applyShadowTier(renderer, scene, tier); // PCSS (raw depth lookups) on high and ultra, stock PCF below

  const hemi = new THREE.HemisphereLight(LIGHTS.hemi.sky, LIGHTS.hemi.ground, LIGHTS.hemi.intensity); scene.add(hemi);
  const sun = new THREE.DirectionalLight(LIGHTS.sun.color, LIGHTS.sun.intensity); sun.position.set(...LIGHTS.sun.pos); sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap); sun.shadow.bias = LIGHTS.sun.bias; sun.shadow.normalBias = LIGHTS.sun.normalBias; sun.shadow.radius = Q.shadowRadius;
  /** Fit the (island-fixed, so zoom-stable) shadow frustum to the island radius. */
  function fitShadow(R: number) { const e = R * RENDER.shadowFit, c = sun.shadow.camera; c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 1; c.far = RENDER.shadowFar + R; c.updateProjectionMatrix(); sun.shadow.normalBias = LIGHTS.sun.normalBias * Math.max(1, e / (GROWTH.baseRadius * RENDER.shadowFit)); }
  fitShadow(GROWTH.baseRadius); scene.add(sun);

  const std = ({ color, roughness, metalness, ...extra }: MatSpec) => new THREE.MeshStandardMaterial({ flatShading: false, color, roughness: roughness == null ? 0.85 : roughness, metalness: metalness || 0, ...extra });
  // Seam: the world kit completes this table (BaseMats -> Mats) and returns it as WK.M.
  const baseMats = Object.fromEntries(Object.entries(MATERIAL_BASE).map(([k, v]) => [k, std(v)])) as unknown as BaseMats;
  const GOLD = new THREE.Color(COLORS.gold);
  const fx: Fx = { smoke: [], pulses: [], fireLights: [], spool: null, spoolV: 0.35, burst: 0, fire: 0.6 };
  const WK = createWorld(baseMats, { fx: () => fx, quality: { texSize: Q.texSize, anisotropy: Math.min(Q.anisotropy, renderer.capabilities.getMaxAnisotropy()), grass: Q.grass } });
  const M = WK.M;

  const world = new THREE.Group(); scene.add(world);
  const island = new THREE.Group(); world.add(island);
  const winLights = createWindowLights(scene, renderer, camera); winLights.setTier(tier); if (process.env.NODE_ENV !== 'production') { const w = window as unknown as { __winLights?: unknown; __shadowTier?: unknown }; w.__winLights = winLights; w.__shadowTier = (t: QualityTier) => applyShadowTier(renderer, scene, t); } // dev A/B hooks (lightFx flags)
  const pipeline = createPipeline(renderer, scene, camera); const waterPlanar = createWaterPlanar(renderer); const env = createEnvironment(renderer, scene);
  const gi = createProbeGI(renderer, scene, () => clouds, () => { void prep(scene, { gate: true, force: true, maxMs: 4000, label: 'gi' }); });
  const skyColors: { top: THREE.Color; bottom: THREE.Color } = { top: new THREE.Color(0.6, 0.7, 0.9), bottom: new THREE.Color(0.9, 0.85, 0.8) };
  const still = createStill({ renderer, scene, camera, present: (tex, k) => pipeline.present(tex, k), sky: () => skyColors });
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.16 })); shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = -2.02; shadowPlane.receiveShadow = true; shadowPlane.visible = false; scene.add(shadowPlane);


  // Clouds
  const clouds = [0, 1, 2, 3].map((i) => { const g = WK.cloud(rng('cloud' + i)); g.userData = { a: (i / 4) * Math.PI * 2 + 0.4, r: 15.5 + (i % 2) * 2.5, y: 9 + (i % 3) * 0.9, s: 0.014 + i * 0.003 }; g.userData.base = 0.62 + (i % 2) * 0.12; g.scale.setScalar(g.userData.base); world.add(g); return g; });

  const skyBodies = createSkyBodies(scene, reduced);
  const weather = createWeather({ scene, world, reduced, onFlash: opts.onFlash });
  const wx = weather.wx;
  const WHITE = new THREE.Color(0xffffff), tmpC = new THREE.Color(); const sunDir = new THREE.Vector3();
  M.ground.userData.base = M.ground.color.clone(); M.leaf.userData.base = M.leaf.color.clone(); M.path.userData.base = M.path.color.clone(); M.paper.userData.base = M.paper.color.clone(); M.stone.userData.base = M.stone.color.clone();
  const fog = new THREE.FogExp2(COLORS.fog, 0); scene.fog = fog;
  const rings: RingFx[] = []; const tmpC2 = new THREE.Color();
  const ring: RingFn = (x, z, o) => { o = o || {}; const m = new THREE.Mesh(new THREE.TorusGeometry(1, o.w || 0.03, 16, 160), new THREE.MeshBasicMaterial({ color: o.color || COLORS.ring, transparent: true, opacity: 0, depthWrite: false })); m.rotation.x = Math.PI / 2; m.position.set(x, (o.y || 0) + 0.09, z); island.add(m); rings.push({ m, life: 0, dur: o.dur || 1.4, r0: o.r0 || 0.6, r1: o.r1 || 3.6, op: o.op || 0.85 }); };
  let unread: Partial<Record<string, number>> = {}; let unreadT = 0;
  const plots: Plots = {}; let people: PersonActor[] = []; let houses: HouseActor[] = []; let threads: ThreadActor[] = [];
  let current: SpaceInfo | null = null; let room = { n: 0, me: false }; let hintT = 0; let shopSmoke: { m: THREE.Object3D; life: number }[] = []; let visitors: Visitor[] = [];
  const loomLight = new THREE.PointLight(LIGHTS.loom.color, 0, LIGHTS.loom.distance, LIGHTS.loom.decay);
  let hints: Hints = { feed: 0, board: 0, skein: 0, speak: -1 };

  function applyVisitors() { visitors.forEach((v, i) => { v.on = i < Math.min(4, hints.feed); }); }
  function applyRoom() { if (!fx.seats) return; const others = Math.min(7, room.n); fx.seats.forEach((st, i) => { st.on = i === 0 ? room.me : i <= others; }); }

  const BUILDERS = WK.builders;
  function makePlot(id: SectionId, built: boolean, delay: number, level: BuildingLevel = 1): Plot {
    const a = site!.plotAnchors[id]; const g = site!.makeBuilding(id, level, built); const snap = reduced || instant;
    g.position.set(a.x, a.y, a.z); g.rotation.y = a.yaw; g.userData.pickId = id; g.userData.baseY = a.y; g.scale.setScalar(0.0001);
    island.add(g);
    const pl: Plot = { id, g, built, level: built ? level : 0, open: spring(0, SPRINGS.plotOpen), scale: spring(0, SPRINGS.plotScale), hover: spring(0, SPRINGS.plotHover), pop: spring(0, SPRINGS.plotPop), delay: snap ? 0 : delay, born: performance.now() };
    if (snap) pl.scale.snap(1);
    return pl;
  }
  function makePerson(R: Rng, i: number): PersonActor {
    const g = WK.person(R, i);
    island.add(g); return { g, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 1, R, s: spring(0, SPRINGS.person), wait: R() * 2 };
  }
  const miniGrass = new THREE.MeshStandardMaterial({ color: COLORS.mini, roughness: 0.95 });
  /** Kit materials (and their maps) shared by every plot, person and mini: never freed with a removed group. */
  const kitShared = sharedOf(M); kitShared.add(miniGrass);
  /** Detach a group from its parent and free its own GPU resources. */
  const drop = (g: THREE.Object3D) => { g.removeFromParent(); disposeTree(g, kitShared); };
  /** Deferred work tied to the current space: cancelled on a space switch so a stale build or raise never lands in the next space. */
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const cancelLater = () => { timers.forEach(clearTimeout); timers.clear(); };
  /** Space waiting for its switch build (`current` already names it). */
  let pendingBuild: SpaceInfo | null = null;
  function makeMini(sp: SpaceInfo) {
    const g = new THREE.Group(); g.userData.isle = sp.id;
    const top2 = WK.B(0.01, 0.01, 0.01, miniGrass) as THREE.Mesh; top2.geometry = new THREE.CylinderGeometry(5, 5, 0.3, 160); top2.position.y = -0.15; g.add(top2);
    const ug = WK.displace(new THREE.ConeGeometry(4.6, 4, 96, 16, true), 0.6, 0.5, sp.id.length); ug.rotateX(Math.PI); const un = new THREE.Mesh(ug, M.rock); un.position.y = -2.3; g.add(un);
    const sanct = resolveMapStyle(sp.map_style ?? null) === 'sanctuary';
    if (sanct) { // style-correct mini: the sanctuary's own plot layout with a stone body and terracotta roof, and its temple on the axis
      const stone = new THREE.MeshStandardMaterial({ color: 0xd9cfba, roughness: 0.9 }), roof = new THREE.MeshStandardMaterial({ color: 0xb4623f, roughness: 0.8 }); const k = ISLAND.archiMiniK * 0.78;
      const put = (x: number, z: number, w: number, d: number, yaw: number) => { const b = new THREE.Group(); const m1 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), stone); m1.position.y = 0.35; const m2 = new THREE.Mesh(new THREE.BoxGeometry(w * 1.12, 0.12, d * 1.12), roof); m2.position.y = 0.8; b.add(m1, m2); b.scale.setScalar(ISLAND.archiMiniScale * 1.2); b.position.set(x * k, 0, z * k); b.rotation.y = yaw; g.add(b); };
      put(0, -5.2, 2.4, 4.0, 0); sp.sections.forEach((id) => { const e = PLOT_SPEC[id]; put(e.x, e.z, e.fd, e.fw, e.yaw); });
    } else sp.sections.forEach((id) => { const q = PP[id]; const k = ISLAND.archiMiniK; const b = BUILDERS[id]({ mini: true, level: Math.max(1, Math.min(3, Math.round(sp.growth?.buildings?.[id] ?? 1))) as BuildingLevel }); if (id === 'arcade' && arcadeWaitingOf(sp) > 0) (b.userData.arcadeSign as THREE.MeshStandardMaterial).emissiveIntensity = GAMES_HALL.litGlow; b.scale.setScalar(ISLAND.archiMiniScale); b.position.set(q.x * k, 0, q.z * k); b.rotation.y = Math.atan2(-q.x, -q.z); g.add(b); });
    const Rm = rng('mini' + sp.id); for (let i = 0; i < 16; i++) { const a = Rm() * Math.PI * 2, r = 2.6 + Rm() * 2.0; const tr = WK.tree(Rm); tr.scale.setScalar(0.5 + Rm() * 0.2); tr.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); g.add(tr); }
    g.traverse((o) => { if (isMesh(o)) { o.castShadow = o.material !== M.leafCard; o.receiveShadow = true; } }); g.scale.setScalar(0.0001);
    return mergeStatic(g);
  }
  let minis: MiniIsle[] = []; let miniKey = '';
  function makeThread(fromId: SectionId, toId: SectionId): ThreadActor {
    const a = anchorOf(fromId) ?? PP[fromId], b = anchorOf(toId) ?? PP[toId]; const ay = (anchorOf(fromId)?.y ?? 0), by = (anchorOf(toId)?.y ?? 0);
    const pa = new THREE.Vector3(a.x, ay + 4.3, a.z), pb = new THREE.Vector3(b.x, by + (toId === 'chat' ? 3.6 : 3.0), b.z);
    const mid = pa.clone().add(pb).multiplyScalar(0.5); mid.y = 8.2;
    const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.022, 16, false), M.thread); island.add(tube);
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.11, 32, 24), new THREE.MeshBasicMaterial({ color: COLORS.pulse })); island.add(pulse);
    return { tube, pulse, curve, t: Math.random(), s: spring(0, SPRINGS.thread) };
  }

  const dropThread = (t: ThreadActor) => { drop(t.tube); drop(t.pulse); };
  function clearAll() {
    Object.values(plots).forEach((p) => drop(p.g)); for (const k in plots) delete plots[k];
    people.forEach((p) => drop(p.g)); people = [];
    houses.forEach((h) => site?.releaseHouse(h.g)); houses = [];
    threads.forEach(dropThread); threads = [];
    fx.spool = null; fx.fireLights = []; fx.smokeOrigin = null; fx.seats = null; fx.smoke.forEach((s) => island.remove(s.m)); fx.smoke = [];
  }

  // ---- island growth ----
  let gs: GrowthState = resolveGrowth(undefined, SECTION_ORDER); let camK = 1; let radK = 1;
  /** Active map style site (terrain, paths, trees, cottages, buildings); rebuilt on space, growth-shape or style change. */
  let site: StyleSite | null = null; let styleId: MapStyleChoice = resolveMapStyle(null); let spaceStyle: string | null = null; let instant = false;
  let styleHome: { az: number; el: number; dist: number } = { az: CAMERA.home.az, el: CAMERA.home.el, dist: CAMERA.home.dist };
  const anchorOf = (id: string): PlotAnchor | undefined => site?.plotAnchors[id as AnchorId];
  const siteR = () => site?.radius ?? GROWTH.baseRadius;
  const siteH = (x: number, z: number) => (site ? site.heightAt(x, z) : 0);
  const toStyleGrowth = (g: GrowthState): StyleGrowth => ({ tier: g.tier, R: g.radius, levels: g.levels, houses: g.houses });
  /** Island size drives camera distance limits, cloud orbit and the label fade distance. */
  function applyIslandScale() {
    const k = siteR() / GROWTH.baseRadius; const nk = Math.pow(k, GROWTH.anim.camExponent); const f = nk / camK; camK = nk; radK = Math.pow(k, GROWTH.anim.cloudExponent);
    userDist = Math.max(CAMERA.zoom.min, Math.min(CAMERA.zoom.max * camK, userDist * f)); if (!focusId) rig.dist.t = userDist;
  }
  function makeHouse(h: HousePlace, info: SpaceInfo, i: number, first: boolean): HouseActor {
    const g = site!.makeHouse(h.userId);
    g.position.set(h.x, siteH(h.x, h.z) - 0.01, h.z); g.rotation.y = h.yaw; g.scale.setScalar(0.0001);
    const who = info.people?.[h.userId]; const initials = (who && who.initials) || h.userId.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '?';
    const s = spring(0, GROWTH.anim.houseSpring); if (reduced || instant) s.snap(1);
    return { g, s, delay: reduced || instant ? 0 : (first ? TIMING.plotDelayFirst + 500 : GROWTH.anim.houseDelay) + i * GROWTH.anim.houseStagger, born: performance.now(), key: houseKey(h), userId: h.userId, initials, name: (who && who.name) || h.userId, x: h.x, z: h.z };
  }
  const houseKey = (h: HousePlace) => h.userId + ':' + h.plotIndex + ':' + h.x.toFixed(2) + ':' + h.z.toFixed(2);

  /** (Re)create the active style site for the current space and growth. */
  function createSite(info: SpaceInfo, first: boolean) {
    const prevStyle = site; site?.dispose();
    const style = getMapStyle(styleId);
    site = style.buildSite({ three: THREE, renderer, seed: info.id, info, growth: toStyleGrowth(gs), tier, q: Q, kit: WK, fx, reduced: reduced || instant, first, rng });
    island.add(site.group); fitShadow(site.radius); applyIslandScale();
    siteLights.forEach((s) => { island.remove(s.l); if ((s.l as THREE.SpotLight).isSpotLight) island.remove((s.l as THREE.SpotLight).target); s.l.dispose(); }); siteLights = site.lights.map((spec) => { const lamp = /^lamp:/.test(spec.id) && lfxOn('ies'); const l: THREE.PointLight | THREE.SpotLight = lamp ? lanternLight(island, spec.color, spec.distance, spec.decay) : new THREE.PointLight(spec.color, 0, spec.distance, spec.decay); l.position.set(spec.x, spec.y, spec.z); if (lamp) aimDown(l as THREE.SpotLight); else island.add(l); return { l, spec }; });
    obstacleList = SECTION_ORDER.map((id) => { const an = site!.plotAnchors[id]; return { x: an.x, z: an.z, r: DIRECTOR.obstacleRadius[id] ?? 2.6 }; });
    const h = site.cameraPresets.home; styleHome = { az: h.az, el: h.el, dist: h.dist };
    if (first || !prevStyle || prevStyleId !== styleId) { home.az = h.az; home.el = h.el; home.dist = h.dist; userDist = Math.max(CAMERA.zoom.min, Math.min(CAMERA.zoom.max * camK, h.dist * camK)); if (!focusId) { rig.dist.t = userDist; rig.el.t = home.el; } }
    prevStyleId = styleId;
    // compile every program the new site needs now, off the hot path, so first sight of a building or prop does not hitch
    winLights.invalidate(); void site.ready.then(() => withSceneTarget(() => renderer.compileAsync(scene, camera))).then(() => winLights.warm()).catch(() => undefined);
  }
  let prevStyleId: MapStyleChoice | null = null;
  /** Lights authored by the active style as data (physical candela). */
  let siteLights: { l: THREE.PointLight | THREE.SpotLight; spec: LightSpec }[] = [];
  pipeline.attachFog({ sun, lights: () => siteLights.map((s) => s.l) });
  /** Max simultaneous style lights per tier (index = QUALITY_ORDER); the rest stay emissive only. */
  const SITE_LIGHT_CAP = [1, 6, 12, 16] as const;
  const lightRank = (t: string | undefined) => (t ? QUALITY_ORDER.indexOf(t as QualityTier) : 0);
  function build(info: SpaceInfo, first: boolean) {
    clearAll(); current = info;
    gs = resolveGrowth(info.growth, info.sections); createSite(info, first);
    const ids = SECTION_ORDER;
    ids.forEach((id, i) => { plots[id] = makePlot(id, gs.levels[id] > 0, (first ? TIMING.plotDelayFirst : TIMING.plotDelayNext) + i * TIMING.plotStagger, Math.max(1, gs.levels[id]) as BuildingLevel); });
    houses = site!.houses.map((h, i) => makeHouse(h, info, i, first));
    if (first && !soft) { setTimeout(prewarmRooms, 0); setTimeout(warmGpu, 2500); }
    const n = Math.min(ISLAND.peopleMax, Math.max(ISLAND.peopleMin, Math.round((info.online || 4) / ((info.online || 0) > 50 ? 20 : 1))));
    for (let i = 0; i < n; i++) people.push(makePerson(rng(info.id + i), i));
    applyRoom(); if (!loomLight.parent) island.add(loomLight);
    visitors.forEach((v) => drop(v.g)); visitors = []; if (info.sections.includes('feed')) { const an = site!.plotAnchors.feed; const d = Math.hypot(an.x, an.z) || 1; for (let k = 0; k < 4; k++) { const g = WK.person(rng('vis' + info.id + k), k + 3); const side = (k - 1.5) * 0.55; const r = d - 2.3 - (k % 2) * 0.35; g.position.set((an.x / d) * r + (an.z / d) * side, siteH((an.x / d) * r, (an.z / d) * r), (an.z / d) * r - (an.x / d) * side); const yaw = Math.atan2(an.x - g.position.x, an.z - g.position.z); g.rotation.y = yaw; g.scale.setScalar(0.0001); island.add(g); visitors.push({ g, s: spring(0, SPRINGS.person), on: false, yaw }); } applyVisitors(); }
    if (info.sections.includes('skein')) { (['chat', 'board'] as SectionId[]).forEach((t) => { if (info.sections.includes(t)) threads.push(makeThread('skein', t)); }); }
    void prep(island, { gate: !first, maxMs: 6000 }); // upload textures and compile the new space's shaders in parallel before it is first drawn
  }
  /** Build and compile the interior rooms one at a time while idle, so stepping inside never hitches on geometry or shader compiles. */
  let prewarmed = false;
  /** Boot warm-up behind the splash (never blocks app-ready): upload every texture in small slices, then pre-build the shader programs of every higher tier (its light count) one tier per idle slot, so a later tier change finds them compiled. */
  /** Prepare `root` for first render. Textures upload in 3 ms slices; shader programs compile one material per slice (a single compile can take 50 to 500 ms, so a whole-scene compile freezes a frame for seconds), yielding a frame after any slice over 8 ms. `ctx.before/after` wrap each slice (a tier's light set applied only for its own compile). With `gate` the render loop pauses (canvas keeps the last frame) until done. */
  const uploaded = new WeakSet<THREE.Texture>(); let gateUntil = 0, gating = 0; let compiled = new WeakSet<THREE.Material>();
  /** Declared before any async work (prep, builds) can read it. */
  let alive = true;
  if (process.env.NODE_ENV !== 'production') (window as unknown as { __gfx: unknown }).__gfx = { scene, renderer, camera }; // dev only: draw call audit (scripts/draw-audit.mjs)
  const hasLight = (root: THREE.Object3D) => { let l = false; root.traverse((x) => { if ((x as THREE.Light).isLight) l = true; }); return l; };
  /** Run a compile with the scene target bound: the programs it queues then match the ones the post pipeline draws with (otherwise every first frame recompiles them). */
  const withSceneTarget = <T,>(fn: () => T): T => { const rt = pipeline.sceneTarget; if (!rt) return fn(); const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); try { return fn(); } finally { renderer.setRenderTarget(prev); } };
  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  /** Room warm-ups run with the first inside frame's light set: no GI probe volume, no window rect lights (both change the program keys). */
  const roomCtx = { before() { gi.setVisible(false); winLights.hold(true); }, after() { gi.setVisible(!(mode === 'inside' && insideId !== 'hearth')); winLights.hold(false); } };
  async function prep(root: THREE.Object3D, o: { gate?: boolean; room?: boolean; post?: boolean; maxMs?: number; label?: string; ctx?: { before(): void; after(): void }; force?: boolean } = {}): Promise<void> {
    if (o.room && !o.ctx) o = { ...o, ctx: roomCtx };
    const name = o.label || root.name || root.type; const mark = 'prep:' + name; performance.mark(mark + ':start'); if (o.gate) { gating++; gateUntil = performance.now() + (o.maxMs ?? 6000); } let n = 0;
    try {
      const texs: THREE.Texture[] = []; const jobs = new Map<THREE.Material, THREE.Mesh>();
      root.traverse((x) => { const me = x as THREE.Mesh; const mm = me.material as THREE.Material | THREE.Material[] | undefined; if (!mm) return; for (const m of Array.isArray(mm) ? mm : [mm]) { if (me.isMesh && !jobs.has(m) && (o.force || !compiled.has(m))) jobs.set(m, me); for (const v of Object.values(m)) { const t = v as THREE.Texture; if (t && t.isTexture && !uploaded.has(t)) { uploaded.add(t); texs.push(t); } } } });
      for (let i = 0; i < texs.length && alive;) { const t0 = performance.now(); while (i < texs.length && performance.now() - t0 < 3) { try { renderer.initTexture(texs[i]); } catch { /* unsupported source */ } i++; } if (i < texs.length) await new Promise<void>((r) => setTimeout(r, 0)); }
      let slice = performance.now();
      for (const [m, me] of jobs) { if (!alive || (o.room && !o.gate && mode === 'inside')) break; const t0 = performance.now(); const wv = world.visible; // an approach preload still compiling when the camera has cut into the room must not add/remove its root (that emptied the room on ultra)
        try { if (o.room) { world.visible = false; interiorRoot.add(root); } o.ctx?.before(); withSceneTarget(() => renderer.compile(me, camera, scene)); } catch { /* material not compilable alone */ } finally { o.ctx?.after(); if (o.room) { interiorRoot.remove(root); world.visible = wv; } }
        if (!o.force) compiled.add(m); n++; const d = performance.now() - t0; if (d > 8 || performance.now() - slice > 8) { await nextFrame(); slice = performance.now(); } }
      // renderer.compile only queues the programs (KHR_parallel_shader_compile): wait until the GPU has linked them, or the first draw that needs one stalls. Skipped for roots that hold lights (the lights would be counted twice) and rooms.
      if (n && alive && !o.room && (root === scene || !hasLight(root))) {
        let pr: Promise<unknown> = Promise.resolve(); try { o.ctx?.before(); pr = withSceneTarget(() => renderer.compileAsync(root, camera, scene)); } catch { /* ignore */ } finally { o.ctx?.after(); }
        await Promise.race([pr.catch(() => undefined), new Promise<void>((r) => setTimeout(r, o.maxMs ?? 8000))]);
      }
      // post passes (depth of field, motion blur, AO, TAA of the new composer) compile on their first frame: spend it here, not on the first visible one
      if (o.post && alive && !o.room) { await nextFrame(); try { pipeline.warm(); } catch { /* ignore */ } }
      // gated room entry: the render loop is paused, so compile the whole room with the island hidden (the exact light set of its first frame) and wait until every program has linked. The room is not attached: compile() adds the lights of its first argument itself, attached lights would count twice and change the program keys.
      if (alive && o.room && o.gate) {
        const wv = world.visible; world.visible = false; interiorRoot.children.slice().forEach((c) => interiorRoot.remove(c)); roomCtx.before(); let pr: Promise<unknown> = Promise.resolve(); try { pr = withSceneTarget(() => renderer.compileAsync(root, camera, scene)); } catch { /* ignore */ }
        const lt0 = performance.now(); try { await Promise.race([pr.catch(() => undefined), new Promise<void>((r) => setTimeout(r, Math.max(0, gateUntil - performance.now())))]); } catch { /* ignore */ } console.info(`[prep] ${name} program link wait ${(performance.now() - lt0).toFixed(0)} ms`);
        // compile() never builds the depth / distance programs of the shadow passes: one off-screen draw with the room attached makes the first visible frame free of compiles
        try { interiorRoot.add(root); const sn = renderer.shadowMap.needsUpdate; renderer.shadowMap.needsUpdate = true; withSceneTarget(() => renderer.render(scene, camera)); renderer.shadowMap.needsUpdate = sn; } catch { /* ignore */ } finally { interiorRoot.remove(root); roomCtx.after(); world.visible = wv; }
      }
    } finally { if (o.gate) gating = Math.max(0, gating - 1); performance.mark(mark + ':end'); const m = performance.measure(mark, mark + ':start', mark + ':end'); console.info(`[prep] ${name} ${m.duration.toFixed(0)} ms, ${n} materials${o.gate ? ' (render gated)' : ''}`); }
  }
  /** A tier change invalidates compiled programs (light count and shadow settings are part of the program key). */
  const resetCompiled = () => { compiled = new WeakSet<THREE.Material>(); };
  let gpuWarmed = false; let warming = false;
  function warmGpu() {
    if (gpuWarmed) return; gpuWarmed = true; warming = true; performance.mark('warm:start');
    const tiers = QUALITY_ORDER.filter((q) => QUALITY_ORDER.indexOf(q) > 0 && q !== tier);
    void (async () => {
      const props = new THREE.Group(); props.add(WK.raven()); // not in the scene: only its textures and shader programs (iridescent, instanced wings) are built, so the first raven to perch does not hitch
      await prep(scene, { label: 'warm:' + tier, post: true }); await prep(props, { label: 'warm:raven:' + tier });
      for (const q of tiers) { if (!alive) return; const rank = QUALITY_ORDER.indexOf(q); let saved: boolean[] = [];
        const ctx = {
          before() { saved = siteLights.map(({ l }) => l.visible); siteLights.forEach(({ l, spec }, k) => { l.visible = k < SITE_LIGHT_CAP[rank] && lightRank(spec.minTier) <= rank; }); },
          after() { siteLights.forEach(({ l }, k) => { l.visible = saved[k]; }); } };
        await prep(scene, { label: 'warm:' + q, force: true, ctx }); await prep(props, { label: 'warm:raven:' + q, force: true, ctx });
        await new Promise<void>((r) => setTimeout(r, 400)); }
      performance.mark('warm:end'); performance.measure('warm', 'warm:start', 'warm:end'); warming = false;
    })().catch(() => { warming = false; });
  }
  function prewarmRooms() {
    if (prewarmed) return; prewarmed = true; const ids = ['chat', 'feed', 'board', 'skein', 'desk'].slice(0, ROOM_RESIDENCY.maxRooms); // more would only be evicted again
    ids.forEach((id, i) => setTimeout(() => { if (!alive || !IN.canLoad(id)) return; void IN.load(id).then((room) => { if (room) void prep(room, { room: true, label: 'room:' + id }); }); }, 3500 + i * 1400));
  }

  /** Same space, same sections, new growth data: grow the island, add cottages and upgrade buildings in place. */
  function applyGrowth(info: SpaceInfo) {
    const next = resolveGrowth(info.growth, info.sections);
    if (growthKey(next) === growthKey(gs)) { current = info; return; }
    const handled = site!.applyGrowth ? site!.applyGrowth(toStyleGrowth(next), info) : false;
    gs = next; current = info;
    if (!handled) { crossfade(() => build(info, false)); return; }
    applyIslandScale(); fitShadow(site!.radius);
    SECTION_ORDER.forEach((id) => { const pl = plots[id]; const lvl = gs.levels[id]; if (!pl || (pl.level === lvl)) return; if (lvl === 0 && !pl.built) return; raiseLevel(id, Math.max(1, lvl) as BuildingLevel, lvl > 0); });
    const want = new Set(site!.houses.map(houseKey)); houses.forEach((h) => { if (!h.dying && !want.has(h.key)) { h.dying = true; h.s.t = 0; } });
    site!.houses.forEach((h, i) => { if (!houses.some((x) => !x.dying && x.key === houseKey(h))) houses.push(makeHouse(h, info, i, false)); });
  }
  /** Cross-fade a site rebuild: freeze the current frame on top, rebuild instantly, fade the frozen frame out. No reload. */
  function crossfade(fn: () => void) {
    if (reduced || !current) { fn(); return; }
    const src = renderer.domElement; const snap = document.createElement('canvas'); snap.width = src.width; snap.height = src.height;
    try { pipeline.render(0); snap.getContext('2d')!.drawImage(src, 0, 0); } catch { fn(); return; }
    snap.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:1;transition:opacity 700ms ease';
    src.after(snap); instant = true; try { fn(); } finally { instant = false; }
    const done = () => { snap.style.opacity = '0'; setTimeout(() => snap.remove(), 800); };
    void Promise.race([site!.ready, new Promise<void>((r) => setTimeout(r, 2500))]).then(() => requestAnimationFrame(done));
  }
  /** Switch map style live (local preference or space default changed). */
  function switchStyle(next: MapStyleChoice) { if (next === styleId) return; styleId = next; if (current) crossfade(() => build(current!, false)); }
  /** Rebuild one plot with a new level (pop animation like raise). */
  function raiseLevel(id: SectionId, level: BuildingLevel, built: boolean) {
    const old = plots[id]; if (!old) return; old.dying = true; old.scale.t = 0;
    later(() => { drop(old.g); plots[id] = makePlot(id, built, 0, level); applyRoom(); }, reduced ? 0 : TIMING.raiseMs);
  }

  function raise(id: SectionId) {
    const old = plots[id]; if (!old) return; old.dying = true; old.scale.t = 0; const lvl = Math.max(1, gs.levels[id]) as BuildingLevel; gs.levels[id] = lvl;
    later(() => { drop(old.g); plots[id] = makePlot(id, true, 0, lvl); applyRoom(); if (id === 'skein' || current!.sections.includes('skein')) { threads.forEach(dropThread); threads = []; (['chat', 'board'] as SectionId[]).forEach((t) => { if (current!.sections.includes(t) && current!.sections.includes('skein')) threads.push(makeThread('skein', t)); }); } }, reduced ? 0 : TIMING.raiseMs);
  }

  // Camera rig
  const look = { x: spring(0, SPRINGS.look), y: spring(0, SPRINGS.look) }; const tgV = new THREE.Vector3();
  const rig = { roll: spring(0, SPRINGS.roll), az: spring(CAMERA.start.az, SPRINGS.azel), el: spring(CAMERA.start.el, SPRINGS.azel), dist: spring(CAMERA.start.dist, SPRINGS.dist), tx: spring(0, SPRINGS.azel), tz: spring(0, SPRINGS.azel), ty: spring(0, SPRINGS.azel), off: spring(0, SPRINGS.off) };
  const home: { az: number; el: number; dist: number } = { ...CAMERA.home };
  rig.az.t = home.az; rig.el.t = home.el; rig.dist.t = home.dist;
  const cloudOp = spring(0.94, SPRINGS.cloudOp);
  const fov = spring(CAMERA.fovIdle, SPRINGS.fov); fov.t = CAMERA.fov;
  const ferry = spring(0, SPRINGS.ferry), archiK = spring(0, SPRINGS.archi), photoK = spring(0, SPRINGS.photo);
  let archi = false, photo = false, idle = 0; let compassEl: HTMLElement | null = null, compassScan = 0;
  const intro = !reduced; if (intro) { const I = CAMERA.intro; const orbit = ['az', 'el', 'dist'] as const; rig.az.x = home.az + I.azOffset; rig.el.x = I.el; rig.dist.x = I.dist; orbit.forEach((k) => rig[k].tune(I.tune[0], I.tune[1])); setTimeout(() => orbit.forEach((k) => { const c = k === 'dist' ? I.settleDist : I.settle; rig[k].tune(c[0], c[1]); }), I.settleMs); }
  const islandY = spring(-5, SPRINGS.islandY); islandY.t = 0; if (reduced) { Object.values(rig).forEach((s) => s.snap(s.t)); islandY.snap(0); }
  const ravens = createRavens({ WK, island, plots, islandY, reduced, ring, anchor: anchorOf, running: () => !document.hidden && !(mode === 'inside' && insideId !== null && insideId !== 'hearth') });
  const { perched } = ravens;
  let focusId: string | null = null; let userAz = home.az; let userDist = home.dist; let userTx = 0, userTz = 0; const mouse = { x: 0, y: 0 };
  const clampT = () => { const r = Math.hypot(userTx, userTz); const hard = CAMERA.panLimit * camK * DIRECTOR.softEdge.overshoot; if (r > hard) { userTx *= hard / r; userTz *= hard / r; } };
  let orbVel = 0, panVx = 0, panVy = 0, lastMoveT = 0;

  let mode: TownMode = 'island', insideAt: { az: number; el: number } | null = null, insideId: string | null = null; const INT0 = new THREE.Vector3(0, -260, 0);
  /** Games Hall: games waiting drive the sign glow, the leaders go to the scoreboard (repainted by the room only when they change). */
  const arcadeWaitingOf = (i: SpaceInfo) => Math.max(0, Math.round(i.arcade?.waiting ?? i.growth?.waiting_games ?? 0));
  let arcadeWaiting = 0; let arcadeKey = '';
  function applyArcade(info: SpaceInfo) {
    arcadeWaiting = arcadeWaitingOf(info); const a: ArcadeHints | undefined = info.arcade; const leaders = a ? a.leaders.slice(0, 5) : [];
    const key = leaders.map((l) => `${l.name}|${l.elo}|${l.wins}`).join('\n'); if (key === arcadeKey) return; arcadeKey = key;
    IN.paint('arcade', leaders.map((l) => ({ who: l.name, text: String(l.elo), label: String(l.wins) })));
  }
  const IN = createInteriors(M, WK); const interiorRoot = new THREE.Group(); interiorRoot.position.copy(INT0); scene.add(interiorRoot);
  function doorWorld(id: string, out: THREE.Vector3): THREE.Vector3 | null { const pl = plots[id]; if (!pl) return null; const d = pl.g.userData.door || { x: 0, y: 0.3, z: 1.8 }; out.set(d.x, d.y, d.z + 0.1); pl.g.localToWorld(out); island.worldToLocal(out); return out; }
  const driftK = spring(0, [3, 1]), hhK = spring(0, [20, 1]), dofS = spring(0, DIRECTOR.dof.spring), dofF = spring(20, DIRECTOR.dof.spring); const hh = { x: 0, y: 0, z: 0, roll: 0 };
  const director = createDirector({ heightAt: (x, z) => siteH(x, z), obstacles: () => obstacleList });
  let obstacleList: Obstacle[] = [];
  const poseNow = (): Pose => ({ az: rig.az.x, el: rig.el.x, dist: rig.dist.x, tx: rig.tx.x, ty: rig.ty.x, tz: rig.tz.x, fov: fov.x });
  const poseTarget = (): Pose => ({ az: rig.az.t, el: rig.el.t, dist: rig.dist.t, tx: rig.tx.t, ty: rig.ty.t, tz: rig.tz.t, fov: fov.t });
  /** Fly the camera from `from` to the rig targets along a spline shot (springs take over when it ends). */
  function shoot(kind: ShotKind, from: Pose) { if (!reduced) director.start(from, poseTarget(), kind); }
  const setX = (sp: { x: number; v: number }, v: number) => { sp.x = v; sp.v = 0; };
  function approach(id: SectionId) {
    // start loading and compiling the room now, while the camera walks to the door, so entering never builds on the door frame
    if (id !== 'hearth' && IN.canLoad(id)) void IN.load(id).then((room) => { if (room && alive) void prep(room, { room: true, label: 'approach:' + id }); }); // time-sliced texture upload + compile with the room's own light set
    const pl = plots[id]; if (!pl || !pl.built) { focus(id); return; }
    const from0 = poseNow();
    mode = 'door'; focusId = id; insideId = null; const dp = doorWorld(id, new THREE.Vector3())!; const yaw = pl.g.rotation.y; const C = id === 'hearth' ? CAMERA.doorHearth : CAMERA.doorOther;
    rig.tx.t = dp.x; rig.tz.t = dp.z; rig.ty.t = dp.y + C.ty; rig.az.t = nearestAz(yaw + C.azOffset); rig.el.t = C.el; rig.dist.t = C.dist; rig.off.t = 0.2; fov.t = C.fov;
    pl.pop.v = 2.5; ring(dp.x, dp.z, { r0: 0.4, r1: 2.6, dur: 1.1, w: 0.02 });
    shoot(id === 'hearth' ? 'hearth' : 'approach', from0);
    if (reduced) Object.values(rig).forEach((s) => s.snap(s.t));
  }
  function enter(id: SectionId, cb?: () => void) {
    const pl = plots[id]; if (!pl) { cb?.(); return; } const from0 = poseNow();
    if (id === 'hearth') { mode = 'inside'; focusId = id; insideId = id; insideAt = { az: rig.az.t, el: CAMERA.hearthInside.el }; rig.tx.t = 0; rig.tz.t = 0; rig.ty.t = CAMERA.hearthInside.ty; rig.dist.t = CAMERA.hearthInside.dist; rig.off.t = CAMERA.hearthInside.off; fov.t = CAMERA.hearthInside.fov; shoot('hearth', from0); if (reduced) Object.values(rig).forEach((s) => s.snap(s.t)); if (cb) setTimeout(cb, reduced ? 0 : TIMING.enterHearthMs); return; }
    if (!IN.canLoad(id)) { cb?.(); return; } const loading = IN.load(id);
    const push = () => { const dp = doorWorld(id, new THREE.Vector3())!; const C = CAMERA.roomPush; rig.tx.t = dp.x; rig.tz.t = dp.z; rig.ty.t = dp.y + C.ty; rig.dist.t = C.dist; rig.el.t = C.el; fov.t = C.fov; };
    const cut = (room: InteriorRoom) => {
      interiorRoot.children.slice().forEach((c) => interiorRoot.remove(c)); interiorRoot.add(room); room.position.set(0, 0, 0); IN.setActive(id); gi.setVisible(false); director.cancel();
      const u = room.userData; const look = u.look.clone().add(INT0), cam = u.cam.clone().add(INT0); const off = cam.clone().sub(look); const d = off.length(); const az = Math.atan2(off.x, off.z), el = Math.asin(off.y / d);
      mode = 'inside'; focusId = id; insideId = id; insideAt = { az, el };
      rig.tx.snap(look.x); rig.ty.snap(look.y); rig.tz.snap(look.z); rig.az.snap(az); rig.el.snap(el); rig.dist.x = d + CAMERA.roomCut.distExtra; rig.dist.v = 0; rig.dist.t = d; rig.off.snap(CAMERA.roomCut.off); fov.x = CAMERA.roomCut.fovFrom; fov.v = 0; fov.t = CAMERA.roomCut.fovTo;
      cb?.();
    };
    const go = () => { void loading.then(async (room) => { if (room) { await prep(room, { gate: true, room: true, maxMs: 4000, label: 'enter:' + id }); cut(room); } else cb?.(); }); };
    if (mode === 'inside' || reduced) { go(); return; }
    push(); shoot('push', from0); setTimeout(go, CAMERA.roomPush.cutMs);
  }
  function leaveInside() { const was = insideId; mode = 'island'; insideAt = null; insideId = null; if (was && was !== 'hearth') { const dp = doorWorld(was, new THREE.Vector3()) || new THREE.Vector3(); const yaw = plots[was] ? plots[was].g.rotation.y : 0; const C = CAMERA.leave; rig.tx.snap(dp.x); rig.tz.snap(dp.z); rig.ty.snap(dp.y + C.ty); rig.az.snap(nearestAz(yaw)); rig.el.snap(C.el); rig.dist.snap(C.dist); rig.off.snap(0); fov.snap(C.fov); } interiorRoot.children.slice().forEach((c) => interiorRoot.remove(c)); IN.setActive(null); gi.setVisible(true); focus(null); }
  let panelOpen = false;
  let covered = false; let coveredAt = 0;
  function focus(id: PickId | null) {
    const from0 = poseNow();
    if (!id) { mode = 'island'; insideAt = null; insideId = null; }
    focusId = id;
    const p0 = id && id !== 'search' ? anchorOf(id) : undefined; if (id && p0) { const p = p0; const C = CAMERA.focus; rig.tx.t = p.x; rig.tz.t = p.z; rig.ty.t = C.ty; rig.dist.t = C.dist; rig.el.t = C.el; const O = panelOpen ? DIRECTOR.ots : null; rig.az.t = nearestAz(Math.atan2(p.x, p.z) + (O ? O.azOffset : C.azOffset)); rig.off.t = O ? O.off : C.off; fov.t = O ? O.fov : C.fov; if (O) { rig.el.t = O.el; rig.dist.t = C.dist * O.distK; } ring(p.x, p.z, { r0: 1.6, r1: 6, dur: 1.2 }); const fp = plots[id]; if (fp) { fp.pop.v = 4; } }
    else {  rig.tx.t = userTx; rig.tz.t = userTz; rig.ty.t = 0; rig.dist.t = userDist; rig.el.t = home.el; rig.az.t = userAz; rig.off.t = 0; fov.t = CAMERA.fov; }
    shoot(id ? 'focus' : 'release', from0);
    if (reduced) Object.values(rig).forEach((s) => s.snap(s.t));
  }
  function nearestAz(a: number) { const cur = rig.az.x; while (a - cur > Math.PI) a -= Math.PI * 2; while (cur - a > Math.PI) a += Math.PI * 2; return a; }

  // Input
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let hovered: string | null = null; let down: { x: number; y: number; lx: number; ly: number; az: number; moved: boolean; pan: boolean } | null = null; let W = 1, H = 1;
  function pickAt(cx: number, cy: number): string | null {
    const r = renderer.domElement.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    if (archi) { const hit2 = ray.intersectObjects(minis.map((m) => m.g).concat([island]), true)[0]; if (!hit2) return null; let o2: THREE.Object3D | null = hit2.object; while (o2 && !o2.userData.isle && o2 !== island) o2 = o2.parent; return o2 === island ? 'isle:' + (current && current.id) : (o2 ? 'isle:' + o2.userData.isle : null); }
    const rh = ray.intersectObjects(perched.map((r) => r.g), true)[0]; if (rh) { let o3: THREE.Object3D | null = rh.object; while (o3 && !perched.some((r) => r.g === o3)) o3 = o3.parent; const r3 = perched.find((r) => r.g === o3); if (r3) return 'raven-' + r3.kind; }
    const targets: THREE.Object3D[] = Object.values(plots).filter((p) => !p.dying).map((p): THREE.Object3D => p.g).concat(site ? [...site.pickables] : []);
    const hit = ray.intersectObjects(targets, true)[0]; if (!hit) return null; let o: THREE.Object3D | null = hit.object; while (o && !o.userData.pickId) o = o.parent; return o ? o.userData.pickId : null;
  }
  function setHover(id: string | null) { if (id === hovered) return; hovered = id; if (id && id !== 'hearth' && IN.canLoad(id)) void IN.load(id); /* door hover starts the room build */ renderer.domElement.style.cursor = id ? 'pointer' : (down ? 'grabbing' : 'grab'); onHover?.(id); }
  const el = renderer.domElement;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => { idle = 0; orbVel = panVx = panVy = 0; lastMoveT = performance.now(); down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, az: rig.az.t, moved: false, pan: e.button === 2 || e.shiftKey || e.button === 1 }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    idle = 0; const r = el.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (down) { const dx = e.clientX - down.x; if (Math.abs(dx) + Math.abs(e.clientY - down.y) > 5) down.moved = true; if (down.moved && !focusId) { const nowT = performance.now(); const I = DIRECTOR.inertia; const dtm = Math.max(I.minDtMs, nowT - lastMoveT) / 1000; lastMoveT = nowT; const ddx = e.clientX - down.lx, ddy = e.clientY - down.ly; const cap = (v: number, m: number) => Math.max(-m, Math.min(m, v)); /* high-rate pointers (120Hz trackpads, coalesced events) give tiny dt: floor it and cap the fling so release never spins the island */ if (down.pan) { panVx = cap(panVx * 0.6 + 0.4 * (ddx / dtm), I.maxPan); panVy = cap(panVy * 0.6 + 0.4 * (ddy / dtm), I.maxPan); } else orbVel = cap(orbVel * 0.6 + 0.4 * (-ddx * CAMERA.orbitSpeed / dtm), I.maxOrbit); if (down.pan) { panBy(e.clientX - down.lx, e.clientY - down.ly); el.style.cursor = 'move'; } else { rig.az.t = down.az - dx * CAMERA.orbitSpeed; userAz = rig.az.t; rig.el.t = Math.max(CAMERA.tilt.min, Math.min(CAMERA.tilt.max, rig.el.t + (e.clientY - down.ly) * CAMERA.tiltSpeed)); home.el = rig.el.t; el.style.cursor = 'grabbing'; } } down.lx = e.clientX; down.ly = e.clientY; return; }
    setHover(pickAt(e.clientX, e.clientY));
  });
  el.addEventListener('pointerup', (e) => { const d = down; down = null; if (performance.now() - lastMoveT > 90) { orbVel = 0; panVx = 0; panVy = 0; } if (mode === 'inside') return; if (d && !d.moved) { const id = pickAt(e.clientX, e.clientY); if (id && id.startsWith('isle:')) { opts.onIsle?.(id.slice(5)); return; } if (id && id.startsWith('raven-')) { const r4 = perched.find((r) => 'raven-' + r.kind === id); if (r4) { r4.nextCaw = -0.01; } opts.onRaven?.(id.slice(6) as RavenSource); return; } if (id) { const p = screenPos(id); onPick?.(id as PickId, p.x, p.y); } else if (focusId) { onPick?.(null); } } el.style.cursor = hovered ? 'pointer' : 'grab'; });
  el.addEventListener('pointerleave', () => { setHover(null); mouse.x = mouse.y = 0; });
  el.addEventListener('wheel', (e) => { idle = 0; if (focusId) return; e.preventDefault(); if (!archi && e.deltaY > 0 && userDist >= CAMERA.zoom.archiAt * camK) { archiAcc = (archiAcc || 0) + e.deltaY; if (archiAcc > CAMERA.zoom.archiAccum) { archiAcc = 0; opts.onArchi?.(true); } return; } if (archi && e.deltaY < 0) { opts.onArchi?.(false); return; } zoomAt(e.deltaY * CAMERA.zoom.wheel, e.clientX, e.clientY); }, { passive: false });
  el.addEventListener('dblclick', (e) => { if (focusId) return; const id = pickAt(e.clientX, e.clientY); if (id) return; const g = groundAt(e.clientX, e.clientY); if (!g) return; userTx = g.x * 0.85; userTz = g.z * 0.85; clampT(); userDist = Math.max(CAMERA.zoom.min, userDist - CAMERA.zoom.dblDist); rig.tx.t = userTx; rig.tz.t = userTz; rig.dist.t = userDist;  });
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); const hitV = new THREE.Vector3();
  function groundAt(cx: number, cy: number) { const r = el.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plane, hitV) ? hitV.clone() : null; }
  function panBy(dx: number, dy: number) { const a = rig.az.x, sc = rig.dist.x * 0.0017; const rx = Math.cos(a), rz = -Math.sin(a), fx2 = -Math.sin(a), fz = -Math.cos(a); userTx += -rx * dx * sc + fx2 * dy * sc; userTz += -rz * dx * sc + fz * dy * sc; clampT(); rig.tx.t = userTx; rig.tz.t = userTz; }
  function zoomAt(d: number, cx?: number, cy?: number) { const nd = Math.max(CAMERA.zoom.min, Math.min(CAMERA.zoom.max * camK, userDist + d)); const f = (userDist - nd) / userDist; if (cx != null) { const g = groundAt(cx, cy!); if (g) { userTx += (g.x - userTx) * f * 0.9; userTz += (g.z - userTz) * f * 0.9; clampT(); rig.tx.t = userTx; rig.tz.t = userTz; } } userDist = nd; rig.dist.t = userDist; }
  let archiAcc = 0;
  function onKeyNav(e: KeyboardEvent) { idle = 0; if ((opts.blocked?.()) || focusId || /INPUT|TEXTAREA/.test((e.target && (e.target as HTMLElement).tagName) || '') || e.metaKey || e.ctrlKey || e.altKey || (!e.shiftKey && (e.target as HTMLElement | null)?.closest?.('[data-bld]'))) return; const st = CAMERA.keyStep; if (e.key === 'ArrowLeft') panBy(st, 0); else if (e.key === 'ArrowRight') panBy(-st, 0); else if (e.key === 'ArrowUp') panBy(0, st); else if (e.key === 'ArrowDown') panBy(0, -st); else if (e.key === '=' || e.key === '+') zoomAt(-5); else if (e.key === '-') zoomAt(5); else if (e.key === '0') recenter(); else if (e.key === 'q') { userAz += CAMERA.keyOrbit; rig.az.t = userAz; } else if (e.key === 'e') { userAz -= CAMERA.keyOrbit; rig.az.t = userAz; } else return; e.preventDefault(); }
  window.addEventListener('keydown', onKeyNav);
  /** Any pointer activity, over the HUD and labels too, holds the idle orbit: a label must not slide away under the cursor. */
  const onAnyMove = () => { idle = 0; }; window.addEventListener('pointermove', onAnyMove, { passive: true });
  let lastInputAt = performance.now(); const markInput = () => { lastInputAt = performance.now(); };
  const INPUT_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const;
  for (const ev of INPUT_EVENTS) window.addEventListener(ev, markInput, { passive: true });
  function recenter() { userTx = userTz = 0; userDist = styleHome.dist * camK; home.el = styleHome.el; userAz = Math.round((userAz - Math.PI / 4) / (Math.PI * 2)) * Math.PI * 2 + Math.PI / 4; rig.tx.t = 0; rig.tz.t = 0; rig.dist.t = userDist; rig.el.t = home.el; rig.az.t = userAz;  }
  el.style.cursor = 'grab';

  function resize() { W = mount.clientWidth || 1; H = mount.clientHeight || 1; renderer.setSize(W, H, false); pipeline.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); }
  
  /** Apply a quality tier. Render scale is fixed at 1x: tiers change features, never resolution. */
  /** Authored-asset rooms (high/ultra): installed lazily so the asset loader stays out of the initial bundle; low/medium keep the procedural rooms. */
  let hifiOff: (() => void) | null = null; let hifiTier: string | null = null;
  function applyHifi(t: QualityTier) {
    const want = t === 'high' || t === 'ultra' ? t : null; if (want === hifiTier) return; hifiTier = want; hifiOff?.(); hifiOff = null;
    if (want) void import('./rooms/hifi/register').then((m) => { if (alive && hifiTier === want) hifiOff = m.installHifiRooms({ renderer, tier: want }); });
  }
  function applyQuality(t: QualityTier) {
    applyHifi(t); tier = t; Q = QUALITY[t]; const pr = Math.min(window.devicePixelRatio || 1, Q.pixelRatio) * (soft ? QUALITY_DETECT.softwareScale : 1); applyShadowTier(renderer, scene, t); winLights.setTier(t);
    renderer.setPixelRatio(pr); renderer.setSize(W, H, false); pipeline.setSize(W, H); pipeline.configure(Q);
    sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap); sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.radius = Q.shadowRadius; renderer.shadowMap.needsUpdate = true;
    site?.setQuality(tier, Q); env.setEnabled(Q.env); skyBodies.setVisible(!pipeline.active); gi.configure(Q.gi); gi.invalidate(); still.invalidate(); if (Q.gi || tier === STILL.idleTier) still.warm(); IN.setShadows(Q.interiorShadow); resetCompiled(); void prep(scene, { gate: true, post: true, maxMs: 5000, label: 'tier:' + t });
  }
  /** Downgrade-only fps watcher (auto mode): one tier down after a few seconds under the fps floor. */
  const adaptive = createAdaptive(() => { if (!autoQ) return; const lower = lowerTier(tier); if (lower) { applyQuality(lower); adaptive.reset(); } });
  const ro = new ResizeObserver(resize); ro.observe(mount); resize(); applyQuality(tier);

  const v3 = new THREE.Vector3();
  function project(x: number, y: number, z: number) { v3.set(x, y, z); island.localToWorld(v3); v3.project(camera); const r = el.getBoundingClientRect(); return { x: r.left + (v3.x * 0.5 + 0.5) * r.width, y: r.top + (-v3.y * 0.5 + 0.5) * r.height, z: v3.z }; }
  function screenPos(id: string) { const a = anchorOf(id); return a ? project(a.x, a.y + (id === 'search' ? 1.6 : 1.4), a.z) : { x: W / 2, y: H / 2 }; }
  const overlayUi = overlay ? createOverlay(overlay, { plots, houses: () => houses, perched: ravens.perched, project, doorWorld: (id, out) => doorWorld(id, out), anchor: anchorOf, state: () => ({ mode, focusId, hovered, photo, archi, current, minis, archiK: archiK.x, photoK: photoK.x, islandY: islandY.x, camDist: rig.dist.x / camK }) }) : null;
  const hourS = spring(CLOCK.initialHour, SPRINGS.hour); let clockMode: ClockMode = 'manual', liveScan = 0, skyScan = 0, lastPeriod = '', lastHr = -1;
  function setHour(h: number, instant?: boolean) { let target = h; const cur = hourS.t; while (target - cur > 12) target -= 24; while (cur - target > 12) target += 24; hourS.t = target; if (instant || reduced) hourS.snap(target); }
  function setTheme(dark: boolean, instant?: boolean) { setHour(dark ? THEME_HOURS.dark : THEME_HOURS.light, instant); }
  // Loop
  let skyCache: SkySample | null = null; let skyCacheHr = -99; // sampleSky builds strings: only resample when the hour moved
  /** Reused smoke puff materials (opacity is per puff), so no material is created or disposed per frame. */
  const puffs = createPuffs(WK.puffGeo, 28); island.add(puffs.mesh); // hearth and shop smoke: one instanced draw call for every puff
  const giPos = new THREE.Vector3(), giQuat = new THREE.Quaternion(); let giFov = 0; let giBusyMs = 0;
  const camFrustum = new THREE.Frustum(), camVP = new THREE.Matrix4(); let skipTick = 0; const sigM = new Array<number>(16).fill(0); let sigFov = 0, sigW = 0, sigH = 0, sigHr = -1, sigIn = false, stableMs = 0; let shadowTick = 0; let insideFrames = 0; let pauseN = 0, pauseId: string | null = null; const PAUSE_AFTER = 24; let fxTick = 9; let fxSig = -1;
  /** Per material upgrades that depend on the tier: alpha-to-coverage cutouts (MSAA), parallax on ultra, wave shading on water. */
  function fxSweep() { world.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (!mm) return; (Array.isArray(mm) ? mm : [mm]).forEach((m) => {
    if (m.alphaTest > 0 && !m.userData.noA2C && !m.alphaToCoverage !== !Q.msaa) { fxStats.swept++; m.alphaToCoverage = Q.msaa > 0; m.needsUpdate = true; }
    if (o.name.startsWith('water:')) { if (!o.name.endsWith(':fall') && waterFx(m)) fxStats.swept++; } else if (tier === 'ultra' && (m === M.stone || m === M.path || m === M.ground || m === M.stoneW || m === M.rock || m.userData.pom)) { if (parallaxFx(m)) fxStats.swept++; } }); }); }
 const SHADOW_EVERY = 3;
 
 let last = performance.now(); let raf = 0; const t0 = last;
  /** CPU rasteriser only: while the camera rests, GPU work (every pass) drops to a slow heartbeat; the simulation still steps each allowed frame, so springs and timers keep real time. True = skip this frame's draw. */
  let lastSoftDraw = 0;
  const softHold = (now: number, settled: boolean) => { if (!soft || gating > 0 || !settled || now - lastSoftDraw >= 1000 / QUALITY_DETECT.softwareIdleFps) { lastSoftDraw = now; return false; } return true; };
  let errLogged = false;
  let lastProg = 0, lastTex = 0;
  /** Resets stats and draws the frame through the post pipeline, unless a warm-up gate is holding the canvas. */
  function drawFrame(dt: number, now: number) {
    renderer.info.reset(); if (gating > 0 && performance.now() < gateUntil) return;
    { const w = window as unknown as { __prof?: Record<string, number> }; if (w.__prof) { (w as unknown as { __rend?: unknown; __pipe?: unknown; __IN?: unknown }).__rend = renderer; (w as unknown as { __pipe?: unknown }).__pipe = pipeline; (w as unknown as { __IN?: unknown }).__IN = IN; const a = performance.now(); pipeline.render(dt); const b = performance.now(); w.__prof.renderMs = b - a; w.__prof.calls = renderer.info.render.calls; w.__prof.tris = renderer.info.render.triangles; w.__prof.frameMs = b - now; w.__prof.programs = renderer.info.programs?.length ?? 0; w.__prof.textures = renderer.info.memory.textures; } else pipeline.render(dt); }

  }
  function frame(now: number) { const t0f = performance.now(); try { frameInner(now); } catch (e) { if (!errLogged) { errLogged = true; console.error('Town frame: ' + ((e as Error) && (e as Error).stack || e)); } }  const ms = performance.now() - t0f; gi.noteFrame(ms); if (ms > 40 && gating === 0) { const mi = renderer.info; const progs = mi.programs?.length ?? 0; console.info(`[spike] frame ${ms.toFixed(0)} ms | programs ${progs} (+${progs - lastProg}) textures ${mi.memory.textures} (+${mi.memory.textures - lastTex}) geometries ${mi.memory.geometries} calls ${mi.render.calls} tris ${mi.render.triangles} | mode ${mode} tier ${tier} still ${still.engaged ? 'on' : 'off'} gi ${gi.progress.toFixed(2)}`); } lastProg = renderer.info.programs?.length ?? 0; lastTex = renderer.info.memory.textures; }
  function frameInner(now: number) {
    if (!alive) return; raf = requestAnimationFrame(frame);
    if (soft && now - last < 1000 / QUALITY_DETECT.softwareFps) return; // software GL: capped rate; 'last' only moves on drawn frames, so adaptive sees real frame times
    if (idle > DIRECTOR.idleThrottleAfter && mode === 'island' && !focusId && !down && (++skipTick & 1)) { adaptive.reset(); return; } // a throttled frame is not a slow one: rawDt would span two frames // ambient motion only: half rate
    const rawDt = (now - last) / 1000; if (autoQ && !soft && rawDt > 0 && !warming && gating === 0) adaptive.push(rawDt); else if (warming || gating > 0) adaptive.reset(); const dt = Math.max(0, Math.min(0.05, rawDt)); last = Math.max(last, now); const t = (now - t0) / 1000;
    if (mode === 'inside' && insideAt) { rig.az.t = insideAt.az; rig.el.t = insideAt.el; } else if (!focusId) rig.az.t = userAz;
    if (!focusId && !(down && down.moved)) rig.el.t = home.el;
    if (!down && !reduced) { look.x.t = mouse.x; look.y.t = mouse.y; } else if (!down) { look.x.t = 0; look.y.t = 0; } look.x.step(dt); look.y.step(dt);
    idle += dt; if (idle > CAMERA.idleAfter && !focusId && !hovered && !reduced && !soft && !still.engaged) { userAz += dt * CAMERA.idleSpin; }
    if (photo && !reduced && !still.engaged && photoK.x < 0.99) userAz += dt * CAMERA.photoSpin;
    if (!focusId) { rig.tx.t = userTx * (1 - archiK.t); rig.tz.t = userTz * (1 - archiK.t); }
    if (!down && !focusId && mode === 'island') {
      const I = DIRECTOR.inertia; if (orbVel) { userAz += orbVel * dt; rig.az.t = userAz; orbVel *= Math.exp(-dt * I.orbitDecay); if (Math.abs(orbVel) < I.minSpeed) orbVel = 0; }
      if (panVx || panVy) { panBy(panVx * dt, panVy * dt); const f = Math.exp(-dt * I.panDecay); panVx *= f; panVy *= f; if (Math.hypot(panVx, panVy) < 18) panVx = panVy = 0; }
      const r = Math.hypot(userTx, userTz), lim = CAMERA.panLimit * camK; if (r > lim) { const nr = r - (r - lim) * (1 - Math.exp(-dt * DIRECTOR.softEdge.relax)); userTx *= nr / r; userTz *= nr / r; rig.tx.t = userTx; rig.tz.t = userTz; }
    }
    fov.step(dt); ferry.step(dt); archiK.step(dt); photoK.step(dt);
    Object.values(rig).forEach((s) => s.step(dt)); { const sp = director.update(dt); if (sp) { const p = sp.pose; setX(rig.az, p.az); setX(rig.el, p.el); setX(rig.dist, p.dist); setX(rig.tx, p.tx); setX(rig.ty, p.ty); setX(rig.tz, p.tz); fov.x = p.fov; fov.v = 0; } } islandY.step(dt); cloudOp.t = focusId ? 0 : Math.max(0.94, ferry.x); cloudOp.step(dt); M.cloud.opacity = Math.max(0, cloudOp.x); clouds.forEach((c) => { c.visible = cloudOp.x > 0.02; });
    world.position.y = islandY.x;
    const tg = tgV.set(rig.tx.x, rig.ty.x, rig.tz.x);
    driftK.t = !reduced && !soft && !focusId && mode === 'island' && idle > CAMERA.idleAfter && !still.engaged ? 1 : 0; driftK.step(dt); hhK.t = !reduced && mode === 'inside' ? 1 : 0; hhK.step(dt); const dk = driftK.x, hk = hhK.x;
    const D = (rig.dist.x + ferry.x * 34 + archiK.x * 108 - photoK.x * 8) * (1 + Math.sin(t * DIRECTOR.drift.speed) * DIRECTOR.drift.dist * dk), E = Math.min(1.42, rig.el.x + ferry.x * 0.32 + archiK.x * 0.28 - photoK.x * 0.26 + Math.sin(t * DIRECTOR.drift.speed * 1.3 + 1) * DIRECTOR.drift.el * dk);
    const crane = Math.sin(Math.PI * Math.min(1, Math.max(0, archiK.x))), azC = rig.az.x + crane * DIRECTOR.crane.swing, EC = Math.min(1.45, E + crane * DIRECTOR.crane.lift);
    camera.position.set(tg.x + Math.sin(azC) * Math.cos(EC) * D, tg.y + Math.sin(EC) * D, tg.z + Math.cos(azC) * Math.cos(EC) * D);
    if (!reduced) { const amt = mode === 'inside' ? 0.5 : (mode === 'door' ? 0.35 : D * 0.045); const ca = Math.cos(rig.az.x), sa = Math.sin(rig.az.x); camera.position.x += ca * look.x.x * amt; camera.position.z += -sa * look.x.x * amt; camera.position.y += look.y.x * amt * 0.45; tg.x += ca * look.x.x * amt * 0.55; tg.z += -sa * look.x.x * amt * 0.55; tg.y -= look.y.x * amt * 0.35; }
    if (hk > 0.001) { handheld(t, DIRECTOR.handheld.freq, hh); camera.position.x += hh.x * DIRECTOR.handheld.pos * hk; camera.position.y += hh.y * DIRECTOR.handheld.pos * hk; camera.position.z += hh.z * DIRECTOR.handheld.pos * hk; }
    if (mode === 'island') { const gy = siteH(camera.position.x, camera.position.z) + islandY.x + DIRECTOR.groundClearance; if (camera.position.y < gy) camera.position.y = gy; } // orbit never dips under the terrain
    camera.lookAt(tg); if (hk > 0.001) camera.rotateZ(hh.roll * DIRECTOR.handheld.roll * hk);
    if (process.env.NODE_ENV !== 'production') { const co = (window as unknown as { __camOverride?: number[] }).__camOverride; if (co) { const [az, el, d, x, y, z] = co; camera.position.set(x + Math.sin(az) * Math.cos(el) * d, y + Math.sin(el) * d, z + Math.cos(az) * Math.cos(el) * d); camera.lookAt(x, y, z); } } // dev only: fx-shots close-up cameras
    { const want = Q.dof && !reduced ? (mode === 'inside' ? DIRECTOR.dof.strengthInside : mode === 'door' ? DIRECTOR.dof.strengthDoor : focusId ? DIRECTOR.dof.strengthFocus : 0) : 0; dofS.t = want; dofS.step(dt); dofF.t = camera.position.distanceTo(tg); dofF.step(dt); pipeline.setDof(dofS.x, dofF.x, mode === 'inside' ? DIRECTOR.dof.nearInside : 1); }
    camera.fov = Math.max(10, fov.x + archiK.x * 6 - photoK.x * 6); camera.far = 300 + archiK.x * 200; pipeline.setPanOffset(rig.off.x);

    hourS.step(dt); if (clockMode === 'live' && now - liveScan > 5000) { liveScan = now; const d = new Date(); setHour(d.getHours() + d.getMinutes() / 60); } if (clockMode === 'lapse' && !reduced) { hourS.t += dt * 0.25; }
    const hr = ((hourS.x % 24) + 24) % 24; if (!skyCache || Math.abs(hr - skyCacheHr) > 0.0008) { skyCache = sampleSky(hr); skyCacheHr = hr; } const S = skyCache; const k = S.night;
    hemi.color.setRGB(S.hemi[0], S.hemi[1], S.hemi[2]); hemi.intensity = S.hi * ENV.hemiScale; hemi.groundColor.setRGB(0.81 * (1 - k * 0.6), 0.77 * (1 - k * 0.6), 0.71 * (1 - k * 0.5));
    const sa = ((hr - 6) / 12) * Math.PI; const up = Math.sin(sa); const isSun = up > -0.08;
    const la = isSun ? sa : sa + Math.PI; sun.position.set(Math.cos(la) * 30, Math.max(3, Math.abs(Math.sin(la)) * 28), 9 - Math.sin(la) * 4);
    sun.color.setRGB(S.sun[0], S.sun[1], S.sun[2]); sun.intensity = S.si * ENV.sunScale;
    skyBodies.update(k, sa, t); pipeline.update({ top: S.top, bot: S.bot, glow: S.glow, hour: hr, night: k, time: t, az: rig.az.x, archi: archiK.x, inside: mode !== 'island' || focusId !== null || panelOpen });
    M.win.emissiveIntensity = Math.max(0, k - NIGHT.winFrom) * NIGHT.winIntensity; M.lamp.emissiveIntensity = 0.25 + Math.max(0, k - 0.1) * NIGHT.lampIntensity; M.thread.emissiveIntensity = 0.25 + k * 1.2; M.cloud.color.setHex(0xe6e9ef).lerp(tmpC.setHex(NIGHT.cloudNight), k * 0.9);
    { const IW = NIGHT.interiorWindow; M.daylight.emissive.set(IW.dayColor).lerp(tmpC.set(IW.nightColor), k); M.daylight.emissiveIntensity = IW.day + (IW.night - IW.day) * k; }
    renderer.toneMappingExposure = S.exp;
    // inside a building (not the hearth plaza) the island is hidden: once the enter frames settle, skip its whole simulation and every island-only pass and draw the room alone
    if (insideId !== pauseId) { pauseId = insideId; pauseN = 0; insideFrames = 0; }
    if (mode === 'inside' && insideId !== null && insideId !== 'hearth' && !director.active() && !still.engaged && !still.exporting) pauseN++; else pauseN = 0;
    { const w = window as unknown as { __prof?: Record<string, number> }; if (w.__prof) { w.__prof.pn = pauseN; w.__prof.dir = director.active() ? 1 : 0; w.__prof.stl = still.engaged ? 1 : 0; w.__prof.mi = mode === 'inside' ? 1 : 0; w.__prof.iid = insideId ? 1 : 0; } }
    if (pauseN > PAUSE_AFTER) {
      { const w = window as unknown as { __prof?: Record<string, number> }; if (w.__prof) { w.__prof.paused = pauseN; w.__prof.shadowNeeds = renderer.shadowMap.needsUpdate ? 1 : 0; } }
      const WP = weather.sample(dt); hemi.intensity *= 1 - WP.ok * 0.35; sun.intensity *= (1 - WP.ok * 0.75) * (0.85 + WP.sunK * 0.3);
      fog.density = 0; sun.intensity *= 0.18; hemi.intensity = Math.max(0.3, hemi.intensity * 0.5); IN.tick(t, camera);
      if (!(covered && performance.now() - coveredAt > COVERED_RENDER_MS) && !softHold(now, true)) drawFrame(dt, now);
      overlayUi?.update(now); return;
    }
    if (now - skyScan > 90) { skyScan = now; const r2 = document.documentElement.style; r2.setProperty('--h-sky-top', S.top); r2.setProperty('--h-sky-bot', S.bot); r2.setProperty('--h-sky-glow', S.glow); const name = S.name; if (name !== lastPeriod || Math.abs(hr - lastHr) > 0.12) { lastPeriod = name; lastHr = hr; opts.onSky?.({ hour: hr, period: name, night: k }); } }

    const nowMs = now;
    Object.values(plots).forEach((p) => {
      if (!p.dying && nowMs - p.born > p.delay) p.scale.t = 1;
      p.hover.t = (hovered === p.id || focusId === p.id) ? 1 : 0; p.scale.step(dt); p.hover.step(dt); p.pop.step(dt);
      const s = Math.max(0.0001, p.scale.x); const sq = p.pop.x * 0.06;
      p.g.scale.set(s * (1 + sq), s * (1 - sq * 1.4), s * (1 + sq)); p.g.position.y = ((p.g.userData.baseY as number | undefined) ?? 0) + p.hover.x * 0.22;
      p.open.t = 0; p.open.step(dt); p.door = p.door || spring(0, SPRINGS.plotDoor); p.door.t = focusId === p.id && mode !== 'island' ? 1 : 0; p.door.step(dt); const dk = Math.max(0, p.door.x); (p.g.userData.doors || []).forEach((d: { pivot: THREE.Group; dir: number }) => { d.pivot.rotation.y = d.dir * 1.45 * dk; }); if (p.g.userData.slide) p.g.userData.slide.m.position.x = p.g.userData.slide.x0 - 1.5 * dk; M.doorGlow.emissiveIntensity = Math.max(M.doorGlow.emissiveIntensity * 0.9, focusId === p.id ? dk * 1.6 : 0);
      (p.g.userData.roofMats || []).forEach((m: THREE.MeshStandardMaterial) => { tmpC2.copy(m.userData.base).lerp(WHITE, wx.cover * 0.85); m.color.lerpColors(tmpC2, GOLD, Math.min(1, Math.max(0, p.hover.x))); });
    });
    houses.forEach((h) => { if (!h.dying && nowMs - h.born > h.delay) h.s.t = 1; h.s.step(dt); h.g.scale.setScalar(Math.max(0.0001, h.s.x)); });
    if (houses.some((h) => h.dying && h.s.x < 0.02)) houses = houses.filter((h) => { if (h.dying && h.s.x < 0.02) { site?.releaseHouse(h.g); return false; } return true; });

    if (!reduced) {
      clouds.forEach((c) => { const u = c.userData; u.a += u.s * dt; c.position.set(Math.cos(u.a) * u.r * radK, u.y + Math.sin(t * 0.3 + u.r) * 0.2, Math.sin(u.a) * u.r * radK); /* a cloud between the camera and the island sat on the grass in screen space: shrink it away while it is on the camera's side */ let d = Math.atan2(c.position.x, c.position.z) - rig.az.x; d = Math.atan2(Math.sin(d), Math.cos(d)); const CS = CLOUDS.cameraSide; const want = Math.abs(d) < CS.halfAngle ? 0 : 1; u.k = (u.k ?? want) + (want - (u.k ?? want)) * Math.min(1, dt * CS.rate); c.scale.setScalar(u.base * Math.max(CS.minScale, u.k)); });
    }
    unreadT += dt; if (unreadT > 2.6) { unreadT = 0; Object.keys(unread).forEach((id) => { if (id !== 'chat' && unread[id]! > 0 && plots[id] && plots[id].built && !reduced) { const q = anchorOf(id); if (q) ring(q.x, q.z, { r0: 2.0, r1: 3.6, dur: 2.2, op: 0.6, w: 0.025 }); } }); }
    for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.life += dt / r.dur; if (r.life >= 1) { island.remove(r.m); r.m.geometry.dispose(); (r.m.material as THREE.Material).dispose(); rings.splice(i, 1); continue; } const e = 1 - Math.pow(1 - r.life, 3); r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * e); (r.m.material as THREE.Material).opacity = (1 - r.life) * r.op; }
    ravens.update(dt);

    archiK.t = archi ? 1 : 0; minis.forEach((m, i) => { m.s.t = archi ? 1 : 0; m.s.step(dt); m.g.scale.setScalar(Math.max(0.0001, m.s.x)); m.g.visible = m.s.x > 0.002; m.g.position.y = -0.5 + (reduced ? 0 : Math.sin(t * 0.6 + i * 1.7) * 0.5); });
    if (now - compassScan > 500) { compassEl = document.querySelector('[data-compass]'); compassScan = now; } if (compassEl) compassEl.style.transform = 'rotate(' + (rig.az.x * 180 / Math.PI).toFixed(1) + 'deg)';
    fx.burst = Math.max(0, fx.burst - dt);
    if (fx.spool) fx.spool.rotation.y += dt * (fx.spoolV + fx.burst * 6);
    threads.forEach((th) => { th.s.t = 1; th.s.step(dt); th.t = (th.t + dt * (0.28 + fx.burst * 0.9)) % 1; th.curve.getPoint(th.t, th.pulse.position); const sc = 0.6 + Math.sin(th.t * Math.PI) * 0.8 + fx.burst; th.pulse.scale.setScalar(Math.max(0.001, sc * th.s.x)); th.tube.scale.setScalar(1); });
    fx.fireLights.forEach((f, i) => { const fl = reduced ? 1 : (0.82 + Math.sin(t * 11 + i) * 0.08 + Math.sin(t * 23.7) * 0.06 + Math.random() * 0.04); f.l.intensity = f.b * (fx.fire + k * 0.8) * fl; if (f.f) f.f.scale.setScalar(0.9 + (fl - 0.8) * 2 * fx.fire); });
    if (fx.smokeOrigin && !reduced && plots.hearth && plots.hearth.built && plots.hearth.scale.x > 0.8) {
      if (fx.smoke.length < 14 && Math.random() < dt * (2 + fx.fire * 3)) { const m = new THREE.Object3D(); const wp = plots.hearth.g.localToWorld(fx.smokeOrigin.clone()); island.worldToLocal(wp); m.position.copy(wp); fx.smoke.push({ m, life: 0, dx: (Math.random() - 0.5) * 0.3 }); }
      fx.smoke = fx.smoke.filter((s) => { s.life += dt / 3.2; if (s.life >= 1) { return false; } s.m.position.y += dt * 0.55; s.m.position.x += dt * (0.25 + s.dx); s.m.scale.setScalar((0.6 + s.life * 2.2) * 0.2); s.m.userData.o = Math.sin(s.life * Math.PI) * 0.55; return true; });
    }
    hintT += dt;
    if (fx.seats) fx.seats.forEach((st, i) => { const spk = st.on && i === hints.speak; const ar = st.fig.userData.arms; if (ar && !reduced) { ar[1].rotation.x = spk ? -0.9 - Math.sin(t * 5.5) * 0.35 : ar[1].rotation.x * 0.9; ar[0].rotation.x = spk ? -0.3 - Math.sin(t * 4.2 + 1) * 0.2 : ar[0].rotation.x * 0.9; } if (spk && hintT > 1.3) { const wp = st.fig.getWorldPosition(new THREE.Vector3()); island.worldToLocal(wp); ring(wp.x, wp.z, { y: 0.3, r0: 0.15, r1: 0.7, dur: 1.1, w: 0.016, op: 0.8 }); } });
    if (hintT > 1.3) hintT = 0;
    { const sg = plots.arcade?.g.userData.arcadeSign as THREE.MeshStandardMaterial | undefined; if (sg) { const v = arcadeWaiting > 0 ? GAMES_HALL.litGlow + Math.sin(t * GAMES_HALL.pulseHz) * GAMES_HALL.pulse : GAMES_HALL.idleGlow; if (sg.emissiveIntensity !== v) sg.emissiveIntensity = v; } }
    if (fx.spool) fx.spoolV = hints.skein ? 1.4 + Math.sin(t * 2) * 0.4 : 0.35; loomLight.intensity = hints.skein && plots.skein && plots.skein.built ? 1.6 + Math.sin(t * 3) * 0.9 : 0; if (plots.skein) { const sp = anchorOf('skein'); if (sp) loomLight.position.set(sp.x, sp.y + 6.2, sp.z); }
    if (hints.board && plots.board && plots.board.built && plots.board.g.userData.smoke && !reduced && Math.random() < dt * 2.6 && shopSmoke.length < 12) { const m = new THREE.Object3D(); const wp = plots.board.g.localToWorld(plots.board.g.userData.smoke.clone()); island.worldToLocal(wp); m.position.copy(wp); shopSmoke.push({ m, life: 0 }); }
    shopSmoke = shopSmoke.filter((s2) => { s2.life += dt / 3; if (s2.life >= 1) { return false; } s2.m.position.y += dt * 0.6; s2.m.position.x += dt * (0.2 + wx.wind.x * 0.6); s2.m.scale.setScalar((0.5 + s2.life * 2) * 0.18); s2.m.userData.o = Math.sin(s2.life * Math.PI) * 0.5; return true; }); puffs.sync(fx.smoke, shopSmoke);
    visitors.forEach((v, i) => { v.s.t = v.on ? 1 : 0; v.s.step(dt); v.g.scale.setScalar(Math.max(0.0001, v.s.x) * 0.55); v.g.visible = v.s.x > 0.01; if (!reduced && v.on) { v.g.rotation.y = v.yaw + Math.sin(t * 0.7 + i * 2) * 0.25; const ar = v.g.userData.arms; if (ar && i % 2 === 0) ar[1].rotation.x = -1.2 - Math.sin(t * 1.5 + i) * 0.15; } });
    if (fx.seats) fx.seats.forEach((st, i) => { st.s.t = st.on ? 1 : 0; st.s.step(dt); st.fig.scale.setScalar(Math.max(0.0001, st.s.x)); if (st.on && !reduced) st.fig.children[0].position.y = 0.44 + Math.sin(t * 2 + i * 1.7) * 0.01; });
    const ents = SECTION_ORDER.filter((id) => id !== 'hearth' && plots[id] && plots[id].built);
    const fcA = anchorOf('fire'); const fcx = fcA ? fcA.x : 0, fcz = fcA ? fcA.z : 0;
    people.forEach((p) => {
      p.s.t = 1; p.s.step(dt); p.g.scale.setScalar(Math.max(0.0001, p.s.x));
      if (p.wait > 0) { p.wait -= dt; return; }
      if (p.t >= 1) { if (!p.to.lengthSq()) { const a0 = p.R() * Math.PI * 2; p.to.set(fcx + Math.cos(a0) * 3.2, 0, fcz + Math.sin(a0) * 3.2); } p.from.copy(p.to); const atPlaza = Math.hypot(p.from.x - fcx, p.from.z - fcz) < 3.9; if (atPlaza && ents.length) { const id = ents[Math.floor(p.R() * ents.length)]; const q0 = anchorOf(id)!; const qx = q0.x - fcx, qz = q0.z - fcz; const d = Math.hypot(qx, qz) || 1; const r = d - 2.1; const side = (p.R() - 0.5) * 0.5; p.to.set(fcx + (qx / d) * r + (qz / d) * side, 0, fcz + (qz / d) * r - (qx / d) * side); } else { const a = p.R() * Math.PI * 2, r = 2.95 + p.R() * 0.6; p.to.set(fcx + Math.cos(a) * r, 0, fcz + Math.sin(a) * r); } p.t = 0; p.dur = Math.max(1, p.from.distanceTo(p.to) / 0.9); p.wait = reduced ? 3 : p.R() * 2.5; p.g.position.copy(p.from); p.g.rotation.y = Math.atan2(p.to.x - p.from.x, p.to.z - p.from.z); return; }
      if (reduced) { p.t = 1; p.g.position.copy(p.to); return; }
      p.t = Math.min(1, p.t + dt / p.dur); const e = p.t < 0.5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2;
      p.g.position.lerpVectors(p.from, p.to, e); p.g.position.y = siteH(p.g.position.x, p.g.position.z) + Math.abs(Math.sin(p.t * p.dur * 9)) * 0.02; const Lg = p.g.userData.legs, Ar = p.g.userData.arms; if (Lg) { const sw = Math.sin(p.t * p.dur * 9) * 0.55 * Math.min(1, Math.sin(p.t * Math.PI) * 4); Lg[0].rotation.x = sw; Lg[1].rotation.x = -sw; if (Ar) { Ar[0].rotation.x = -sw * 0.8; Ar[1].rotation.x = sw * 0.8; } }
    });

    const WS = weather.sample(dt);
    const { rk, sk, fk, ok, sunK, wind } = WS; pipeline.setFogWeather(fk, rk);
    windU.uTime.value = reduced ? 0 : t; windU.uWind.value = wind; windU.uOn.value = reduced ? 0 : 1; if (!reduced) WK.T.waterN.offset.set(t * WATER.flow[0], t * WATER.flow[1]);
    hemi.intensity *= 1 - ok * 0.35; sun.intensity *= (1 - ok * 0.75) * (0.85 + sunK * 0.3); sun.shadow.radius = Q.shadowRadius + ok * 10;
    if (sk > 0.001) wx.cover = Math.min(1, wx.cover + dt * 0.05 * sk); else wx.cover = Math.max(0, wx.cover - dt * 0.08);
    const cv = wx.cover; [M.path, M.stone].forEach((m) => { m.color.copy(m.userData.base).lerp(WHITE, cv * 0.6); }); [M.terrain, M.foliage, M.grass, M.leafCard].forEach((m) => { if (!m) return; const sn = cv * 0.5 * (1 - k * 0.75); const lift = k * (m === M.terrain ? NIGHT.groundLift : NIGHT.foliageLift); m.emissive.setRGB(sn + lift * 0.55, sn + lift * 0.75, sn + lift); }); WK.houseRoofs.forEach((m) => { tmpC2.copy(m.userData.base).lerp(WHITE, cv * 0.85); m.color.copy(tmpC2); });
    fxU.uTime.value = t; fxU.uNight.value = k; fxU.uParallax.value = tier === 'ultra' ? 0.035 : 0; surfaceU.uWet.value = rk; surfaceU.uSnow.value = wx.cover; if ((fxTick += dt) > 4) { fxTick = 0; const before = fxStats.patched + fxStats.swept; surfaceFxTree(world); fxSweep(); const sig = Q.msaa * 10 + (tier === 'ultra' ? 1 : 0); if (fxStats.patched + fxStats.swept !== before || sig !== fxSig) { fxSig = sig; void withSceneTarget(() => renderer.compileAsync(scene, camera)).catch(() => undefined); } } // only when the scene or tier changed: patched materials recompile once, never per frame
    M.ground.roughness = 0.95 - rk * 0.55; M.path.roughness = 1 - rk * 0.6; M.stone.roughness = 0.9 - rk * 0.45;
    fog.color.set(S.bot).lerp(tmpC.setRGB(0.55, 0.54, 0.53), ok * 0.4); fog.density = (NIGHT.fogDay + (NIGHT.fogNight - NIGHT.fogDay) * k + fk * 0.022 + ok * 0.004) * (1 - archiK.x * 0.9);
    if (pipeline.froxel) fog.density = 0; // the froxel volume already carries base, night, fog and rain extinction
    const outside = !(mode === 'inside' && insideId !== 'hearth'); if (!outside) { fog.density = 0; sun.intensity *= 0.18; hemi.intensity = Math.max(0.3, hemi.intensity * 0.5); } IN.tick(t, camera);
    // inside a room the island (meshes, lamps, flames, its shadow casters) is not rendered at all: fewer lights in every interior shader and no wasted shadow pass
    if (world.visible !== outside) { world.visible = outside; renderer.shadowMap.needsUpdate = true; }
    skyColors.top.set(S.top).multiplyScalar(0.6).add(tmpC.setRGB(S.hemi[0], S.hemi[1], S.hemi[2]).multiplyScalar(hemi.intensity / Math.PI)); skyColors.bottom.set(S.bot).multiplyScalar(0.5).add(tmpC.setRGB(0.81, 0.77, 0.71).multiplyScalar((hemi.intensity * 0.5) / Math.PI));
    env.update(hr, S, sunDir.copy(sun.position).normalize(), isSun, outside ? 1 : 0.16);
    weather.update(dt, t, WS, { k, archiK: archiK.x, outside });
    if (!reduced) clouds.forEach((c) => { c.userData.a += wind * 0.01 * dt; });
    weather.lightning(dt, hemi);
    camera.updateMatrixWorld(); camFrustum.setFromProjectionMatrix(camVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); siteLights.forEach(({ l, spec }, i) => { const base = spec.cd / (LIGHT_UNIT_METERS * LIGHT_UNIT_METERS); l.visible = i < SITE_LIGHT_CAP[QUALITY_ORDER.indexOf(tier)] && lightRank(spec.minTier) <= QUALITY_ORDER.indexOf(tier); l.intensity = l.visible ? (spec.night ? Math.max(0, k - 0.2) * base : base) * (reduced ? 1 : 0.96 + Math.sin(t * 9 + i * 1.9) * 0.025 + Math.sin(t * 21 + i) * 0.015) : 0; });
    winLights.update(dt, k, outside);
    site?.update({ dt, t, night: k, wind, cover: wx.cover, reduced, frustum: camFrustum, camPos: camera.position, camDist: rig.dist.x, fogDensity: fog.density });
    // inside a room the scene is static (figures do not cast): refresh shadows only for a short settle window after entering, not every 3rd frame
    if (!outside) { if (insideFrames++ < 12) renderer.shadowMap.needsUpdate = true; } else { insideFrames = 0; if (++shadowTick % SHADOW_EVERY === 0 || (mode !== 'island' && world.visible)) renderer.shadowMap.needsUpdate = true; } // shadow maps are the costliest pass: refresh at 1/SHADOW_EVERY rate
    // path traced still: camera unchanged for STILL.idleMs (photo mode, or the ultra tier) -> progressive refine, cancelled the frame the camera moves
    { const me = camera.matrixWorld.elements; let moved = (soft ? Math.abs(camera.fov - sigFov) > QUALITY_DETECT.softwareFovEps : camera.fov !== sigFov) || W !== sigW || H !== sigH || Math.abs(hr - sigHr) > 0.0008 || mode === 'inside' !== sigIn; for (let i = 0; i < 16; i++) if (Math.abs(me[i] - sigM[i]) > 1e-6) { moved = true; sigM[i] = me[i]; }
      if (Math.abs(hr - sigHr) > 0.0008) still.invalidate(); sigFov = camera.fov; sigW = W; sigH = H; sigHr = hr; sigIn = mode === 'inside'; if (moved) stableMs = 0; else stableMs += dt * 1000;
      if (still.exporting) { still.step(); return; }
      if (tier === STILL.idleTier && !still.engaged && stableMs > 300 && stableMs < STILL.idleMs && !panelOpen && !focusId && mode === 'island') { if (still.prewarm() && stableMs > 700) void still.prepare(); } // textures first, then BVH and tables, both before the 2 s idle trigger
      const ok = !reduced && !(window as { __noStill?: boolean }).__noStill && still.available && (photo || tier === STILL.idleTier) && !down && !director.active() && stableMs >= STILL.idleMs && (photo || gi.progress >= 1 || stableMs >= STILL.giWaitMs) && Math.abs(photoK.x - photoK.t) < 0.01 && Math.abs(archiK.x - archiK.t) < 0.01 && ferry.x < 0.01
        && (photo || (!panelOpen && !focusId && mode === 'island' && performance.now() - lastInputAt >= STILL.idleMs && Object.values(rig).every((s) => Math.abs(s.x - s.t) < 1e-3 && Math.abs(s.v) < 1e-3)));
      if (ok) { if (!still.engaged) void still.engage(photo ? STILL.photoSamples : STILL.idleSamples, photo ? STILL.tilesPhoto : STILL.tilesIdle); } else if (still.engaged) still.cancel();
      if (still.engaged) { still.step(); return; } }
    if (covered && performance.now() - coveredAt > COVERED_RENDER_MS) { overlayUi?.update(now); return; }
    if (softHold(now, stableMs > QUALITY_DETECT.softwareSettleMs)) { overlayUi?.update(now); return; }
    if (mode !== 'inside') {
      // GI treats only a real camera move (fast pan, orbit, zoom: relative speed above GI.busySpeed per second) as busy: the slow idle spin (CAMERA.idleSpin), drift and handheld sway must not pin the bake to one probe per frame
      const dts = Math.max(dt, 0.001); const fast = camera.position.distanceTo(giPos) / dts / Math.max(1, camera.position.length()) > GI.busySpeed || camera.quaternion.angleTo(giQuat) / dts > GI.busyTurn || Math.abs(camera.fov - giFov) > 0.02; giPos.copy(camera.position); giQuat.copy(camera.quaternion); giFov = camera.fov; giBusyMs = fast ? 0 : giBusyMs + dt * 1000;
      const typing = performance.now() - lastInputAt < STILL.settleMs; gi.setIsland(siteR(), 0); gi.update(dt, hr, k, giBusyMs < STILL.settleMs || typing, typing); }
    // The mirror pass cannot render shadows itself (needsUpdate is held off), so with no sun map yet its draws would sample an empty shadow texture: wait for the main pass to build it.
    if (!still.engaged && sun.shadow.map) waterPlanar.update(scene, camera, Q.msaa, pipeline.sceneTarget); // planar water: mirror + refraction passes over the water footprint at 1x
    drawFrame(dt, now);
    overlayUi?.update(now);
  }
  raf = requestAnimationFrame(frame);
  // The frame watchdog (a tab whose rAF stalls) runs only while visible: a hidden window has no timers left running (T-018).
  const watch = () => setInterval(() => { if (!alive || document.hidden) return; const n = performance.now(); if (n - last > 200) { cancelAnimationFrame(raf); frame(n); } }, 33);
  let watchdog = document.hidden ? undefined : watch();
  const onVis = () => {
    clearInterval(watchdog); cancelAnimationFrame(raf);
    if (document.hidden) return;
    if (alive) { last = performance.now(); idle = 0; raf = requestAnimationFrame(frame); watchdog = watch(); }
  };
  document.addEventListener('visibilitychange', onVis);

  const api: TownApi = {
    setSpace(info, o) {
      still.invalidate(); setTimeout(() => gi.invalidate(), 4500);
      IN.setContext({ seed: info.id, online: info.online ?? 0 });
      applyArcade(info);
      spaceStyle = info.map_style ?? null; const wantStyle = resolveMapStyle(spaceStyle);
      if (pendingBuild && info.id === pendingBuild.id) { pendingBuild = info; current = info; styleId = wantStyle; return; }
      if (current && info.id === current.id && wantStyle !== styleId) { current = info; switchStyle(wantStyle); return; }
      if (!current || info.id !== current.id) styleId = wantStyle;
      if (o && o.raise) { current = info; raise(o.raise); return; }
      if (!current) { build(info, true); return; }
      if (info.id === current.id && info.sections.length === current.sections.length && info.sections.every((x) => current!.sections.includes(x))) { applyGrowth(info); return; }
      ravens.scatterPerched(); ravens.holdPerch(TIMING.perchCooldownSwitch);
      cancelLater(); pendingBuild = info; current = info;
      Object.values(plots).forEach((p, i) => { p.dying = true; p.delay = 0; later(() => { p.scale.t = 0; }, reduced ? 0 : i * TIMING.plotKillStagger); });
      people.forEach((p) => { p.s.t = 0; });
      threads.forEach((th) => { th.s.t = 0; th.tube.visible = false; });
      userAz += 1.1; if (!focusId) rig.az.t = userAz; if (!reduced) { ferry.t = 1; later(() => { ferry.t = 0; }, TIMING.switchFerryMs); }
      later(() => { const next = pendingBuild; pendingBuild = null; if (next) build(next, false); }, reduced ? 0 : TIMING.switchBuildMs);
    },
    approach, enter, leave: leaveInside, mode: () => mode, paintInterior(id, data) { IN.paint(id, data); },
    focus, setTheme, hover: setHover, screenPos, recenter, zoomBy: (d) => zoomAt(d), rotateBy: (a) => { userAz += a; rig.az.t = userAz; },
    setCovered(on) { if (on !== covered) { covered = on; coveredAt = performance.now(); } },
    setPanel(open) { if (open === panelOpen) return; panelOpen = open; if (focusId && mode === 'island' && anchorOf(focusId)) focus(focusId as PickId); },
    setFire(on) { fx.fire = on ? 1.6 : 0.6; },
    setRoom(n, me, speak) { room = { n, me }; if (speak != null) hints.speak = speak; applyRoom(); },
    burst() { fx.burst = 2.4; },
    sendRaven: ravens.sendRaven, flyIn: ravens.flyIn, flyOut: ravens.flyOut, setUnread(m) { unread = m || {}; }, setWeather: weather.setWeather,
    setPerched(here, away) { ravens.setWant(here, away); },
    setHints(h) { hints = Object.assign(hints, h || {}); applyVisitors(); },
    setTimeOfDay(v) { clockMode = 'manual'; setHour(v * 24); },
    setHour(h, instant) { clockMode = 'manual'; setHour(h, instant); }, setClockMode(m) { clockMode = m; liveScan = 0; if (m === 'live') { const d = new Date(); setHour(d.getHours() + d.getMinutes() / 60); } }, getHour: () => ((hourS.x % 24) + 24) % 24,
    setArchipelago(on, list) { idle = 0; if (on && list) { const others = list.filter((x) => !current || x.id !== current.id); const key = JSON.stringify(others.map((sp) => [sp.id, sp.map_style, sp.sections, sp.growth?.buildings, arcadeWaitingOf(sp)])); if (key !== miniKey) { miniKey = key; minis.forEach((m) => drop(m.g)); minis = others.map((sp, i) => { const g = makeMini(sp); const a = (i / others.length) * Math.PI * 2 + Math.PI / 5; g.position.set(Math.cos(a) * ISLAND.archiRadius, -0.5, Math.sin(a) * ISLAND.archiRadius); world.add(g); return { id: sp.id, g, s: spring(0, SPRINGS.mini) }; }); minis.forEach((m, i) => { later(() => { m.s.v = 0; }, i * TIMING.archiStagger); }); } } archi = !!on; if (on) { userTx = userTz = 0; } },
    setPhoto(on) { photo = !!on; photoK.t = on ? 1 : 0; idle = 0; },
    snapshotStill: (samples) => still.capture(samples),
    snapshot() { pipeline.render(0); return renderer.domElement.toDataURL('image/png'); },
    setQuality(t) { if (t === 'auto') { autoQ = true; try { window.localStorage.removeItem('hermod.quality'); } catch { /* storage blocked */ } applyQuality(autoTier()); } else { autoQ = false; try { window.localStorage.setItem('hermod.quality', t); } catch { /* storage blocked */ } applyQuality(t); } adaptive.reset(); },
    setMapStyle(st) { if (st === 'default') { setLocalMapStyle(null); switchStyle(resolveMapStyle(spaceStyle, null)); } else { setLocalMapStyle(st); switchStyle(st); } },
    getMapStyle: () => ({ style: styleId, local: getLocalMapStyle() !== null }),
    renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, site: site ? site.stats() : null, meshesInScene: (() => { const c: Record<string, number> = {}; scene.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; let v = true, q: THREE.Object3D | null = m; while (q) { if (!q.visible) v = false; q = q.parent; } if (!v) return; const k = (m.name || (m.material as THREE.Material).name || m.geometry.type).replace(/[0-9._]+/g, '#').slice(0, 28); c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 12); })() }),
    getQuality: () => ({ tier, auto: autoQ, giProgress: gi.progress, stillSamples: still.samples, stillEngaged: still.engaged }),
    dispose() { puffs.dispose(); waterPlanar.dispose(); winLights.dispose(); hifiOff?.(); hifiOff = null; site?.dispose(); site = null; gi.dispose(); still.dispose(); document.removeEventListener('visibilitychange', onVis); pipeline.dispose(); env.dispose(); clearInterval(watchdog); window.removeEventListener('keydown', onKeyNav); for (const ev of INPUT_EVENTS) window.removeEventListener(ev, markInput); cancelLater(); minis.forEach((m) => drop(m.g)); minis = []; window.removeEventListener('pointermove', onAnyMove); alive = false; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); },
  };
  return api;
}
