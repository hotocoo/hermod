import * as THREE from 'three';
import { ENV } from '@/config/scene';
import type { SkySample } from '../sky';

const lin = (hex: string, mul: number, out: THREE.Color) => out.set(hex).multiplyScalar(mul);

/**
 * Image based lighting from a generated sky: a gradient sphere plus a bright sun or moon blob, filtered with PMREM.
 * Regenerated only when the hour moved enough, so a lapse of the clock costs a couple of ms every few seconds.
 */
export function createEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(60, 32, 20); const pos = geo.attributes.position; geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false })); envScene.add(sky);
  const blob = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })); envScene.add(blob);
  let target: THREE.WebGLRenderTarget | null = null; let lastHr = -99; let enabled = true;
  const top = new THREE.Color(), bot = new THREE.Color(), gnd = new THREE.Color(), c = new THREE.Color();

  function regen(S: SkySample, sunDir: THREE.Vector3, isSun: boolean) {
    const day = 1 - S.night; lin(S.top, 1.15 + day * 0.5, top); lin(S.bot, 1.1 + day * 0.4, bot); gnd.copy(bot).multiplyScalar(0.38).lerp(c.setRGB(0.22, 0.2, 0.17), 0.3 * day);
    const col = geo.attributes.color;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 60; if (y >= 0) c.copy(bot).lerp(top, Math.pow(y, 0.55)); else c.copy(bot).lerp(gnd, Math.min(1, -y * 3)); col.setXYZ(i, c.r, c.g, c.b); }
    col.needsUpdate = true;
    blob.position.copy(sunDir).multiplyScalar(48); (blob.material as THREE.MeshBasicMaterial).color.setRGB(S.sun[0], S.sun[1], S.sun[2]).multiplyScalar(isSun ? 14 * Math.max(0.3, day) : 3.2);
    const next = pm.fromScene(envScene, 0.035, 1, 200); if (target) target.dispose(); target = next; scene.environment = target.texture;
  }
  return {
    /** hr 0..24, S sky sample, sunDir unit vector toward the sun/moon light. */
    update(hr: number, S: SkySample, sunDir: THREE.Vector3, isSun: boolean, extraScale: number) {
      if (!enabled) return;
      let d = Math.abs(hr - lastHr); if (d > 12) d = 24 - d;
      if (!target || d >= ENV.regenHours) { lastHr = hr; regen(S, sunDir, isSun); }
      scene.environmentIntensity = (ENV.day + (ENV.night - ENV.day) * S.night) * extraScale;
    },
    setEnabled(on: boolean) { enabled = on; if (!on) { scene.environment = null; scene.environmentIntensity = 0; } else lastHr = -99; },
    dispose() { if (target) target.dispose(); pm.dispose(); geo.dispose(); },
  };
}
