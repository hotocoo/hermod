/**
 * Planar water: a real mirror pass and a real refraction pass for flat water meshes (`water:*`, not the waterfall), both at 1x
 * and only over the water's screen footprint (the projection is cropped to the footprint rectangle, so cost scales with how much
 * of the screen the water covers and frustum culling drops everything else).
 *  - reflection: scene rendered from the camera mirrored about the water plane with an oblique near plane (nothing below the surface shows)
 *  - refraction: scene without water rendered from the main camera with a depth texture (bed colour and true water thickness for Beer-Lambert absorption)
 * The water shader (materialFx.waterFx) samples both through `waterU`.
 */
import * as THREE from 'three';
import { passProf } from './passProf';
import { classify, hideAll, restore, type PassCull } from './passCull';

export const waterU = {
  tRefl: { value: null as THREE.Texture | null }, tRefr: { value: null as THREE.Texture | null }, tDepth: { value: null as THREE.Texture | null },
  /** Virtual (mirrored) camera view-projection, uncropped: world position on the plane -> reflection uv in the full view. */
  uReflVP: { value: new THREE.Matrix4() },
  /** Footprint rectangles in uv of the full view (x0, y0, w, h) and the used fraction of each render target. */
  uRectR: { value: new THREE.Vector4() }, uScaleR: { value: new THREE.Vector2(1, 1) },
  uRectF: { value: new THREE.Vector4() }, uScaleF: { value: new THREE.Vector2(1, 1) },
  uRes: { value: new THREE.Vector2(1, 1) }, uNearFar: { value: new THREE.Vector2(0.1, 300) }, uOn: { value: 0 }, uDbg: { value: 0 },
};
export const waterStats = { on: false, reflPx: 0, refrPx: 0, meshes: 0, names: [] as string[], centers: {} as Record<string, number[]> };

/** Reduced layer set for the two water passes (the main view keeps everything): props below smallR metres are skipped, figures beyond figureM metres are skipped, decals (flagged noAO) and points, lines and sprites never show in a mirror, and the refraction pass (which only ever shows what lies below the surface) draws only opaque meshes whose box reaches the water footprint (grown by nearM) below aboveM over the plane: no smoke or decals, nothing standing clear of the water. */
const WATER_PASS = { smallR: 1.0, figureM: 30, aboveM: 0.25, nearM: 3 };
const cullOn = () => (globalThis as { __lfx?: Record<string, boolean> }).__lfx?.watercull !== false; // dev A/B: __lfx.watercull = false draws the full scene in both water passes
const MIN_PX = 48 * 48; // smaller footprints keep the sky/IBL look: a few pixels of water do not justify two scene passes
const PAD = 6;
const _box = new THREE.Box3(), _b2 = new THREE.Box3(), _v = new THREE.Vector3(), _c = new THREE.Color(), _frustum = new THREE.Frustum(), _vp = new THREE.Matrix4();
const _s = new THREE.Vector2(), _t2 = new THREE.Vector3(), _ful = new THREE.Matrix4();
const _n = new THREE.Vector3(0, 1, 0), _refl = new THREE.Vector3(), _look = new THREE.Vector3(), _tgt = new THREE.Vector3(), _rot = new THREE.Matrix4(), _cp = new THREE.Vector3(), _q = new THREE.Vector4(), _plane = new THREE.Plane(), _clip = new THREE.Vector4();

