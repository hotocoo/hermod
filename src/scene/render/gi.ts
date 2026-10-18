import * as THREE from 'three';
import { LightProbeGridWebGL } from 'three/examples/jsm/lighting/LightProbeGridWebGL.js';
import { GI, type QualitySpec } from '@/config/scene';
import { classify, type PassCull } from './passCull';

type GiSpec = NonNullable<QualitySpec['gi']>;
/** Bake accounting: bake() calls, probes baked and CPU ms spent in them (dev probes read `window.__giStats`). */
export const giStats = { calls: 0, probes: 0, ms: 0, total: 0, passes: 0, noRoom: 0, noInput: 0, notDirty: 0, cpuBase: 0, dirty: false, cursor: 0, pass: 0, updates: 0 };
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') (window as unknown as { __giStats: unknown }).__giStats = giStats;

/**
 * Dynamic probe-volume global illumination (DDGI style) on WebGL2: a grid of L2 SH irradiance probes around the island, rebaked
 * incrementally (a few probes per frame, only while frames are cheap) when the sky, the lamps, the buildings or the island change.
 * Probe cubemaps render the real lit scene, so emissive windows, lamps and fire bounce light into their surroundings. The sky itself
 * stays with the hemisphere light and the environment map; the probes add the bounce and the emitters on top, which avoids double counting.
 */
