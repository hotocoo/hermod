import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color(), _n = new THREE.Matrix3();

/** Accumulates primitives into one vertex coloured geometry (one draw call per material). Build-time only. */
export class Parts {
  private pos: number[] = []; private nrm: number[] = []; private col: number[] = [];
  /** Append a geometry transformed by (position, yaw, pitch-roll euler, scale) with a flat colour; per-vertex tint multiplies by `shade(y)` when given. */
  add(g: THREE.BufferGeometry, x: number, y: number, z: number, color: number, yaw = 0, sx = 1, sy = 1, sz = 1, rz = 0, shade?: (y: number) => number): this {
    const ng = g.index ? g.toNonIndexed() : g; _e.set(0, yaw, rz, 'YXZ'); _q.setFromEuler(_e); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); _n.getNormalMatrix(_m); _c.setHex(color);
    const P = ng.attributes.position, N = ng.attributes.normal; const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(_m); this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize(); this.nrm.push(v.x, v.y, v.z);
      const k = shade ? shade(this.pos[this.pos.length - 2]) : 1; this.col.push(_c.r * k, _c.g * k, _c.b * k);
    }
    if (ng !== g) ng.dispose(); return this;
  }
  /** Box standing on y0, centred on (cx, cz). */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: number, yaw = 0): this { return this.add(UNIT_BOX, cx, y0 + h / 2, cz, color, yaw, w, h, d); }
  cyl(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg: number, color: number): this { const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1); this.add(g, cx, y0 + h / 2, cz, color); g.dispose(); return this; }
  /** Gable prism (ridge along z when yaw = 0). */
  prism(cx: number, y0: number, cz: number, w: number, d: number, h: number, color: number, yaw = 0): this { return this.add(PRISM, cx, y0, cz, color, yaw, w, h, d); }
  get count(): number { return this.pos.length / 3; }
  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null; const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((this.pos.length / 3) * 2), 2));
    g.computeBoundingSphere(); return g;
  }
}
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const PRISM = (() => {
  const g = new THREE.BufferGeometry(); const a = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5];
  const idx = [0, 2, 1, 0, 3, 2, 0, 1, 4, 3, 5, 2, 0, 4, 5, 0, 5, 3, 1, 2, 5, 1, 5, 4]; g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); g.setIndex(idx); const f = g.toNonIndexed(); f.computeVertexNormals(); return f;
})();

/** Tint helper for hex colours (multiplies rgb). */
export function tint(hex: number, k: number): number { _c.setHex(hex); return _c.multiplyScalar(k).getHex(); }