interface Px { x0: number; y0: number; w: number; h: number }
/** Pixel rectangle of a box's projection (null when it straddles the camera plane: use the whole view). */
function footprint(m: THREE.Matrix4, box: THREE.Box3, y0: number, y1: number, W: number, H: number): Px {
  let nx0 = 1e9, ny0 = 1e9, nx1 = -1e9, ny1 = -1e9; let behind = false;
  for (let i = 0; i < 8; i++) {
    _v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? y1 : y0, i & 4 ? box.max.z : box.min.z).applyMatrix4(m);
    // applyMatrix4 divides by w: recompute with the raw clip coordinate to catch points behind the camera
    const e = m.elements; const x = i & 1 ? box.max.x : box.min.x, y = i & 2 ? y1 : y0, z = i & 4 ? box.max.z : box.min.z;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15]; if (w < 0.05) { behind = true; break; }
    nx0 = Math.min(nx0, _v.x); nx1 = Math.max(nx1, _v.x); ny0 = Math.min(ny0, _v.y); ny1 = Math.max(ny1, _v.y);
  }
  if (behind) return { x0: 0, y0: 0, w: W, h: H };
  const x0 = Math.max(0, Math.floor((nx0 * 0.5 + 0.5) * W) - PAD), x1 = Math.min(W, Math.ceil((nx1 * 0.5 + 0.5) * W) + PAD);
  const y0p = Math.max(0, Math.floor((ny0 * 0.5 + 0.5) * H) - PAD), y1p = Math.min(H, Math.ceil((ny1 * 0.5 + 0.5) * H) + PAD);
  return { x0, y0: y0p, w: Math.max(0, x1 - x0), h: Math.max(0, y1p - y0p) };
}

/** Projection cropped to a pixel rectangle of the full view (NDC window remap), so the render target holds exactly that rectangle at 1x. */
function crop(out: THREE.Matrix4, proj: THREE.Matrix4, r: Px, W: number, H: number) {
  const nx0 = (r.x0 / W) * 2 - 1, nx1 = ((r.x0 + r.w) / W) * 2 - 1, ny0 = (r.y0 / H) * 2 - 1, ny1 = ((r.y0 + r.h) / H) * 2 - 1;
  const sx = 2 / (nx1 - nx0), ox = -(nx0 + nx1) / (nx1 - nx0), sy = 2 / (ny1 - ny0), oy = -(ny0 + ny1) / (ny1 - ny0);
  _vp.set(sx, 0, 0, ox, 0, sy, 0, oy, 0, 0, 1, 0, 0, 0, 0, 1);
  out.multiplyMatrices(_vp, proj);
}

const _wp = new THREE.Vector3();
const _bb = new THREE.Box3(), _ref = new THREE.Box3(); const _ib = new WeakMap<THREE.InstancedMesh, { ver: number; n: number; box: THREE.Box3 }>();
/** World box of a mesh (instanced banks cached until their matrices or count change). The returned box is shared: copy it before the next call. */
function worldBox(o: THREE.Mesh): THREE.Box3 {
  const im = o as THREE.InstancedMesh;
  if (im.isInstancedMesh) {
    let c = _ib.get(im);
    if (!c || c.ver !== im.instanceMatrix.version || c.n !== im.count) { im.computeBoundingBox(); c = { ver: im.instanceMatrix.version, n: im.count, box: (im.boundingBox ?? new THREE.Box3().makeEmpty()).clone() }; _ib.set(im, c); }
    return _bb.copy(c.box).applyMatrix4(o.matrixWorld);
  }
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); return _bb.copy(o.geometry.boundingBox!).applyMatrix4(o.matrixWorld);
}

export interface WaterPlanar { update(scene: THREE.Scene, camera: THREE.PerspectiveCamera, samples: number): void; dispose(): void }

