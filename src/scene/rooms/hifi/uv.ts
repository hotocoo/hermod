import * as THREE from 'three';

/** Box-project UVs as metres / tile, so every surface of the shell has the same texel density whatever its shape. */
export function worldUV(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); ng.computeVertexNormals();
  const p = ng.getAttribute('position'); const n = ng.getAttribute('normal'); const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      const [u, v] = nx >= ny && nx >= nz ? [z, y] : ny >= nz ? [x, z] : [x, y];
      uv[(i + k) * 2] = u / tile; uv[(i + k) * 2 + 1] = v / tile;
    }
  }
  ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return ng;
}

/** Quad (a,b,c,d counter-clockwise seen from the front) as two triangles. */
export function quad(pos: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
  for (const v of [a, b, c, a, c, d]) pos.push(v.x, v.y, v.z);
}
export const geometryFrom = (pos: number[]): THREE.BufferGeometry => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g; };

/**
 * Sweep a 2D profile (d outward from the wall, h up; counter-clockwise) along a closed floor path with mitred corners.
 * Used for baseboards, crown mouldings and chair rails, so trim has a real stepped/ogee silhouette.
 */
export function sweepProfile(profile: [number, number][], path: [number, number][], y: number, inward: (mid: THREE.Vector2) => THREE.Vector2): THREE.BufferGeometry {
  const n = path.length; const pos: number[] = [];
  const nrm = path.map((p, i) => {
    const q = path[(i + 1) % n]; const t = new THREE.Vector2(q[0] - p[0], q[1] - p[1]).normalize();
    const mid = new THREE.Vector2((p[0] + q[0]) / 2, (p[1] + q[1]) / 2); const a = new THREE.Vector2(-t.y, t.x); return inward(mid).dot(a) > 0 ? a : a.negate();
  });
  const off = path.map((_, i) => { const a = nrm[(i + n - 1) % n], b = nrm[i]; const m = a.clone().add(b); return m.multiplyScalar(1 / (1 + a.dot(b))); });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const nn = nrm[i];
    for (let k = 0; k < profile.length; k++) {
      const [d0, h0] = profile[k], [d1, h1] = profile[(k + 1) % profile.length];
      const P = (idx: number, d: number, h: number) => new THREE.Vector3(path[idx][0] + off[idx].x * d, y + h, path[idx][1] + off[idx].y * d);
      const a = P(i, d0, h0), b = P(j, d0, h0), c = P(j, d1, h1), d = P(i, d1, h1);
      // Outward normal of this profile edge in world space, to pick the triangle winding.
      const want = new THREE.Vector3(nn.x * (h1 - h0), -(d1 - d0), nn.y * (h1 - h0));
      const got = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
      if (got.dot(want) >= 0) quad(pos, a, b, c, d); else quad(pos, a, d, c, b);
    }
  }
  return geometryFrom(pos);
}
