/**
 * Far-distance octahedral impostors (scripts/assets/blender/nature/impostor.py): a hemi-octahedral atlas of views baked from the real LOD0 mesh.
 * One InstancedMesh per species; each instance is a quad that faces the baked view direction nearest to the camera and samples that atlas cell.
 * Only used beyond IMPOSTOR_FROM world units (never near).
 */
import * as THREE from 'three';
import { loadGlb, type Placement } from './instanced';

export const IMPOSTOR_FROM = 72;
/** Stochastic hand-over width: each tree swaps mesh -> impostor at its own distance in [FROM, FROM + FADE] (no mass pop; needs the bank's `lodSwitch`). */
export const IMPOSTOR_FADE = 14;
/** Distance over which an impostor dithers in BEFORE the mesh leaves (both are drawn there), so the hand-over is a cross-dissolve and not a swap. */
export const IMPOSTOR_BLEND = 6;
/** Dev only: window.__impBias shifts every switch distance (large negative = impostors only, large positive = meshes only) for the pop A/B shots. */
const bias = (): number => (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' ? Number((window as unknown as { __impBias?: number }).__impBias ?? 0) : 0);
export const impostorSwitch = (p: { x: number; z: number }): number => { const h = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453; return IMPOSTOR_FROM + IMPOSTOR_FADE * (h - Math.floor(h)) + bias(); };
const VS = /* glsl */ `
uniform float uGrid; uniform float uRadius; uniform float uCenterY; uniform float uBlend;
attribute float aSw; varying vec2 vUv; varying vec3 vTint; varying float vK;
vec3 hemiDecode(vec2 e) { float tx = (e.x + e.y) * 0.5, tz = (e.x - e.y) * 0.5; float y = 1.0 - abs(tx) - abs(tz); return normalize(vec3(tx, y, tz)); }
void main() {
  mat4 im = instanceMatrix; float s = length(im[0].xyz); vec3 c = im[3].xyz + vec3(0.0, uCenterY * s, 0.0);
  vec3 vd = cameraPosition - c; vK = uBlend > 0.0 ? clamp((length(vd) - (aSw - uBlend)) / uBlend, 0.0, 1.0) : 1.0; vd.y = max(vd.y, 0.02 * length(vd)); vd = normalize(vd);
  float sum = abs(vd.x) + vd.y + abs(vd.z); float tx = vd.x / sum, tz = vd.z / sum; vec2 e = vec2(tx + tz, tx - tz);
  vec2 cell = clamp(floor((e * 0.5 + 0.5) * uGrid), 0.0, uGrid - 1.0); vec3 cd = hemiDecode((cell + 0.5) / uGrid * 2.0 - 1.0);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), cd)); vec3 up = cross(cd, right);
  vec3 wp = c + (right * position.x + up * position.y) * uRadius * s;
  vUv = (cell + (position.xy * 0.5 + 0.5)) / uGrid;
#ifdef USE_INSTANCING_COLOR
  vTint = mix(vec3(1.0), instanceColor, 0.5);
#else
  vTint = vec3(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const FS = /* glsl */ `
uniform sampler2D uMap; uniform sampler2D uNrm; uniform vec3 uFog; uniform float uFogD; uniform vec3 uSunDir; uniform vec3 uSun; uniform vec3 uSky; uniform float uGain; uniform vec3 uGround; varying vec2 vUv; varying vec3 vTint; varying float vK;
void main() {
  if (vK < 1.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vK) discard; // interleaved-gradient dither: cross-dissolve with the mesh
  vec4 t = texture2D(uMap, vUv); float a = t.a; a = (a - 0.42) / max(fwidth(a), 1e-4) + 0.5; if (a < 0.0) discard;
  // object-space normal atlas (Blender Z-up baked): to Y-up, then lit like the mesh LOD (wrapped sun + hemisphere), /PI as three's Lambert
  vec3 nb = texture2D(uNrm, vUv).xyz * 2.0 - 1.0; vec3 n = normalize(vec3(nb.x, nb.z, -nb.y));
  float wrap = clamp((dot(n, uSunDir) + 0.4) / 1.4, 0.0, 1.0); vec3 lit = uSun * wrap + mix(uGround, uSky, 0.5 + 0.5 * n.y);
  vec3 col = t.rgb * vTint * lit * (0.3183 * uGain); float d = gl_FragCoord.z / gl_FragCoord.w; float f = 1.0 - exp(-uFogD * uFogD * d * d); col = mix(col, uFog, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class ImpostorBank {
  readonly group = new THREE.Group(); private sets: { list: Placement[]; im: THREE.InstancedMesh }[] = []; private tick = 0; private p = new THREE.Vector3(); private d = new THREE.Object3D();
  private sun: THREE.DirectionalLight | null = null; private hemi: THREE.HemisphereLight | null = null; private sd = new THREE.Vector3(); private tc = new THREE.Color();
  constructor(parent: THREE.Object3D, private fog: THREE.Fog | THREE.FogExp2 | null = null, private fade = 0) { this.group.name = 'impostors'; parent.add(this.group); }
  async add(url: string, list: Placement[]): Promise<void> {
    const scene = await loadGlb(url); let mesh: THREE.Mesh | null = null; let ud: Record<string, unknown> = {};
    scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !mesh) { mesh = m; ud = m.userData; } });
    if (!mesh) return; const m = mesh as THREE.Mesh; const mt = m.material as THREE.MeshStandardMaterial; const map = mt.map; if (!map) return;
    const nrm = mt.normalMap; if (nrm) { nrm.minFilter = THREE.LinearFilter; nrm.generateMipmaps = false; nrm.needsUpdate = true; }
    const grid = Number(ud.grid ?? 8), radius = Number(ud.radius ?? 1), cy = Number(ud.centerY ?? radius);
    map.minFilter = THREE.LinearFilter; map.generateMipmaps = false; map.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { uMap: { value: map }, uNrm: { value: nrm ?? map }, uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) }, uSun: { value: new THREE.Color(1, 1, 1) }, uSky: { value: new THREE.Color(1, 1, 1) }, uGround: { value: new THREE.Color(0.5, 0.5, 0.5) }, uGain: { value: 0.4 }, uGrid: { value: grid }, uRadius: { value: radius }, uCenterY: { value: cy }, uBlend: { value: this.fade > 0 ? IMPOSTOR_BLEND : 0 }, uFog: { value: new THREE.Color(0xb8c4cc) }, uFogD: { value: 0.0 } }, side: THREE.DoubleSide, extensions: { derivatives: true } as never });
    const geo = new THREE.PlaneGeometry(2, 2); const cap = Math.max(1, list.length); geo.setAttribute('aSw', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1)); const im = new THREE.InstancedMesh(geo, mat, cap); im.count = 0; im.frustumCulled = false; im.userData.noAO = true; this.group.add(im); this.sets.push({ list, im });
  }
  update(cam: THREE.Vector3, fr: THREE.Frustum, fogDensity: number): void {
    if (!this.sun || !this.hemi) { let r: THREE.Object3D = this.group; while (r.parent) r = r.parent; r.traverse((o) => { if ((o as THREE.DirectionalLight).isDirectionalLight && !this.sun) this.sun = o as THREE.DirectionalLight; if ((o as THREE.HemisphereLight).isHemisphereLight && !this.hemi) this.hemi = o as THREE.HemisphereLight; }); }
    const fade_ = this.fade; if (++this.tick % 4 !== 1) return; const blend = fade_ > 0 ? IMPOSTOR_BLEND : 0; const s2 = (IMPOSTOR_FROM + bias() - blend) ** 2; const fade = this.fade; const sph = new THREE.Sphere();
    for (const s of this.sets) {
      const sw = s.im.geometry.attributes.aSw as THREE.BufferAttribute; let n = 0; for (const p of s.list) { const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z; const dd = dx * dx + dy * dy + dz * dz; if (dd < s2 || (fade > 0 && dd < (impostorSwitch(p) - blend) ** 2)) continue; sph.center.set(p.x, p.y + 1, p.z); sph.radius = 3 * p.scale; if (!fr.intersectsSphere(sph)) continue; this.d.position.set(p.x, p.y, p.z); this.d.rotation.set(0, 0, 0); this.d.scale.setScalar(p.scale); this.d.updateMatrix(); s.im.setMatrixAt(n, this.d.matrix); sw.setX(n, fade > 0 ? impostorSwitch(p) : IMPOSTOR_FROM); if (p.tint) s.im.setColorAt(n, p.tint); n++; }
      s.im.count = n; s.im.instanceMatrix.needsUpdate = sw.needsUpdate = true; if (s.im.instanceColor) s.im.instanceColor.needsUpdate = true; const u = (s.im.material as THREE.ShaderMaterial).uniforms; u.uFogD.value = fogDensity; void this.p;
      if (this.sun) { this.sd.copy(this.sun.position).sub(this.sun.target.position).normalize(); u.uSunDir.value.copy(this.sd); u.uSun.value.copy(this.sun.color).multiplyScalar(this.sun.intensity); }
      if (this.hemi) { u.uSky.value.copy(this.hemi.color).multiplyScalar(this.hemi.intensity); u.uGround.value.copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity); }
    }
  }
  dispose(): void { this.sets.forEach((s) => { s.im.geometry.dispose(); (s.im.material as THREE.Material).dispose(); s.im.dispose(); }); this.group.removeFromParent(); this.sets = []; }
}
