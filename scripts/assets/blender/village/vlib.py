"""
Village kit: builders for the village-style section buildings, cottages and signpost.
Reuses the landmark kit (scripts/assets/blender/landmarks/lib.py: K accumulator, column, lathe, ashlar, bake helpers) and extends it with
timbered and plastered walls, shingle/tile roofs, windows, doors, chimneys, lanterns, banners; per-face part and module tags
(so one baked atlas splits into L1/L2/L3 modules, roof, window-glow and moving parts); per-box colour jitter so the high-poly
bakes real material variety; roughness/metal values per palette entry so an ORM map can be baked.
World axes while building: x east, y up, +z front (plaza side), origin = footprint centre on the ground.
"""
import os, sys, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'landmarks'))
import bpy, bmesh
from mathutils import Matrix, Vector
import lib
from lib import K, lin, TAU, PAL, NAMES, IDX

# ---- palette: (hex, roughness, metallic, jitter) ; added to the shared palette tables in place
VPAL = dict(
    stone=(0xe0d6c3, 0.88, 0.0, 0.10), stoneD=(0xb9ad98, 0.92, 0.0, 0.10), plaster=(0xf1e9dc, 0.95, 0.0, 0.03), plasterW=(0xe9dcc4, 0.95, 0.0, 0.03),
    brick=(0xb9714f, 0.9, 0.0, 0.16), brickD=(0x9a5a40, 0.92, 0.0, 0.14), timber=(0x7d5f43, 0.74, 0.0, 0.10), beam=(0x4f3b2c, 0.8, 0.0, 0.10),
    trim=(0xf0e9dc, 0.6, 0.0, 0.03), roofSlate=(0x5d5a58, 0.7, 0.0, 0.12), roofTile=(0x9a4e3b, 0.78, 0.0, 0.12), roofOchre=(0xa6804a, 0.78, 0.0, 0.12),
    roofBrown=(0x6e5b4f, 0.8, 0.0, 0.10), bronze=(0x8a6a3a, 0.38, 0.8, 0.04), gold=(0xd9aa4a, 0.32, 0.9, 0.03), iron=(0x2a2623, 0.5, 0.7, 0.04),
    win=(0x1c2630, 0.08, 0.0, 0.0), lampg=(0xffd9a0, 0.2, 0.0, 0.0), sign=(0xe8b46a, 0.6, 0.0, 0.0), signD=(0x2a1c10, 0.7, 0.0, 0.0),
    cloth0=(0xb8862f, 0.85, 0.0, 0.04), cloth1=(0x8c3f36, 0.85, 0.0, 0.04), cloth2=(0x3f5f7a, 0.85, 0.0, 0.04), cloth3=(0x5b7447, 0.85, 0.0, 0.04),
    hedge=(0x55663d, 0.85, 0.0, 0.14), hedge2=(0x66794a, 0.85, 0.0, 0.14), flowerA=(0xe8c27a, 0.7, 0.0, 0.1), flowerB=(0xc9a0b8, 0.7, 0.0, 0.1), flowerC=(0xf2ead8, 0.7, 0.0, 0.05),
    soil=(0x5a4634, 0.98, 0.0, 0.1), ember=(0x4a2a1a, 0.9, 0.0, 0.1), char=(0x2a2220, 0.95, 0.0, 0.1), rock=(0x8c8474, 0.94, 0.0, 0.3), path=(0xd7cbb5, 0.95, 0.0, 0.08),
    paper=(0xf3e6c8, 0.8, 0.0, 0.03), wood2=(0x9a7a58, 0.7, 0.0, 0.1), pawn=(0xcfc6b4, 0.8, 0.0, 0.05), ink=(0x35302c, 0.6, 0.0, 0.03),
)
ROUGH = {}; METAL = {}; JIT = {}
for _n, (_h, _r, _m, _j) in VPAL.items():
    PAL[_n] = _h; ROUGH[_n] = _r; METAL[_n] = _m; JIT[_n] = _j
    if _n not in IDX: NAMES.append(_n); IDX[_n] = len(NAMES) - 1
for _n in list(PAL):
    ROUGH.setdefault(_n, 0.9); METAL.setdefault(_n, 0.0); JIT.setdefault(_n, 0.06)
EMISSIVE = ('win', 'lampg'); ROOFS = ('roofSlate', 'roofTile', 'roofOchre', 'roofBrown')
V3 = lambda *a: Vector(a)


