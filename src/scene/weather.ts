import * as THREE from 'three';
import { COLORS, LIGHTNING, LIGHTS, SPRINGS, WEATHER_PARTICLES, WEATHER_TARGETS, type WeatherKind } from '@/config/scene';
import { disposeTree } from './dispose';
import { rng } from './rng';
import { spring } from './spring';

export interface WeatherDeps {
  scene: THREE.Scene; world: THREE.Group; reduced: boolean; onFlash?: () => void;
}
/** Spring-smoothed weather intensities for the current frame. */
export interface WeatherSample { rk: number; sk: number; fk: number; ok: number; sunK: number; wind: number }
/** Per-frame inputs from the town loop. */
export interface WeatherFrame { k: number; archiK: number; outside: boolean }

/** Rain, snow, dust motes, storm clouds, splashes and lightning, driven by a handful of springs. */
export function createWeather({ scene, world, reduced, onFlash }: WeatherDeps) {
  const WB = WEATHER_PARTICLES.box;
  const rainN = WEATHER_PARTICLES.rain, rainPos = new Float32Array(rainN * 6), rainSeed = new Float32Array(rainN);
  for (let i = 0; i < rainN; i++) { rainSeed[i] = Math.random(); const x = (Math.random() * 2 - 1) * WB.x, y = Math.random() * WB.y, z = (Math.random() * 2 - 1) * WB.x; rainPos.set([x, y, z, x, y - 0.5, z], i * 6); }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: COLORS.rain, transparent: true, opacity: 0, depthWrite: false })); world.add(rain);
  const snowN = WEATHER_PARTICLES.snow, snowPos = new Float32Array(snowN * 3), snowSeed = new Float32Array(snowN);
  for (let i = 0; i < snowN; i++) { snowSeed[i] = Math.random(); snowPos.set([(Math.random() * 2 - 1) * WB.x, Math.random() * WB.y, (Math.random() * 2 - 1) * WB.x], i * 3); }
  const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const flake = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; })();
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ map: flake, color: 0xffffff, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false })); world.add(snow);
  const moteN = WEATHER_PARTICLES.motes, motePos = new Float32Array(moteN * 3); for (let i = 0; i < moteN; i++) motePos.set([(Math.random() * 2 - 1) * 13, 0.5 + Math.random() * 7, (Math.random() * 2 - 1) * 13], i * 3);
  const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ map: flake, color: COLORS.motes, size: 0.12, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); world.add(motes);
  const stormMat = new THREE.MeshStandardMaterial({ flatShading: false, color: COLORS.storm, roughness: 1, metalness: 0, transparent: true, opacity: 0 });
  const stormClouds = Array.from({ length: 9 }, (_, i) => { const g = new THREE.Group(); const Rr = rng('storm' + i); for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(1.1 + Rr() * 0.9, 48, 32), stormMat); s.position.set((k - 2.5) * 1.1, Rr() * 0.5, (Rr() - 0.5) * 1.4); s.castShadow = true; g.add(s); } g.userData = { a: (i / 9) * Math.PI * 2, r: 9 + (i % 3) * 5, y: 17 + (i % 2) * 1.5, s: 0.02 + (i % 4) * 0.006 }; g.visible = false; world.add(g); return g; });
  const splashes: { m: THREE.Mesh; life: number }[] = []; const splashGeo = new THREE.TorusGeometry(1, 0.012, 8, 64);
  const bolt = new THREE.PointLight(LIGHTS.bolt.color, 0, LIGHTS.bolt.distance, 1); bolt.position.set(0, LIGHTS.bolt.y, 0); scene.add(bolt);
  const wx = { kind: 'clear' as WeatherKind, rainK: spring(0, SPRINGS.rain), snowK: spring(0, SPRINGS.snow), fogK: spring(0, SPRINGS.fog), overK: spring(0, SPRINGS.over), sunK: spring(1, SPRINGS.sun), wind: spring(0.3, SPRINGS.wind), cover: 0, flash: 0, nextBolt: 4 };
  type SpringKey = 'rainK' | 'snowK' | 'fogK' | 'overK' | 'sunK' | 'wind';
  const SPRING_KEYS: SpringKey[] = ['rainK', 'snowK', 'fogK', 'overK', 'sunK', 'wind'];

  function setWeather(kind: WeatherKind) {
    wx.kind = kind; const T = WEATHER_TARGETS[kind] || WEATHER_TARGETS.clear;
    wx.rainK.t = T[0]; wx.snowK.t = T[1]; wx.fogK.t = T[2]; wx.overK.t = T[3]; wx.sunK.t = T[4]; wx.wind.t = T[5];
    if (reduced) SPRING_KEYS.forEach((k) => wx[k].snap(wx[k].t));
  }
  /** Step the weather springs and return the clamped intensities. */
  function sample(dt: number): WeatherSample {
    SPRING_KEYS.forEach((k2) => wx[k2].step(dt));
    return { rk: Math.max(0, wx.rainK.x), sk: Math.max(0, wx.snowK.x), fk: Math.max(0, wx.fogK.x), ok: Math.max(0, wx.overK.x), sunK: Math.max(0, wx.sunK.x), wind: wx.wind.x };
  }
  /** Move particles, fade storm clouds and fire lightning (adds a flash to the hemisphere light). */
  function update(dt: number, t: number, S: WeatherSample, { k, archiK, outside }: WeatherFrame) {
    const { rk, sk, ok, sunK, wind } = S;
    rain.material.opacity = Math.min(0.75, rk * 0.6) * (1 - archiK); rain.visible = rk > 0.01 && outside; rain.material.color.setRGB(0.56 + k * 0.2, 0.54 + k * 0.22, 0.52 + k * 0.28);
    if (rain.visible && !reduced) { const p = rainGeo.attributes.position.array as Float32Array; const sp = 22 + rk * 8, sx = wind * 3.5; for (let i = 0; i < rainN; i++) { const o = i * 6; let y = p[o + 1] - sp * dt * (0.8 + rainSeed[i] * 0.4); let x = p[o] + sx * dt; if (y < 0) { if (Math.random() < 0.06 * rk && splashes.length < WEATHER_PARTICLES.maxSplashes && Math.abs(p[o]) < 12 && Math.abs(p[o + 2]) < 12 && Math.hypot(p[o], p[o + 2]) < 12) { const m = new THREE.Mesh(splashGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false })); m.rotation.x = Math.PI / 2; m.position.set(p[o], 0.1, p[o + 2]); world.add(m); splashes.push({ m, life: 0 }); } y += WB.y; x = (Math.random() * 2 - 1) * WB.x; p[o + 2] = p[o + 5] = (Math.random() * 2 - 1) * WB.x; } if (x > WB.x) x -= WB.x * 2; const len = 0.45 + rk * 0.35; p[o] = x; p[o + 1] = y; p[o + 3] = x - sx * 0.03; p[o + 4] = y + len; } rainGeo.attributes.position.needsUpdate = true; }
    for (let i = splashes.length - 1; i >= 0; i--) { const s2 = splashes[i]; s2.life += dt / 0.5; if (s2.life >= 1) { world.remove(s2.m); (s2.m.material as THREE.Material).dispose(); splashes.splice(i, 1); continue; } s2.m.scale.setScalar(0.04 + s2.life * 0.22); (s2.m.material as THREE.MeshBasicMaterial).opacity = (1 - s2.life) * 0.55; }
    snow.material.opacity = Math.min(1, sk) * (1 - archiK); snow.visible = sk > 0.01 && outside;
    if (snow.visible && !reduced) { const p = snowGeo.attributes.position.array as Float32Array; for (let i = 0; i < snowN; i++) { const o = i * 3, sd = snowSeed[i]; p[o + 1] -= dt * (0.9 + sd * 0.8); p[o] += dt * (Math.sin(t * 0.8 + sd * 40) * 0.35 + wind * 1.4); p[o + 2] += dt * Math.cos(t * 0.6 + sd * 30) * 0.3; if (p[o + 1] < 0) { p[o + 1] += WB.y; p[o] = (Math.random() * 2 - 1) * WB.x; p[o + 2] = (Math.random() * 2 - 1) * WB.x; } if (p[o] > WB.x) p[o] -= WB.x * 2; } snowGeo.attributes.position.needsUpdate = true; }
    motes.material.opacity = sunK * (1 - k) * (1 - ok) * 0.8; motes.visible = motes.material.opacity > 0.01;
    if (motes.visible && !reduced) { const p = moteGeo.attributes.position.array as Float32Array; for (let i = 0; i < moteN; i++) { const o = i * 3; p[o] += Math.sin(t * 0.3 + i) * dt * 0.15; p[o + 1] += Math.cos(t * 0.4 + i * 1.3) * dt * 0.1; } moteGeo.attributes.position.needsUpdate = true; }
    stormMat.opacity = Math.min(0.82, ok * 0.8) * (1 - archiK); stormMat.color.setRGB(0.55 + (1 - rk) * 0.3 - k * 0.3, 0.53 + (1 - rk) * 0.3 - k * 0.3, 0.52 + (1 - rk) * 0.3 - k * 0.28);
    stormClouds.forEach((c) => { const u = c.userData; c.visible = ok > 0.02; if (!reduced) u.a += (u.s + wind * 0.02) * dt; c.position.set(Math.cos(u.a) * u.r, u.y - ok * 1.5 + Math.sin(t * 0.25 + u.r) * 0.2, Math.sin(u.a) * u.r); c.scale.setScalar(0.55 + ok * 0.4); });
  }
  /** Lightning timer: call after the cloud drift so ordering matches the prototype. */
  function lightning(dt: number, hemi: THREE.HemisphereLight) {
    if (wx.kind === 'storm' && !reduced) { wx.nextBolt -= dt; if (wx.nextBolt <= 0) { wx.flash = 1; wx.nextBolt = LIGHTNING.minGap + Math.random() * LIGHTNING.spread; bolt.position.set((Math.random() - 0.5) * 30, 22, (Math.random() - 0.5) * 30); onFlash?.(); } }
    wx.flash = Math.max(0, wx.flash - dt * LIGHTNING.decay); const fl = wx.flash * wx.flash; bolt.intensity = fl * LIGHTNING.bolt; hemi.intensity += fl * LIGHTNING.hemi; // eased single fade: the old sin(flash * 40) gate strobed at ~20 Hz
  }
  /** Remove every weather object from the scene and free its geometry, materials and textures (flake map included). */
  function dispose() {
    for (const o of [rain, snow, motes, ...stormClouds]) { o.removeFromParent(); disposeTree(o); }
    splashes.splice(0).forEach((sp) => { sp.m.removeFromParent(); disposeTree(sp.m); });
    splashGeo.dispose(); bolt.removeFromParent();
  }
  return { wx, setWeather, sample, update, lightning, dispose };
}