export function createProbeGI(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hide: () => readonly THREE.Object3D[], onAttach?: () => void) {
  let spec: GiSpec | null = null; let grid: LightProbeGridWebGL | null = null;
  let radius = 12.6; let baseY = 0;
  let dirty = true; let cursor = 0; let pass = 0; let total = 0; let lastHour = -99; let lastEmit = -99; let baked = false;

  function dispose() { if (grid) { scene.remove(grid); grid.dispose(); grid = null; } baked = false; }
  function rebuild() {
    dispose(); if (!spec) return;
    const ext = (radius + GI.pad) * 2; const n = (len: number) => Math.max(2, Math.round(len / spec!.spacing) + 1);
    grid = new LightProbeGridWebGL(ext, GI.height, ext, n(ext), n(GI.height), n(ext));
    grid.position.set(0, baseY + GI.floor + GI.height / 2, 0); grid.updateBoundingBox();
    total = grid.resolution.x * grid.resolution.y * grid.resolution.z; cursor = 0; pass = 0; dirty = true;
  }
  let costMs = 2; // moving average cost of baking one probe (CPU submit time)
  let cpuBase = 8, lastBakeMs = 0; // moving average CPU ms of a frame without its bake work, and the bake ms of the frame in progress
  let skip: PassCull | null = null; // probe cubemaps never draw small props, particles, decals or figures: rebuilt at the start of every pass
  let reqR = 0, reqY = 0, stable = 0; // island fit requests: the volume is rebuilt only once the radius has stopped moving (growth animation)
  /** Bake as many probes as the frame budget allows (at most `perFrame`); the grid joins the scene once a first full pass exists. */
  function bakeStep(budgetMs: number, maxCount: number) {
    if (!grid || !spec) return;
    const count = Math.min(Math.max(1, Math.floor(budgetMs / costMs)), maxCount, total - cursor);
    if (cursor === 0 || !skip) skip = classify(scene, GI.probeSmallR);
    const g = grid; const off = [...hide(), ...skip.small, ...skip.sprites, ...skip.figures]; const was = off.map((o) => o.visible); const t0 = performance.now();
    off.forEach((o) => { o.visible = false; }); g.visible = pass > 0;
    // bake() forces a shadow-map render per call; the live frame already keeps these maps current, so freeze them for the probes (a 4096 sun map re-rendered per probe dominated the cost)
    const frozen: { sh: THREE.LightShadow; auto: boolean }[] = []; scene.traverse((o) => { const l = o as THREE.Light & { shadow?: THREE.LightShadow }; if (l.isLight && l.castShadow && l.shadow?.map) frozen.push({ sh: l.shadow, auto: l.shadow.autoUpdate }); }); frozen.forEach((f) => { f.sh.autoUpdate = false; f.sh.needsUpdate = false; }); const sn = renderer.shadowMap.needsUpdate; // bake() consumes this flag: hand it back so the live frame still refreshes its shadows
    try { g.bake(renderer, scene, { cubemapSize: spec.cube, near: GI.near, far: GI.far, start: cursor, count, pass }); } finally { frozen.forEach((f) => { f.sh.autoUpdate = f.auto; }); renderer.shadowMap.needsUpdate = sn; off.forEach((o, i) => { o.visible = was[i]; }); g.visible = shown; }
    { const dtb = performance.now() - t0; lastBakeMs += dtb; giStats.calls++; giStats.probes += count; giStats.ms += dtb; giStats.total = total; giStats.passes = spec.bounces + 1; }
    costMs = costMs * 0.8 + Math.min(20, (performance.now() - t0) / count) * 0.2; // one-off shader compiles must not freeze the estimate high
    cursor += count;
    if (cursor < total) return;
    cursor = 0; if (pass < spec.bounces) pass++; else { dirty = false; pass = 0; }
    if (!g.parent) { scene.add(g); onAttach?.(); } // a grid in the scene changes every lit material's program key: the caller compiles that variant (render gated) before it is drawn
    baked = true;
  }
  let shown = true;
  return {
    /** Hide the probe volume while the camera is inside a room (the room lies outside it, so every room shader would sample it for nothing and compile a different program). */
    setVisible(v: boolean) { shown = v; if (grid) grid.visible = v; },
    get active() { return !!grid && baked; },
    get progress() { return !grid ? 0 : dirty ? (cursor + pass * total) / (total * (1 + (spec?.bounces ?? 0))) : 1; },
    configure(s: QualitySpec['gi']) { const changed = JSON.stringify(s) !== JSON.stringify(spec); spec = s; if (changed) rebuild(); },
    /** Island footprint or height changed: re-fit the volume and rebake everything. */
    setIsland(r: number, y: number) {
      if (Math.abs(r - radius) < 0.05 && Math.abs(y - baseY) < 0.05 && grid) { stable = 0; reqR = r; reqY = y; return; }
      if (grid) { if (Math.abs(r - reqR) < 0.05 && Math.abs(y - reqY) < 0.05) stable++; else { stable = 0; reqR = r; reqY = y; } if (stable < GI.fitStableFrames) return; } // growth animates the radius every frame: refit once it holds still
      radius = r; baseY = y; stable = 0; reqR = r; reqY = y; rebuild();
    },
    /** Called once per frame with the CPU ms the whole frame took (bake included): the gate bakes only into the headroom under `GI.maxFrameMs`, measured without the bake's own share. */
    noteFrame(ms: number) { cpuBase += (Math.max(0, ms - lastBakeMs) - cpuBase) * 0.1; lastBakeMs = 0; },
    invalidate() { dirty = true; cursor = 0; pass = 0; },
    /** Per frame: `hour` and `emit` (0..1 lamp and window glow) trigger a rebake when they moved enough; `dt` seconds gates the work. */
    update(dt: number, hour: number, emit: number, interacting = false, userInput = false) {
      if (!spec || !grid) return;
      let dh = Math.abs(hour - lastHour); if (dh > 12) dh = 24 - dh;
      if (!dirty && (dh >= GI.rebakeHours || Math.abs(emit - lastEmit) >= GI.rebakeEmissiveDelta)) { dirty = true; cursor = 0; pass = 0; }
      if (dirty && cursor === 0 && pass === 0) { lastHour = hour; lastEmit = emit; }
      // hard slice: one probe per frame while the camera moves (idle drift included), none while the user's input is live (a six-face cube render of a tier-5 island took ultra to 30 fps), the full budget only when the view is settled
      // bake only into the headroom under maxFrameMs: a gate on the previous frame's dt alternated bake and skip frames, because the bake frame itself missed the vsync
      giStats.updates++; giStats.cpuBase = cpuBase; giStats.dirty = dirty; giStats.cursor = cursor; giStats.pass = pass; if (!dirty) giStats.notDirty++; else if (userInput) giStats.noInput++; else if (GI.maxFrameMs - cpuBase < GI.minRoomMs) giStats.noRoom++;
      const room = GI.maxFrameMs - cpuBase; if (dirty && !userInput && room >= GI.minRoomMs) bakeStep(Math.min(interacting ? GI.interactBudgetMs : GI.frameBudgetMs, room), interacting ? 1 : spec.perFrame);
    },
    dispose,
  };
}
export type ProbeGI = ReturnType<typeof createProbeGI>;