class V(K):
    """K plus tags. part(name, origin) tags faces for splitting; module(n) selects L1..L3."""

    def __init__(self, hi):
        super().__init__(hi)
        bm = self.bm
        self.l_part = bm.faces.layers.int.new('part'); self.l_mod = bm.faces.layers.int.new('mod'); self.l_col = bm.loops.layers.float_color.new('Col') if hi else None
        self.parts = ['main']; self.part_i = 0; self.mod_i = 0; self.origins = {}; self.empties = {}; self.meta = {}
        self.jit = 0.0; self.jcol = (1.0, 1.0, 1.0); self.r = random.Random(7)

    # ---- tagging
    class _Ctx:
        def __init__(s, v, k, val): s.v, s.k, s.val = v, k, val
        def __enter__(s): s.old = getattr(s.v, s.k); setattr(s.v, s.k, s.val)
        def __exit__(s, *a): setattr(s.v, s.k, s.old)

    def part(self, name, origin=None):
        if name not in self.parts: self.parts.append(name)
        if origin is not None: self.origins[name] = origin
        return V._Ctx(self, 'part_i', self.parts.index(name))

    def module(self, n): return V._Ctx(self, 'mod_i', n - 1)

    def empty(self, name, x, y, z): self.empties[name] = (x, y, z)

    # ---- face with colour jitter and tags
    def face(self, vs, mat, sm=False):
        f = super().face(vs, mat, sm)
        if f is None: return None
        pi = self.part_i
        if mat in EMISSIVE: pi = self._pi('win')
        elif mat in ROOFS and pi == 0: pi = self._pi('roof')
        elif mat == 'sign' and pi == 0: pi = self._pi('sign')
        elif mat.startswith('cloth') and pi == 0: pi = self._pi('cloth')
        f[self.l_part] = pi; f[self.l_mod] = self.mod_i
        if self.hi:
            c = lin(PAL[mat]); j = self.jcol
            for lp in f.loops: lp[self.l_col] = (min(1, c[0] * j[0]), min(1, c[1] * j[1]), min(1, c[2] * j[2]), 1.0)
        return f

    def _pi(self, name):
        if name not in self.parts: self.parts.append(name)
        return self.parts.index(name)

    def _jit(self, mat):
        a = JIT.get(mat, 0.06); r = self.r
        b = 1.0 + (r.random() - 0.5) * 2 * a; t = (r.random() - 0.5) * a * 0.6
        self.jcol = (b * (1 + t), b, b * (1 - t))

    def box(self, cx, y0, cz, w, h, d, mat, yaw=0.0, rot=None):
        self._jit(mat); super().box(cx, y0, cz, w, h, d, mat, yaw, rot)

    def lathe(self, cx, y0, cz, prof, segs, mat, mod=None, ratio=(1.0, 1.0)):
        self._jit(mat); super().lathe(cx, y0, cz, prof, segs, mat, mod, ratio)

    def prism(self, cx, y0, cz, w, d, h, mat, ridge='z'):
        self._jit(mat); super().prism(cx, y0, cz, w, d, h, mat, ridge)

    def prism_x(self, cx, y0, cz, w, d, h, mat):
        self._jit(mat); super().prism_x(cx, y0, cz, w, d, h, mat)

    # ---- oriented members
    def beam(self, p0, p1, tw, th, mat):
        """Box of cross-section tw x th between two points (x/z frame aware via box()). Local z runs p0->p1."""
        a, b = V3(*p0), V3(*p1); d = b - a; L = d.length
        if L < 1e-6: return
        R = V3(0, 0, 1).rotation_difference(d.normalized()).to_matrix(); c = (a + b) / 2
        self.box(c.x, c.y - th / 2, c.z, tw, th, L, mat, rot=R)

    def quadgrid(self, o, u, v, nu, nv, mat, amp=0.0, flip=False):
        """Quad grid from origin o spanning vectors u and v (world frame); amp = random displacement along the normal."""
        o, u, v = V3(*o), V3(*u), V3(*v); n = u.cross(v).normalized(); rows = []
        for j in range(nv + 1):
            row = []
            for i in range(nu + 1):
                p = o + u * (i / nu) + v * (j / nv)
                if amp and 0 < i < nu and 0 < j < nv: p = p + n * self.r.random() * 2 * amp  # outward only: a dip behind the game mesh plane made the AO bake hit the game wall itself there, painting camouflage blotches into the albedo
                row.append(self.v(p.x, p.y, p.z))
            rows.append(row)
        for j in range(nv):
            for i in range(nu):
                q = [rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]]
                self.face(q[::-1] if flip else q, mat)

    # ---- walls
    def plaster(self, cx, cz, w, d, y0, h, mat='plaster', amp=0.004):
        """Plastered wall block: bumpy quad grids on the four sides at high detail, a plain box at game detail."""
        if not self.hi: return self.box(cx, y0, cz, w, h, d, mat)
        self.box(cx, y0, cz, w - 0.006, h - 0.006, d - 0.006, mat)
        n = lambda s: max(2, int(s * 18)); x0, x1, z0, z1, y1 = cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, y0 + h
        self.quadgrid((x0, y0, z1), (w, 0, 0), (0, h, 0), n(w), n(h), mat, amp); self.quadgrid((x1, y0, z0), (-w, 0, 0), (0, h, 0), n(w), n(h), mat, amp)
        self.quadgrid((x1, y0, z1), (0, 0, -d), (0, h, 0), n(d), n(h), mat, amp); self.quadgrid((x0, y0, z0), (0, 0, d), (0, h, 0), n(d), n(h), mat, amp)

    def masonry(self, cx, cz, w, d, y0, h, mat='stone', course=0.2, block=0.55, quoin=True):
        """Coursed stone or brick: dressed blocks all round at high detail (ends staggered), corner quoins and a plinth course at game detail."""
        if self.hi:
            self.box(cx, y0, cz, w - 0.03, h - 0.02, d - 0.03, 'stoneD' if mat == 'stone' else 'brickD')
            rows = max(1, round(h / course)); ch = h / rows; g = 0.012
            for r in range(rows):
                off = 0.5 if r % 2 else 0.0
                for (fx, fz, ln, ax) in ((0, 1, w, 'x'), (0, -1, w, 'x'), (1, 0, d, 'z'), (-1, 0, d, 'z')):
                    n = max(1, round(ln / block)); bw = ln / n
                    for i in range(n + 1):
                        a0 = -ln / 2 + (i - off) * bw; a1 = min(a0 + bw, ln / 2); a0 = max(a0, -ln / 2)
                        if a1 - a0 < 0.05: continue
                        c = (a0 + a1) / 2; t = 0.045 + self.r.random() * 0.012
                        if ax == 'x': self.box(cx + c, y0 + r * ch, cz + fz * (d / 2 - t / 2), a1 - a0 - g, ch - g, t, mat)
                        else: self.box(cx + fx * (w / 2 - t / 2), y0 + r * ch, cz + c, t, ch - g, a1 - a0 - g, mat)
        else:
            self.box(cx, y0, cz, w, h, d, mat)
            rows = max(1, round(h / (course * 3)))
            for r in range(1, rows):  # raised string courses read as coursing at game detail
                yy = y0 + r * h / rows; self.box(cx, yy - 0.012, cz, w + 0.012, 0.024, d + 0.012, mat)
        if quoin:
            for sx in (-1, 1):
                for sz in (-1, 1):
                    n = max(2, round(h / 0.28))
                    for r in range(n):
                        l = 0.17 if r % 2 else 0.12
                        self.box(cx + sx * (w / 2 - 0.05), y0 + r * h / n, cz + sz * (d / 2 - 0.05), 0.11 + (0.05 if r % 2 else 0), h / n - (0.01 if self.hi else 0.0), 0.11 + (0 if r % 2 else 0.05), 'stone' if mat == 'stone' else 'trim')

    def plinth(self, cx, cz, w, d, h, mat='stone', steps=1):
        for i in range(steps):
            k = (steps - i) * 0.06
            self.masonry(cx, cz, w + k * 2, d + k * 2, i * h / steps, h / steps, mat, course=h / steps, block=0.6, quoin=False)

    # ---- roofs
    def gable_roof(self, cx, cz, w, d, y0, pitch, mat='roofSlate', ov=0.28, ove=0.08, th=0.09, wall='plaster', gables=True, hip=False):
        """Gable roof on a w x d plan (ridge along z), eave overhang ov at the sides, gable-end overhang ove. Slabs with thickness, fascia, ridge cap;
        shingle rows at high detail, stepped butt courses at game detail. Returns the rise."""
        half = w / 2 + ov; rise = math.tan(pitch) * (w / 2); L = math.hypot(half, half * math.tan(pitch)); D = d + 2 * ove
        for s in (-1, 1):
            R = Matrix.Rotation(-s * pitch, 3, 'Z'); mx = cx + s * half / 2; my = y0 + (half / 2) * math.tan(pitch) - ov * math.tan(pitch) * 0 + th / 2 - ov * math.tan(pitch) + ov * math.tan(pitch)
            my = y0 + rise / 2 * (half / (w / 2)) - rise * (ov / (w / 2)) * 0 - 0.0
            # centre of the slab midline: from eave (x = s*half, y = y0 - ov*tan) to ridge (x = 0, y = y0 + rise)
            ey = y0 - ov * math.tan(pitch); ry = y0 + rise; my = (ey + ry) / 2; self.box(cx + s * half / 2, my - th / 2, cz, L, th, D, 'beam' if False else mat, rot=R)
            # fascia boards and eave rafter tails
            for sz in (-1, 1): self.box(cx + s * half / 2, my - th * 1.9, cz + sz * (D / 2 - 0.01), L, 0.07, 0.03, 'trim', rot=R)
            if self.hi or True:
                n = max(3, int(d / 0.42)); nx = s * half
                for i in range(n):
                    z = cz - d / 2 + (i + 0.5) * d / n
                    self.box(cx + s * (half - 0.05), ey - 0.045, z, 0.16, 0.06, 0.07, 'beam', rot=R)
            self._shingles(cx, cz, s, half, pitch, ey, ry, L, D, mat, th)
            gx = cx + s * (half - 0.015); gy = ey - 0.035
            self.box(gx, gy - 0.025, cz, 0.05, 0.05, D + 0.04, 'bronze')
        self.box(cx, y0 + rise - 0.005, cz, 0.16, 0.08, D + 0.1, mat, rot=Matrix.Rotation(0, 3, 'Z'))
        if self.hi:
            n = int((D + 0.1) / 0.14)
            for i in range(n):
                z = cz - D / 2 - 0.05 + (i + 0.5) * (D + 0.1) / n
                self.box(cx, y0 + rise + 0.03, z, 0.19, 0.04, 0.135, mat); self.box(cx, y0 + rise + 0.05, z, 0.13, 0.025, 0.12, mat)
        if gables:
            for sz in (-1, 1): self.prism_x(cx, y0 - 0.005, cz + sz * (d / 2 - 0.01), w + 0.01, 0.03, rise, wall)
            if self.hi:
                for sz in (-1, 1):  # bargeboards on the gable rakes
                    for s in (-1, 1):
                        R = Matrix.Rotation(-s * pitch, 3, 'Z'); self.box(cx + s * half / 2, y0 + rise / 2 - 0.02, cz + sz * (D / 2 - 0.005), L, 0.15, 0.04, 'trim', rot=R)
        return rise

    def _shingles(self, cx, cz, s, half, pitch, ey, ry, L, D, mat, th):
        """Rows of overlapping tiles up the slope. (cx + s*half, ey) is the eave, (cx, ry) the ridge."""
        ca, sa = math.cos(pitch), math.sin(pitch)
        row = 0.07 if self.hi else 0.3; nrow = int((L - 0.1) / row); tw = 0.075 if self.hi else D
        top = (1.0 if self.hi else 1.0)
        R = Matrix.Rotation(-s * pitch, 3, 'Z')
        for r in range(nrow):
            u = 0.04 + r * row + row / 2
            px = cx + s * (half - u * ca); py = ey + u * sa + th * 0.5 * 0 + 0.018
            if self.hi:
                n = int(D / tw); off = (tw / 2) if r % 2 else 0
                for i in range(n + 1):
                    z = cz - D / 2 + i * tw + off - tw * 0.0
                    if z < cz - D / 2 + 0.02 or z > cz + D / 2 - 0.02: continue
                    jr = self.r.random() * 0.012
                    self.box(px, py, z, row * 1.45, 0.016 + jr, tw - 0.006, mat, rot=Matrix.Rotation(-s * pitch + (self.r.random() - 0.5) * 0.02, 3, 'Z'))
            else:
                self.box(px, py, cz, row * 1.35, 0.014, D, mat, rot=R)

    def cone_roof(self, cx, y0, cz, prof, segs, mat='roofSlate', band=0.12):
        """Conical roof (lathe) with overlapping tile bands at high detail. prof = [(r, y)] from eave to apex."""
        self.lathe(cx, y0, cz, prof, segs, mat)
        if not self.hi:
            for i in range(len(prof) - 1):  # stepped butt courses read as tile bands at game detail
                (r0, y0_), (r1, y1_) = prof[i], prof[i + 1]; ln = math.hypot(r1 - r0, y1_ - y0_); nb = int(ln / 0.2)
                for b in range(nb):
                    t = (b + 0.35) / max(1, nb); r = r0 + (r1 - r0) * t; yy = y0_ + (y1_ - y0_) * t
                    if r > 0.1: self.lathe(cx, y0 + yy, cz, [(r + 0.022, -0.012), (r + 0.004, 0.0), (r - 0.02, 0.05), (r - 0.04, 0.05)], segs, mat)
            return
        for i in range(len(prof) - 1):
            (r0, y0_), (r1, y1_) = prof[i], prof[i + 1]; ln = math.hypot(r1 - r0, y1_ - y0_); nb = max(1, int(ln / band))
            for b in range(nb):
                t = (b + 0.5) / nb; r = r0 + (r1 - r0) * t; yy = y0_ + (y1_ - y0_) * t; ang = math.atan2(r0 - r1, y1_ - y0_)
                if r < 0.06: continue
                nt = max(6, int(TAU * r / 0.09))
                for k in range(nt):
                    a = TAU * (k + (0.5 if b % 2 else 0)) / nt; tr = lambda rr: (cx + math.cos(a) * rr, cz + math.sin(a) * rr)
                    x, z = tr(r + 0.01); R = Matrix.Rotation(-a + math.pi / 2, 3, 'Y')
                    # tile tilted along the slope in its own radial frame
                    Rt = R @ Matrix.Rotation(-ang, 3, 'X')
                    self.box(x, y0 + yy - 0.008, z, TAU * r / nt * 0.95, 0.014, band * 1.4, mat, rot=Rt)

    def disc(self, cx, cy, cz, r, mat, n=None, thick=0.012):
        """Vertical disc facing +z (clock face, tympanum medallion) with a little thickness."""
        n = n or (40 if self.hi else 16)
        f = [self.v(cx + math.cos(TAU * i / n) * r, cy + math.sin(TAU * i / n) * r, cz + thick) for i in range(n)]
        b = [self.v(cx + math.cos(TAU * i / n) * r, cy + math.sin(TAU * i / n) * r, cz) for i in range(n)]
        c = self.v(cx, cy, cz + thick)
        for i in range(n): self.face([c, f[i], f[(i + 1) % n]][::-1] if False else [c, f[i], f[(i + 1) % n]], mat); self.face([f[i], b[i], b[(i + 1) % n], f[(i + 1) % n]], mat)

    def ringz(self, cx, cy, cz, r0, r1, mat, n=None, thick=0.03):
        """Vertical ring (annulus with depth) facing +z."""
        n = n or (48 if self.hi else 20)
        for i in range(n):
            a0, a1 = TAU * i / n, TAU * (i + 1) / n
            p = lambda r, a, z: self.v(cx + math.cos(a) * r, cy + math.sin(a) * r, cz + z)
            self.face([p(r0, a0, thick), p(r1, a0, thick), p(r1, a1, thick), p(r0, a1, thick)], mat)
            self.face([p(r1, a0, 0), p(r1, a0, thick), p(r1, a1, thick), p(r1, a1, 0)], mat); self.face([p(r0, a0, thick), p(r0, a0, 0), p(r0, a1, 0), p(r0, a1, thick)], mat)

    def sphere(self, cx, cy, cz, r, mat, segs=None):
        n = segs or (32 if self.hi else 14)
        self.lathe(cx, cy, cz, [(max(1e-4, r * math.sin(math.pi * i / n)), -r * math.cos(math.pi * i / n)) for i in range(n + 1)], n * 2 if self.hi else n, mat)

    def torus(self, cx, cy, cz, R, r, mat, n=None, m=None):
        """Horizontal torus (axis y), major radius R, tube radius r."""
        n = n or (72 if self.hi else 28); m = m or (12 if self.hi else 6)
        self.lathe(cx, cy, cz, [(R + math.cos(TAU * i / m) * r, math.sin(TAU * i / m) * r) for i in range(m + 1)], n, mat) if False else None
        rings = []
        for j in range(n):
            a = TAU * j / n; ring = []
            for i in range(m):
                b = TAU * i / m; rr = R + math.cos(b) * r
                ring.append(self.v(cx + math.cos(a) * rr, cy + math.sin(b) * r, cz + math.sin(a) * rr))
            rings.append(ring)
        for j in range(n):
            j2 = (j + 1) % n
            for i in range(m):
                i2 = (i + 1) % m; self.face([rings[j][i], rings[j2][i], rings[j2][i2], rings[j][i2]][::-1], mat)

    def text(self, s, x, y, z, size, yaw=0.0, mat='paper', depth=0.012):
        """Raised lettering (high detail only; the game mesh gets it through the colour and normal bake). Text faces local +z of a frame at (x, z, yaw)."""
        if not self.hi: return
        cu = bpy.data.curves.new('t', 'FONT'); cu.body = s; cu.size = size; cu.extrude = depth / 2; cu.resolution_u = 3
        ob = bpy.data.objects.new('t', cu); bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); me = ev.to_mesh()
        self._jit(mat)
        with self.frame(x, z, yaw):
            vs = [self.v(v.co.x, y + v.co.y, v.co.z + 0.0) for v in me.vertices]
            for p in me.polygons: self.face([vs[i] for i in p.vertices], mat)
        ev.to_mesh_clear(); bpy.data.objects.remove(ob, do_unlink=True)

    # ---- openings
    def window(self, x, y, z, w, h, yaw=0.0, shutters=False, arch=False, rows=2, sill=True, glass='win'):
        """Window facing along local +z of a frame at (x,z,yaw): frame, muntins, glass, sill, lintel, optional shutters."""
        with self.frame(x, z, yaw):
            fr = 0.05; dp = 0.07
            self.box(0, y - h / 2, 0.006, w, h, 0.012, glass)
            for sx in (-1, 1): self.box(sx * (w / 2 + fr / 2), y - h / 2 - fr, 0.03, fr, h + 2 * fr, dp, 'trim')
            self.box(0, y + h / 2, 0.03, w + 2 * fr, fr, dp, 'trim'); self.box(0, y - h / 2 - fr, 0.03, w + 2 * fr, fr, dp, 'trim')
            self.box(0, y - h / 2, 0.036, 0.028, h, 0.04, 'trim')
            for r in range(1, rows): self.box(0, y - h / 2 + h * r / rows - 0.014, 0.036, w, 0.028, 0.04, 'trim')
            if sill: self.box(0, y - h / 2 - fr - 0.035, 0.07, w + fr * 3, 0.045, 0.15, 'stone')
            self.box(0, y + h / 2 + fr, 0.04, w + fr * 4, 0.07, 0.1, 'stone')
            if self.hi:
                self.box(0, y + h / 2 + fr + 0.07, 0.04, w + fr * 3, 0.03, 0.09, 'stoneD')
                for sx in (-1, 1):
                    for q in range(3): self.box(sx * (w / 2 + fr / 2), y - h / 2 + h * (q + 0.5) / 3, 0.075, 0.03, 0.03, 0.02, 'iron')
            if arch:
                n = 10 if self.hi else 5
                for i in range(n):
                    a0 = math.pi * i / n; a1 = math.pi * (i + 1) / n; am = (a0 + a1) / 2; rr = w / 2 + fr / 2
                    self.box(math.cos(am) * rr, y + h / 2 + math.sin(am) * rr - fr / 2, 0.03, 0.04 + 0.0, fr, dp, 'trim', rot=Matrix.Rotation(am - math.pi / 2, 3, 'Z'), yaw=0)
                    gx0, gx1 = math.cos(a0) * w / 2, math.cos(a1) * w / 2
                    g0, g1 = self.v(gx0, y + h / 2 + math.sin(a0) * w / 2, 0.006), self.v(gx1, y + h / 2 + math.sin(a1) * w / 2, 0.006); c0 = self.v(0, y + h / 2, 0.006)
                    self.face([c0, g0, g1], glass)
            if shutters:
                for sx in (-1, 1):
                    self.box(sx * (w * 0.75 + fr), y - h / 2 - 0.02, 0.05, w * 0.5, h + 0.04, 0.03, 'timber')
                    if self.hi:
                        for sl in range(int(h / 0.06)): self.box(sx * (w * 0.75 + fr), y - h / 2 + sl * 0.06, 0.07, w * 0.44, 0.012, 0.012, 'beam')

    def door(self, x, y, z, w, h, yaw=0.0, double=True, steps=2, part_id='door', arch=True, name='door'):
        """Door with stone surround, leaves tagged as moving parts <name>L/<name>R (origin at the hinge), transom glass, steps down to y=0."""
        with self.frame(x, z, yaw):
            for sx in (-1, 1): self.masonry(sx * (w / 2 + 0.07), 0.0, 0.1, 0.14, y, h + 0.04, 'stone', course=0.17, block=0.3, quoin=False)
            self.box(0, y + h, 0.0, w + 0.34, 0.1, 0.16, 'stone')
            if self.hi:
                self.box(0, y + h + 0.1, 0.0, w + 0.4, 0.04, 0.2, 'stoneD')
                n = 9
                for i in range(n):
                    a0 = math.pi * i / n; am = a0 + math.pi / (2 * n); rr = w / 2 + 0.03
            self.box(0, y, -0.005, w, h, 0.02, 'signD')
            self.box(0, y + h, 0.012, w, w * 0.24, 0.012, 'win')
            leaves = ((-1, f'{name}L'), (1, f'{name}R')) if double else ((-1, f'{name}L'),)
            for s, pn in leaves:
                lw = w / 2 - 0.01 if double else w; hx = s * w / 2 if double else -w / 2
                with self.part(pn, origin=self.w(hx, y, 0.03) if False else self._world_pt(hx, y, 0.03)):
                    self.box(hx - s * lw / 2 if double else hx + lw / 2, y, 0.03, lw, h, 0.05, 'timber')
                    if self.hi:
                        for p in range(int(lw / 0.1)): self.box((hx - s * lw / 2 if double else hx + lw / 2) - lw / 2 + (p + 0.5) * lw / int(lw / 0.1), y, 0.058, 0.004, h, 0.012, 'beam')
                        for yy in (h * 0.2, h * 0.75): self.box((hx - s * lw / 2 if double else hx + lw / 2), y + yy, 0.062, lw, 0.05, 0.012, 'iron')
                    else:
                        self.box((hx - s * lw / 2 if double else hx + lw / 2), y + h * 0.2, 0.058, lw, 0.05, 0.012, 'iron'); self.box((hx - s * lw / 2 if double else hx + lw / 2), y + h * 0.75, 0.058, lw, 0.05, 0.012, 'iron')
                    kx = (hx - s * (lw - 0.07)) if double else hx + lw - 0.07
                    self.lathe(kx, y + h * 0.45, 0.075, [(0.0, 0.0), (0.03, 0.0), (0.025, 0.02), (0.0, 0.025)], 12 if self.hi else 6, 'gold', ratio=(1, 1))
            self.empty(name, 0.0, y, 0.0)
            ns = max(0, steps); sh = y / max(1, ns)
            for i in range(ns): self.masonry(0, 0.26 + 0.17 * i + (0.0), w + 0.5 + i * 0.12, 0.3, y - sh * (i + 1), sh, 'stone', course=sh, block=0.5, quoin=False)

    def _world_pt(self, x, y, z): return self.w(x, y, z)

    def chimney(self, x, y, z, h, mat='brick', w=0.42):
        """Stack with corbelled cap and two pots; returns the smoke origin."""
        self.masonry(x, z, w, w, y, h, mat, course=0.075 if mat == 'brick' else 0.2, block=0.2 if mat == 'brick' else 0.4, quoin=False)
        self.box(x, y + h, z, w + 0.1, 0.06, w + 0.1, 'stone'); self.box(x, y + h + 0.06, z, w + 0.04, 0.04, w + 0.04, 'stoneD')
        for dx in (-0.09, 0.09): self.lathe(x + dx, y + h + 0.1, z, [(0.05, 0.0), (0.06, 0.04), (0.055, 0.16), (0.07, 0.2), (0.04, 0.2), (0.0, 0.19)], 14 if self.hi else 8, 'brickD' if mat == 'brick' else 'stoneD')
        return (x, y + h + 0.3, z)

    def lantern(self, x, y, z, s=1.0, bracket=None):
        """Iron lantern with a glowing glass body (tagged window-glow)."""
        self.lathe(x, y, z, [(0.0, 0.0), (0.05 * s, 0.0), (0.06 * s, 0.02 * s), (0.0, 0.02 * s)], 10 if self.hi else 6, 'iron')
        self.lathe(x, y + 0.02 * s, z, [(0.0, 0.0), (0.05 * s, 0.0), (0.055 * s, 0.11 * s), (0.0, 0.11 * s)], 10 if self.hi else 6, 'lampg')
        for k in range(4):
            a = k * TAU / 4 + math.pi / 4; self.box(x + math.cos(a) * 0.054 * s, y + 0.02 * s, z + math.sin(a) * 0.054 * s, 0.012 * s, 0.12 * s, 0.012 * s, 'iron')
        self.lathe(x, y + 0.13 * s, z, [(0.07 * s, 0.0), (0.05 * s, 0.03 * s), (0.0, 0.07 * s)], 10 if self.hi else 6, 'iron')
        if bracket:
            bx, bz = bracket; self.beam((x, y + 0.14 * s, z), (bx, y + 0.14 * s, bz), 0.015, 0.015, 'iron')

    def banner(self, x, y, z, yaw, i):
        """Hanging cloth banner on a pole (cloth is a separate wind-animated mesh)."""
        with self.frame(x, z, yaw):
            self.box(0, y, 0.03, 0.46, 0.02, 0.02, 'iron'); self.box(0.0, y - 0.9, 0.04, 0.4, 0.9, 0.008, f'cloth{i % 4}')
            self.box(0, y - 0.9, 0.046, 0.42, 0.024, 0.012, 'gold')
            for sx in (-1, 1): self.lathe(sx * 0.23, y - 0.01, 0.03, [(0, 0), (0.016, 0.0), (0.012, 0.025), (0.0, 0.03)], 8, 'gold')
            self.box(0, y - 0.9 - 0.05, 0.042, 0.4, 0.06, 0.006, f'cloth{(i + 1) % 4}')

    def barrel(self, x, z, y0=0.0, s=1.0):
        pr = [(0.0, 0.0), (0.17 * s, 0.0), (0.2 * s, 0.12 * s), (0.21 * s, 0.25 * s), (0.2 * s, 0.38 * s), (0.17 * s, 0.5 * s), (0.0, 0.5 * s)]
        self.lathe(x, y0, z, pr, 28 if self.hi else 12, 'timber')
        for yy, r in ((0.08, 0.186), (0.42, 0.186), (0.25, 0.212)): self.lathe(x, y0 + yy * s, z, [(r * s, -0.012 * s), (r * s + 0.008 * s, 0.0), (r * s, 0.012 * s)], 28 if self.hi else 12, 'iron')
        if self.hi:
            for k in range(14):
                a = TAU * k / 14; self.box(x + math.cos(a) * 0.2 * s, y0 + 0.02 * s, z + math.sin(a) * 0.2 * s, 0.008, 0.46 * s, 0.008, 'beam', yaw=-a)

    def crate(self, x, z, sz, yaw, y0=0.0):
        self.box(x, y0, z, sz, sz, sz, 'timber', yaw=yaw)
        for k in (-1, 1):
            for ax in range(2):
                if ax == 0: self.box(x, y0 + sz / 2 + k * (sz / 2 - 0.03) - 0.025, z, sz + 0.016, 0.05, sz + 0.016, 'beam', yaw=yaw)
                else: self.box(x, y0, z, sz + 0.016, sz + 0.016, 0.05, 'beam', yaw=yaw) if k == -1 else None

    def hedge(self, x, z, w, d, h=0.34, y0=0.0, mat='hedge', yaw=0.0):
        """Hedge of overlapping leaf clumps: lumpy domes jittered in height and radius over a dense inner core, so the silhouette is foliage, not a box.
        Game mesh uses ~0.16 unit clumps (6 segments), the high-poly bake ~0.07 unit clumps (10 segments) for the normal and occlusion maps."""
        c, s = math.cos(yaw), math.sin(yaw); r = self.r; step = 0.07 if self.hi else 0.16; segs = 10 if self.hi else 6
        nx, nz = max(1, round(w / step)), max(1, round(d / step)); alt = 'hedge2' if mat == 'hedge' else mat
        self.box(x, y0, z, w * 0.8, h * 0.62, d * 0.8, alt, yaw=yaw)
        for i in range(nx):
            for j in range(nz):
                lx = ((i + 0.5) / nx - 0.5) * w + (r.random() - 0.5) * step * 0.5; lz = ((j + 0.5) / nz - 0.5) * d + (r.random() - 0.5) * step * 0.5
                rad = max(w / nx, d / nz) * (0.7 + r.random() * 0.25); hh = h * (0.82 + r.random() * 0.18); ph = r.random() * 6.28
                prof = [(0.0, 0.0), (rad * 0.92, 0.0), (rad * 0.98, hh * 0.35), (rad * 0.8, hh * 0.72), (rad * 0.42, hh * 0.95), (0.0, hh)]
                self.lathe(x + lx * c + lz * s, y0, z - lx * s + lz * c, prof, segs, mat if (i + j) % 2 else alt, mod=lambda a, yy, ph=ph: 0.9 + 0.2 * math.sin(a * 3.0 + ph + yy * 9.0))

    def flowers(self, x, z, w, d, n=10, y0=0.0):
        for i in range(n):
            fx = x + (self.r.random() - 0.5) * w; fz = z + (self.r.random() - 0.5) * d; c = ('flowerA', 'flowerB', 'flowerC')[i % 3]
            self.lathe(fx, y0, fz, [(0.0, 0.0), (0.02, 0.05), (0.04, 0.09), (0.0, 0.1)], 7 if self.hi else 4, c)

    # ---- finishing
    def finish(self, name):
        bm = self.bm; bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        if self.hi:
            for n in NAMES:
                m = bpy.data.materials.new(n + '_hi'); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
                at = nt.nodes.new('ShaderNodeVertexColor'); at.layer_name = 'Col'
                noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 3.0; noise.inputs['Detail'].default_value = 6.0
                geo = nt.nodes.new('ShaderNodeNewGeometry'); nt.links.new(geo.outputs['Position'], noise.inputs['Vector'])
                mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 0.0 if n in EMISSIVE or n.startswith('cloth') else 0.18
                nt.links.new(noise.outputs['Fac'], mix.inputs[0]); nt.links.new(at.outputs['Color'], mix.inputs[6]); b.inputs['Base Color'].default_value = (1, 1, 1, 1)
                nt.links.new(mix.outputs[2], b.inputs['Base Color'])
                rr = nt.nodes.new('ShaderNodeMath'); rr.operation = 'ADD'; rr.inputs[1].default_value = ROUGH[n] - 0.1
                nm = nt.nodes.new('ShaderNodeMath'); nm.operation = 'MULTIPLY'; nm.inputs[1].default_value = 0.2; nt.links.new(noise.outputs['Fac'], nm.inputs[0]); nt.links.new(nm.outputs[0], rr.inputs[0])
                nt.links.new(rr.outputs[0], b.inputs['Roughness']); b.inputs['Metallic'].default_value = METAL[n]
                # surface relief baked into the tangent normal: weave for cloth, grain for wood, pitting for stone/rock/brick/plaster
                bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Distance'].default_value = 0.004
                if n.startswith('cloth') or n == 'sail':
                    wv = nt.nodes.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.inputs['Scale'].default_value = 520.0; wv.inputs['Distortion'].default_value = 0.3; wv.inputs['Detail'].default_value = 1.0
                    w2 = nt.nodes.new('ShaderNodeTexWave'); w2.wave_type = 'BANDS'; w2.bands_direction = 'Y'; w2.inputs['Scale'].default_value = 520.0
                    mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MULTIPLY'; nt.links.new(wv.outputs['Fac'], mx.inputs[0]); nt.links.new(w2.outputs['Fac'], mx.inputs[1]); nt.links.new(mx.outputs[0], bump.inputs['Height']); bump.inputs['Distance'].default_value = 0.0015
                elif n in ('timber', 'wood2', 'beam', 'wood', 'signD'):
                    wv = nt.nodes.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'X'; wv.inputs['Scale'].default_value = 42.0; wv.inputs['Distortion'].default_value = 6.0; wv.inputs['Detail'].default_value = 3.0; wv.inputs['Detail Scale'].default_value = 2.5
                    nt.links.new(geo.outputs['Position'], wv.inputs['Vector']); nt.links.new(wv.outputs['Fac'], bump.inputs['Height']); bump.inputs['Distance'].default_value = 0.003
                else:
                    nz2 = nt.nodes.new('ShaderNodeTexNoise'); nz2.inputs['Scale'].default_value = 90.0; nz2.inputs['Detail'].default_value = 8.0; nt.links.new(geo.outputs['Position'], nz2.inputs['Vector']); nt.links.new(nz2.outputs['Fac'], bump.inputs['Height']); bump.inputs['Distance'].default_value = 0.006 if n in ('rock', 'stone', 'brick', 'brickD') else 0.002
                nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
                if n in EMISSIVE: b.inputs['Emission Color'].default_value = lin(PAL[n]); b.inputs['Emission Strength'].default_value = 0.0
                me.materials.append(m)
        me.transform(Matrix.Rotation(math.pi / 2, 4, 'X')); me.update()
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob
