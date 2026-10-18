import * as THREE from 'three';
import { COLORS, SKY_KEYFRAMES, type Rgb } from '@/config/scene';
import { rng } from './rng';

/** One sampled moment of the day (CSS colours for the page sky, rgb triples for the lights). */
export interface SkySample {
  name: string; top: string; bot: string; glow: string; hemi: number[]; hi: number; sun: number[]; si: number; night: number; exp: number;
}

const cA = new THREE.Color(), cB = new THREE.Color();
const mixHex = (a: string, b: string, f: number) => '#' + cA.set(a).lerp(cB.set(b), f).getHexString();
const mixRgba = (a: string, b: string, f: number) => { const pa = a.match(/[\d.]+/g)!.map(Number), pb = b.match(/[\d.]+/g)!.map(Number); return 'rgba(' + pa.map((v, i) => (i < 3 ? Math.round(v + (pb[i] - v) * f) : (v + (pb[i] - v) * f).toFixed(3))).join(',') + ')'; };
const mixRgb = (a: Rgb, b: Rgb, L: (x: number, y: number) => number) => a.map((v, j) => L(v, b[j]));

/** Interpolate the keyframe table at hour h (0..24) with a smoothstep between neighbours. */
export function sampleSky(h: number): SkySample {
  const KF = SKY_KEYFRAMES; let i = 0; while (i < KF.length - 2 && h >= KF[i + 1].h) i++; const A = KF[i], B = KF[i + 1]; let f = (h - A.h) / (B.h - A.h); f = f * f * (3 - 2 * f); const L = (x: number, y: number) => x + (y - x) * f;
  return { name: f < 0.5 ? A.name : B.name, top: mixHex(A.top, B.top, f), bot: mixHex(A.bot, B.bot, f), glow: mixRgba(A.glow, B.glow, f), hemi: mixRgb(A.hemi, B.hemi, L), hi: L(A.hi, B.hi), sun: mixRgb(A.sun, B.sun, L), si: L(A.si, B.si), night: L(A.night, B.night), exp: L(A.exp, B.exp) };
}

/** Night sky bodies: star dome, moon and its halo ring. */
export function createSkyBodies(scene: THREE.Scene, reduced: boolean) {
  const starGeo = new THREE.BufferGeometry(); { const n = 900, pos = new Float32Array(n * 3); const Rs = rng('stars'); for (let i = 0; i < n; i++) { const u = Rs() * Math.PI * 2, v = Math.acos(0.15 + Rs() * 0.85), r = 150; pos[i * 3] = Math.sin(v) * Math.cos(u) * r; pos[i * 3 + 1] = Math.cos(v) * r; pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * r; } starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); }
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: COLORS.stars, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false })); scene.add(stars);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 64, 48), new THREE.MeshBasicMaterial({ color: COLORS.moon, transparent: true, opacity: 0 })); moon.position.set(-70, 60, -90); scene.add(moon);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.08, 16, 160), new THREE.MeshBasicMaterial({ color: COLORS.halo, transparent: true, opacity: 0 })); halo.position.copy(moon.position); halo.lookAt(0, 0, 0); scene.add(halo);
  /** k = night amount (0..1), sa = sun angle, t = seconds. */
  function update(k: number, sa: number, t: number) {
    (stars.material as THREE.PointsMaterial).opacity = Math.max(0, k - 0.3) * 1.4; moon.material.opacity = Math.max(0, k - 0.35) * 1.5; halo.material.opacity = Math.max(0, k - 0.5) * 0.7; if (!reduced) stars.rotation.y = t * 0.004;
    moon.position.set(Math.cos(sa + Math.PI) * 110, 30 + Math.max(0, Math.sin(sa + Math.PI)) * 60, -90); halo.position.copy(moon.position); halo.lookAt(0, 0, 0);
  }
  /** The post pipeline paints its own screen-space stars and moon; hide the 3D bodies then. */
  function setVisible(v: boolean) { stars.visible = moon.visible = halo.visible = v; }
  return { update, setVisible };
}