export function createWaterPlanar(renderer: THREE.WebGLRenderer): WaterPlanar {
  let list: THREE.Mesh[] = []; let age = 1e9; let cull: PassCull = { small: [], sprites: [], figures: [], meshes: [] };
  let reflRT: THREE.WebGLRenderTarget | null = null, refrRT: THREE.WebGLRenderTarget | null = null; let rtW = 0, rtH = 0, rtS = -1;
  const vcam = new THREE.PerspectiveCamera(); const rcam = new THREE.PerspectiveCamera();
  const mk = (W: number, H: number, samples: number, depth: boolean) => {
    const t = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, samples, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    if (depth) { t.depthTexture = new THREE.DepthTexture(W, H); t.depthTexture.type = THREE.UnsignedIntType; t.depthTexture.minFilter = t.depthTexture.magFilter = THREE.NearestFilter; }
    t.scissorTest = true; return t;
  };
  const visible = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };

  function renderPass(scene: THREE.Scene, cam: THREE.PerspectiveCamera, rt: THREE.WebGLRenderTarget, r: Px) {
    rt.viewport.set(0, 0, r.w, r.h); rt.scissor.set(0, 0, r.w, r.h);
    renderer.setRenderTarget(rt); renderer.clear(true, true, false); renderer.render(scene, cam);
  }

  return {
    update(scene, camera, samples) {
      waterU.uOn.value = 0; waterStats.on = false;
      if ((age += 1) > 45) { age = 0; list = []; scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.startsWith('water:')) list.push(o as THREE.Mesh); }); cull = classify(scene, WATER_PASS.smallR, (o) => o.name.startsWith('water:')); }
      const planar: THREE.Mesh[] = []; for (const m of list) if (!m.name.endsWith(':fall') && visible(m) && m.geometry) planar.push(m);
      waterStats.meshes = planar.length; if (!planar.length) return;
      if (waterStats.names.length !== planar.length) { waterStats.names = planar.map((m) => m.name); for (const m of planar) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); const c = m.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld); waterStats.centers[m.name] = [c.x, c.y, c.z]; } } // dev probe data: fx-shots aims cameras at these
      camera.updateMatrixWorld(); _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_vp);
      _box.makeEmpty(); let h = -1e9;
      for (const m of planar) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); m.updateWorldMatrix(true, false); _b2.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld); if (!m.name.includes('stream')) h = Math.max(h, _b2.max.y); if (_frustum.intersectsBox(_b2)) _box.union(_b2); }
      if (_box.isEmpty() || h < -1e8) return; _cp.setFromMatrixPosition(camera.matrixWorld); if (_cp.y < h + 0.05) return;
      renderer.getDrawingBufferSize(_s); const W = Math.round(_s.x), H = Math.round(_s.y);
      // mirrored camera (Reflector construction, plane y = h)
      const P = _tgt.set(0, h, 0); _refl.subVectors(P, _cp).reflect(_n).negate().add(P);
      _rot.extractRotation(camera.matrixWorld); _look.set(0, 0, -1).applyMatrix4(_rot).add(_cp); _tgt.set(0, h, 0); const t2 = _t2.subVectors(_tgt, _look).reflect(_n).negate().add(_tgt);
      vcam.position.copy(_refl); vcam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n); vcam.lookAt(t2); vcam.layers.mask = camera.layers.mask; vcam.near = camera.near; vcam.far = camera.far; vcam.updateMatrixWorld();
      vcam.matrixWorldInverse.copy(vcam.matrixWorld).invert();
      const ful = _ful.multiplyMatrices(camera.projectionMatrix, vcam.matrixWorldInverse); waterU.uReflVP.value.copy(ful);
      const fr = footprint(_vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), _box, h - 0.6, h + 0.2, W, H);
      const rr = footprint(ful, _box, h, h, W, H);
      if (fr.w * fr.h < MIN_PX || rr.w * rr.h < MIN_PX / 2) return;
      if (!reflRT || !refrRT || rtW !== W || rtH !== H || rtS !== samples) { reflRT?.dispose(); refrRT?.dispose(); reflRT = mk(W, H, samples, false); refrRT = mk(W, H, samples, true); rtW = W; rtH = H; rtS = samples; }

      // save renderer state
      const prevRT = renderer.getRenderTarget(), autoClear = renderer.autoClear, sa = renderer.shadowMap.autoUpdate, sn = renderer.shadowMap.needsUpdate, ma = scene.matrixWorldAutoUpdate; const ca = renderer.getClearAlpha(); renderer.getClearColor(_c);
      renderer.autoClear = false; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; scene.matrixWorldAutoUpdate = false; renderer.setClearColor(0x000000, 0);
      const vis = list.map((m) => m.visible); list.forEach((m) => { m.visible = false; });
      const skipped = cullOn() ? hideAll(cull.small) : [];
      if (cullOn()) hideAll(cull.sprites, skipped);
      for (const f of cull.figures) if (cullOn() && f.visible && f.getWorldPosition(_wp).distanceToSquared(_cp) > WATER_PASS.figureM * WATER_PASS.figureM) { f.visible = false; skipped.push(f); }
      try {
        // reflection: oblique near plane at the water surface, cropped to the mirrored footprint
        rcam.position.copy(vcam.position); rcam.quaternion.copy(vcam.quaternion); rcam.layers.mask = camera.layers.mask; rcam.near = camera.near; rcam.far = camera.far; rcam.updateMatrixWorld(); rcam.matrixWorldInverse.copy(vcam.matrixWorldInverse);
        const proj = rcam.projectionMatrix.copy(camera.projectionMatrix); _plane.setFromNormalAndCoplanarPoint(_n, _tgt.set(0, h, 0)).applyMatrix4(vcam.matrixWorldInverse); _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
        const e = proj.elements; _q.x = (Math.sign(_clip.x) + e[8]) / e[0]; _q.y = (Math.sign(_clip.y) + e[9]) / e[5]; _q.z = -1; _q.w = (1 + e[10]) / e[14]; _clip.multiplyScalar(2 / _clip.dot(_q));
        e[2] = _clip.x; e[6] = _clip.y; e[10] = _clip.z + 1 - 0.02; e[14] = _clip.w;
        crop(rcam.projectionMatrix, rcam.projectionMatrix, rr, W, H); rcam.projectionMatrixInverse.copy(rcam.projectionMatrix).invert();
        passProf(renderer, 'water:reflection', () => renderPass(scene, rcam, reflRT!, rr));
        // refraction: the main camera over the footprint, water hidden, depth kept
        const dcam = rcam; dcam.position.copy(_cp); dcam.quaternion.setFromRotationMatrix(_rot.extractRotation(camera.matrixWorld)); dcam.updateMatrixWorld(); dcam.matrixWorldInverse.copy(camera.matrixWorldInverse);
        crop(dcam.projectionMatrix, camera.projectionMatrix, fr, W, H); dcam.projectionMatrixInverse.copy(dcam.projectionMatrix).invert();
        _ref.copy(_box).expandByScalar(WATER_PASS.nearM); _ref.max.y = h + WATER_PASS.aboveM;
        if (cullOn()) for (const m of cull.meshes) if (m.visible && (m.material as THREE.Material).transparent || m.visible && !_ref.intersectsBox(worldBox(m))) { m.visible = false; skipped.push(m); }
        passProf(renderer, 'water:refraction', () => renderPass(scene, dcam, refrRT!, fr));
      } finally {
        list.forEach((m, i) => { m.visible = vis[i]; }); restore(skipped);
        renderer.setRenderTarget(prevRT); renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = sa; renderer.shadowMap.needsUpdate = sn; scene.matrixWorldAutoUpdate = ma; renderer.setClearColor(_c, ca);
      }
      waterU.tRefl.value = reflRT.texture; waterU.tRefr.value = refrRT.texture; waterU.tDepth.value = refrRT.depthTexture;
      waterU.uRectR.value.set(rr.x0 / W, rr.y0 / H, rr.w / W, rr.h / H); waterU.uScaleR.value.set(rr.w / W, rr.h / H);
      waterU.uRectF.value.set(fr.x0 / W, fr.y0 / H, fr.w / W, fr.h / H); waterU.uScaleF.value.set(fr.w / W, fr.h / H);
      waterU.uRes.value.set(W, H); waterU.uNearFar.value.set(camera.near, camera.far); waterU.uOn.value = 1;
      waterStats.on = true; waterStats.reflPx = rr.w * rr.h; waterStats.refrPx = fr.w * fr.h;
    },
    dispose() { reflRT?.dispose(); refrRT?.dispose(); reflRT = refrRT = null; waterU.uOn.value = 0; },
  };
}
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') (window as unknown as { __water: unknown }).__water = { waterStats, waterU }; // dev only: fx-shots probes
