"""
Landmark asset kit for the Olympia-style sanctuary (run headless: blender -b --factory-startup -P <asset>.py).

Every asset is authored twice from one builder: hi=True builds the high-poly source (fluted columns with entasis,
ashlar courses, roof tiles, pediment figures, triglyph grooves), hi=False builds the clean-quad game mesh.
`bake_and_export` unwraps the game mesh, bakes colour, normal and AO from the high-poly onto it, makes LOD0..2 and
writes <id>.glb (WEBP textures) plus a manifest entry. Geometry is built in world axes (x east, y up, +z front) and
rotated into Blender axes at the end, so the exported glTF matches the three.js plan (front = +z, origin = footprint centre).
"""
import bpy, bmesh, math, os, sys, json, random
import numpy as np
from contextlib import contextmanager
from mathutils import Matrix, Vector
import sculpt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
OUT = os.environ.get('SITE_ASSET_OUT', os.path.join(ROOT, 'assets', 'cache', 'site-src'))  # webp glb source; scripts/assets/site-pack.mjs writes public/assets/site (KTX2)
DIMS = json.load(open(os.path.join(HERE, 'dims.json')))


def lin(h):
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(((h >> 16) & 255) / 255), f(((h >> 8) & 255) / 255), f((h & 255) / 255), 1.0)


PAL = dict(marble=0xe9e3d6, lime=0xd9cfba, stone=0xb4a994, terra=0xa65631, terraD=0x7c4029, ochre=0xc9a05a, blue=0x3f6275, red=0x9a3f35,
           bronze=0xa8793a, wood=0x7a5a3d, plaster=0xeee3cb, sand=0xe0cc9c, dark=0x3a342e, gold=0xd9aa4a, grass=0x74894f,
           mud=0xc7a77d, rope=0x9a8458, hull=0x6d4c34, sail=0xe8dfc8, thatch=0xb59a5b, soil=0x5a4632, crop=0x6f8450, water=0x6f9a9e, rock=0x9b8f7c, cloth=0x9a3f35, cloth2=0xc9a05a, flame=0xffa43a)
ROUGH = dict(marble=0.5, lime=0.75, stone=0.85, terra=0.8, terraD=0.8, bronze=0.38, gold=0.32, wood=0.7, plaster=0.9, water=0.08, sail=0.95, rope=0.95, flame=0.6)
METAL = dict(bronze=0.9, gold=0.95)
NAMES = list(PAL)
IDX = {n: i for i, n in enumerate(NAMES)}
TAU = math.tau
SMOOTH_DEG = 34.0  # edges flatter than this shade smooth (columns, cones, figures); harder ones stay crisp (wall corners, octagon drums)


class K:
    """Mesh accumulator. hi selects the high-poly variant of every primitive."""

    def __init__(self, hi):
        self.bm = bmesh.new(); self.hi = hi; self.fr = [(0.0, 0.0, 0.0, 0.0)]; self.rnd = random.Random(11)

    # ---- frames: nested (x, y, z, yaw) offsets so a sub-assembly can be placed anywhere
    @contextmanager
    def frame(self, x=0.0, z=0.0, yaw=0.0, y=0.0):
        self.fr.append((x, y, z, yaw)); yield; self.fr.pop()

    def w(self, x, y, z):
        for (ox, oy, oz, yaw) in reversed(self.fr):
            c, s = math.cos(yaw), math.sin(yaw); x, z = x * c + z * s + ox, -x * s + z * c + oz; y += oy
        return (x, y, z)

    def v(self, x, y, z): return self.bm.verts.new(self.w(x, y, z))

    def face(self, vs, mat, sm=False):
        try:
            f = self.bm.faces.new(vs); f.material_index = IDX[mat]; f.smooth = sm; return f
        except ValueError:
            return None

    # ---- primitives
    def box(self, cx, y0, cz, w, h, d, mat, yaw=0.0, rot=None):
        """Box centred on (cx, cz) spanning y0..y0+h. rot: optional 3x3 Matrix applied about the box centre before yaw."""
        R = Matrix.Rotation(yaw, 3, 'Y') if yaw else Matrix.Identity(3)  # same convention as frames: local z -> (sin, cos)
        if rot is not None: R = R @ rot
        hs = (w / 2, h / 2, d / 2); vs = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    p = R @ Vector((sx * hs[0], sy * hs[1], sz * hs[2])); vs.append(self.v(cx + p.x, y0 + h / 2 + p.y, cz + p.z))
        for idx in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)): self.face([vs[i] for i in idx], mat)

    def prism(self, cx, y0, cz, w, d, h, mat, ridge='z', end=None):
        """Gable prism: rectangular base w x d, ridge at height h along `ridge` axis."""
        x0, x1, z0, z1 = cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2
        if ridge == 'z':
            a, b, c, e = self.v(x0, y0, z0), self.v(x1, y0, z0), self.v(x1, y0, z1), self.v(x0, y0, z1); r0, r1 = self.v(cx, y0 + h, z0), self.v(cx, y0 + h, z1)
            self.face([a, b, c, e], mat); self.face([a, r0, b], end or mat); self.face([e, c, r1], end or mat); self.face([a, e, r1, r0], mat); self.face([b, r0, r1, c], mat)
        else:
            a, b, c, e = self.v(x0, y0, z0), self.v(x1, y0, z0), self.v(x1, y0, z1), self.v(x0, y0, z1); r0, r1 = self.v(x0, y0 + h, cz), self.v(x1, y0 + h, cz)
            self.face([a, b, c, e], mat); self.face([a, e, r0], end or mat); self.face([b, r1, c], end or mat); self.face([a, b, r1, r0], mat); self.face([e, r0, r1, c], mat)

    def lathe(self, cx, y0, cz, prof, segs, mat, mod=None, ratio=(1.0, 1.0)):
        """Surface of revolution. prof = [(r, y)] bottom to top (closed with cap fans). mod(angle, y_rel) -> radius multiplier. ratio = (x, z) stretch."""
        rings = []
        for (r, yy) in prof:
            ring = []
            for j in range(segs):
                a = TAU * j / segs; m = mod(a, yy) if mod else 1.0
                ring.append(self.v(cx + math.cos(a) * r * m * ratio[0], y0 + yy, cz + math.sin(a) * r * m * ratio[1]))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for j in range(segs):
                j2 = (j + 1) % segs; self.face([rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]], mat, True)
        top = self.v(cx, y0 + prof[-1][1], cz); bot = self.v(cx, y0 + prof[0][1], cz)
        for j in range(segs):
            j2 = (j + 1) % segs; self.face([rings[-1][j], rings[-1][j2], top], mat, True); self.face([rings[0][j2], rings[0][j], bot], mat, True)

    def tube_arch(self, cx, y0, cz, w, h, d, t, mat, n=12):
        """Barrel vault (tunnel): outer half-cylinder of span w and thickness t, length d along z, standing on y0 with straight jambs."""
        ro, ri = w / 2 + t, w / 2; ys = h - ri  # spring height
        pts_o = [(-ro, 0.0)] + [(math.cos(math.pi - math.pi * i / n) * ro, ys + math.sin(math.pi * i / n) * ro) for i in range(n + 1)] + [(ro, 0.0)]
        pts_i = [(-ri, 0.0)] + [(math.cos(math.pi - math.pi * i / n) * ri, ys + math.sin(math.pi * i / n) * ri) for i in range(n + 1)] + [(ri, 0.0)]
        for zz in (-d / 2, d / 2):
            vo = [self.v(cx + x, y0 + y, cz + zz) for x, y in pts_o]; vi = [self.v(cx + x, y0 + y, cz + zz) for x, y in pts_i]
            if zz < 0: fo, fi = vo, vi
            else: bo, bi = vo, vi
        for i in range(len(pts_o) - 1):
            self.face([fo[i], bo[i], bo[i + 1], fo[i + 1]], mat); self.face([fi[i], fi[i + 1], bi[i + 1], bi[i]], mat)
            self.face([fo[i], fo[i + 1], fi[i + 1], fi[i]], mat); self.face([bo[i], bi[i], bi[i + 1], bo[i + 1]], mat)
        self.face([fo[0], fi[0], bi[0], bo[0]], mat); self.face([fo[-1], bo[-1], bi[-1], fi[-1]], mat)

    # ---- masonry
    def ashlar(self, cx, y0, cz, w, h, d, mat, yaw=0.0, course=0.22, block=0.6):
        """Wall block: one box at game detail. High detail: a recessed core wrapped in courses of dressed blocks on all four faces (corners bonded by alternating which
        face runs through), so every side shows real joints; slabs thinner than 0.5 keep single blocks running through the thickness."""
        if not self.hi: return self.box(cx, y0, cz, w, h, d, mat, yaw)
        self.box(cx, y0 + 0.008, cz, w - 0.02, h - 0.03, d - 0.02, 'stone', yaw)  # recessed core fills the joints; lifted off y0 so no hi face is coplanar with the game mesh's underside (coplanar hits baked dark speckle blocks)
        rows = max(1, round(h / course)); ch = h / rows; g = 0.012; J = self.rnd.random
        thin = min(w, d) < 0.5; t = min(w, d) if thin else min(0.3, min(w, d) / 2 - 0.02)
        with self.frame(cx, cz, yaw):
            def run(axis, c, lo, hi_, r, ro):  # blocks along `axis` between lo..hi_, outer face at offset c, thickness t, staggered by row
                n = max(1, round((hi_ - lo) / block)); bl = (hi_ - lo) / n; off = 0.5 if r % 2 else 0.0
                for i in range(n + 1):
                    u0 = max(lo, lo + (i - off) * bl); u1 = min(hi_, lo + (i + 1 - off) * bl)
                    if u1 - u0 < 0.04: continue
                    m, ln = (u0 + u1) / 2, u1 - u0 - g - J() * 0.01; th = t + (J() - 0.5) * 0.012
                    lift = 0.006 if r == 0 else 0.0
                    if axis == 'x': self.box(m, y0 + r * ch + lift, c, ln, ch - g - lift - J() * 0.006, th, mat)
                    else: self.box(c, y0 + r * ch + lift, m, th, ch - g - lift - J() * 0.006, ln, mat)
            for r in range(rows):
                even = r % 2 == 0
                if thin:
                    if w >= d: run('x', 0.0, -w / 2, w / 2, r, 0)
                    else: run('z', 0.0, -d / 2, d / 2, r, 0)
                    continue
                for sz in (-1, 1): run('x', sz * (d / 2 - t / 2), -w / 2, w / 2, r, 0) if even else run('x', sz * (d / 2 - t / 2), -w / 2 + t, w / 2 - t, r, 0)
                for sx in (-1, 1): run('z', sx * (w / 2 - t / 2), -d / 2 + t, d / 2 - t, r, 0) if even else run('z', sx * (w / 2 - t / 2), -d / 2, d / 2, r, 0)

    def steps(self, cx, cz, y0, w, d, n, rise, tread, mat='marble'):
        """Stepped crepidoma; returns the top y. Each step inset by `tread` on every side."""
        for i in range(n):
            self.ashlar(cx, y0 + i * rise, cz, w + 2 * tread * (n - i), rise, d + 2 * tread * (n - i), mat, course=rise, block=0.9)
        return y0 + n * rise

    # ---- columns
    def column(self, cx, cz, y0, h, r0, r1, order='doric', mat='marble', flutes=20, cap=True):
        """Fluted column with entasis and a capital. Returns the y of the top of the capital."""
        nrm = 28 if self.hi else 12; segs = flutes * 3 if self.hi else 16
        bulge = r0 * 0.045
        prof = [(r0 + (r1 - r0) * (i / nrm) + math.sin(math.pi * i / nrm) * bulge, h * i / nrm) for i in range(nrm + 1)]
        if self.hi:
            dep = 0.075 if order != 'ionic' else 0.06
            def mod(a, yy, f=flutes):
                u = (a * f / TAU) % 1.0; yr = yy / h
                return 1 - dep * (1 - (2 * u - 1) ** 2) * (1.0 if 0.02 < yr < 0.95 else 0.0)
        else: mod = None
        self.lathe(cx, y0, cz, prof, segs, mat, mod)
        top = y0 + h; rt = r1
        if not cap: return top
        if order == 'doric':
            ech = [(rt * 1.0, 0.0), (rt * 1.04, 0.012), (rt * 1.2, 0.035), (rt * 1.5, 0.07)]
            self.lathe(cx, top, cz, [(r, y) for r, y in ech], segs if self.hi else 16, mat)
            self.box(cx, top + 0.07, cz, rt * 3.1, 0.07, rt * 3.1, mat); return top + 0.14
        if order == 'ionic':
            self.lathe(cx, top, cz, [(rt, 0.0), (rt * 1.15, 0.02), (rt * 1.3, 0.04)], segs if self.hi else 16, mat)
            self.box(cx, top + 0.04, cz, rt * 3.2, 0.05, rt * 2.0, mat)  # cushion
            for sx in (-1, 1):  # volute scrolls: a drum at each end; high detail adds the spiral ribs
                self.box(cx + sx * rt * 1.35, top + 0.045, cz, rt * 0.55, rt * 0.5, rt * 1.9, mat)
                if self.hi:
                    for k in range(3): self.box(cx + sx * rt * 1.65, top + 0.06 + k * 0.012, cz + (k - 1) * rt * 0.45, 0.012, rt * 0.3, rt * 0.3, mat)
            self.box(cx, top + 0.09, cz, rt * 3.3, 0.05, rt * 2.1, mat); return top + 0.14
        return top

    # ---- roofs and sculpture
    def tile_roof(self, cx, y0, cz, w, d, rise, mat='terra', over=0.12, end='lime'):
        """Gable roof, ridge along z (d is the length, w the span). High detail adds pan and cover tile ridges on both slopes."""
        self.prism(cx, y0, cz, w + over * 2, d, rise, mat, end=end)  # eaves overhang the sides only; the gable ends stay behind the pediment
        if not self.hi: return
        half = w / 2 + over; L = math.hypot(half, rise); ang = math.atan2(rise, half)
        n = int(d / 0.09)
        for side in (-1, 1):  # antefixes cap the cover tile rows at the eaves
            for i in range(0, n, 3):
                z = cz - d / 2 + (i + 0.5) * d / n; self.box(cx + side * (half - 0.01), y0 - 0.005, z, 0.035, 0.06, 0.035, 'terra')
        for side in (-1, 1):
            R = Matrix.Rotation(-side * ang, 3, 'Z')
            for i in range(n):
                z = cz - d / 2 + (i + 0.5) * d / n
                mx = cx + side * half / 2; my = y0 + rise / 2 + 0.012
                self.box(mx, my - 0.012, z, L, 0.03, 0.035, 'terraD', rot=R)
            rows = max(2, int(L / 0.11))  # pan-tile course laps: one raised lip across every pan, so each tile reads as its own piece
            for r in range(1, rows):
                u = r / rows; px, py = cx + side * half * (1 - u), y0 + rise * u + 0.004
                for i in range(n): self.box(px, py - 0.004, cz - d / 2 + (i + 0.5) * d / n, 0.012, 0.012, d / n - 0.05, 'terra', rot=R)

    def figure(self, cx, y0, cz, h, yaw=0.0, mat='marble', pose='stand'):
        """Draped standing figure (chiton with folds, torso, neck, head, arms, feet) from lathes: 18 segments high detail, 10 on the game mesh; 'lie' is a reclining pediment figure."""
        with self.frame(cx, cz, yaw, y0):
            s = h / 1.8; hi = self.hi; sg = 18 if hi else 10
            if pose == 'lie':
                self.box(0, 0.0, 0, 1.5 * s, 0.28 * s, 0.4 * s, mat); self.box(0.9 * s, 0.0, 0, 0.3 * s, 0.26 * s, 0.26 * s, mat); return
            sg = 20 if hi else 14
            fold = (lambda a, yy: 1.0 + 0.075 * math.sin(a * 9 + yy * 5.0) * max(0.0, 1.0 - yy / (0.84 * s))) if hi else None
            self.lathe(0, 0.02 * s, 0, [(0.0, 0.0), (0.2 * s, 0.0), (0.21 * s, 0.05 * s), (0.17 * s, 0.4 * s), (0.14 * s, 0.7 * s), (0.13 * s, 0.82 * s), (0.0, 0.82 * s)], sg, mat, mod=fold, ratio=(1.0, 0.8))
            for sx in (-1, 1): self.lathe(sx * 0.09 * s, 0.0, 0.05 * s, [(0.0, 0.0), (0.06 * s, 0.0), (0.055 * s, 0.04 * s), (0.0, 0.05 * s)], 8 if hi else 6, mat, ratio=(0.8, 1.5))
            self.lathe(0, 0.8 * s, 0, [(0.0, 0.0), (0.13 * s, 0.0), (0.17 * s, 0.2 * s), (0.2 * s, 0.5 * s), (0.17 * s, 0.66 * s), (0.0, 0.7 * s)], sg, mat, ratio=(1.18, 0.62))
            self.lathe(0, 1.46 * s, 0, [(0.0, 0.0), (0.055 * s, 0.0), (0.045 * s, 0.11 * s), (0.0, 0.11 * s)], 8 if hi else 6, mat)
            self.lathe(0, 1.54 * s, 0, [(0.0, 0.0), (0.07 * s, 0.01 * s), (0.1 * s, 0.08 * s), (0.1 * s, 0.16 * s), (0.07 * s, 0.24 * s), (0.0, 0.265 * s)], 14 if hi else 10, mat, ratio=(0.9, 1.05))
            for sx in (-1, 1):  # shoulder ball and a draped, slightly bent arm hanging at the side
                self.lathe(sx * 0.215 * s, 1.36 * s, 0, [(0.0, 0.0), (0.06 * s, 0.03 * s), (0.065 * s, 0.09 * s), (0.04 * s, 0.14 * s), (0.0, 0.15 * s)], 10 if hi else 8, mat)
                self.lathe(sx * 0.235 * s, 0.82 * s, 0.01 * s, [(0.0, 0.0), (0.035 * s, 0.0), (0.05 * s, 0.1 * s), (0.055 * s, 0.34 * s), (0.05 * s, 0.56 * s), (0.0, 0.58 * s)], 10 if hi else 8, mat)

    def sculpt(self, cx, y0, cz, h, pose='stand', yaw=0.0, flip=False, mat='marble', drape=False, hero=False):
        """Posed, skinned figure (see sculpt.py): h is the standing height (reclining poses are h long). flip mirrors left-right. drape adds a pleated chiton skirt."""
        verts, faces = sculpt.skin_body(pose, self.hi, hero); s = h / 1.8
        with self.frame(cx, cz, yaw, y0):
            vs = [self.v((-x if flip else x) * s, y * s, z * s) for x, y, z in verts]
            for f in faces: self.face([vs[i] for i in (reversed(f) if flip else f)], mat, True)
            if drape and pose == 'stand':
                fold = lambda a, yy: 1.0 + 0.075 * math.sin(a * 6 + yy * 3.0) * (1.0 - yy / (1.1 * s))  # six pleats; lo-poly segments below keep four samples per pleat
                self.lathe(0, 0.0, 0.0, [(0.0, 0.0), (0.30 * s, 0.0), (0.30 * s, 0.03 * s), (0.25 * s, 0.4 * s), (0.2 * s, 0.82 * s), (0.17 * s, 1.0 * s), (0.125 * s, 1.1 * s), (0.0, 1.12 * s)], 36 if self.hi else 24, mat, mod=fold, ratio=(1.0, 0.78))

    # (pose, position across the pediment -1..1 (head side faces the centre), nominal height as a fraction of the rise, drape): mirrored about the centre
    PED_GROUP = (('recline', -0.86, 0.5, False), ('kneel', -0.64, 0.72, False), ('stand', -0.43, 0.84, True), ('stride', -0.2, 0.9, False))
    PED_NARROW = (('recline', -0.84, 0.5, False), ('kneel', -0.58, 0.72, False), ('stride', -0.3, 0.9, False))  # gables under 4 units wide

    def pediment(self, cx, y0, cz, w, depth, rise, mat='marble', figs=True, face=1):
        """Triangular pediment with a recessed tympanum and a sculpted group in front of it (high detail and game mesh alike): reclining corner figures,
        kneeling and striding combatants, draped attendants and a tall central figure, scaled to the room the raking cornice leaves. face=-1 builds the rear gable."""
        with self.frame(cx, cz, 0.0 if face > 0 else math.pi):
            self.prism_x(0.0, y0, 0.0, w, depth, rise, mat)
            if not figs: return
            ymax = {'stand': 1.8, 'stride': 1.85, 'kneel': 1.45, 'recline': 0.5}; zf = depth / 2 + 0.012
            half = self.PED_GROUP if w >= 4 else self.PED_NARROW
            group = [(p, t, hr, dr, False) for p, t, hr, dr in half] + [('stand', 0.0, 0.94, True, False)] + [(p, -t, hr, dr, True) for p, t, hr, dr in half]
            for pose, t, hr, dr, flip in group:
                x = t * w / 2; hw = w / 2; sn = hr * rise / ymax[pose]  # nominal unit-figure scale
                head = abs(x) + {'stride': 0.2, 'recline': -0.8}.get(pose, 0.0) * sn  # where the highest point sits across the gable
                s = min(sn, max(0.02, rise * (1 - head / hw) - 0.025) / ymax[pose])
                self.sculpt(x, y0 + 0.012, zf, s * 1.8, pose, 0.0, flip, 'lime', dr)

    def _arc_solid(self, cx, cz, y0, y1, ro, ri, a0, a1, segs, mat):
        """Closed curved block: outer radius ro, inner ri, angles a0..a1 (x = cx + R cos a, z = cz - R sin a), y0..y1."""
        ang = [a0 + (a1 - a0) * i / segs for i in range(segs + 1)]
        P = lambda R, y: [self.v(cx + R * math.cos(a), y, cz - R * math.sin(a)) for a in ang]
        o0, o1, i0, i1 = P(ro, y0), P(ro, y1), P(ri, y0), P(ri, y1)
        for i in range(segs):
            self.face([o0[i], o0[i + 1], o1[i + 1], o1[i]], mat, True); self.face([i0[i + 1], i0[i], i1[i], i1[i + 1]], mat, True)
            self.face([o1[i], o1[i + 1], i1[i + 1], i1[i]], mat); self.face([o0[i + 1], o0[i], i0[i], i0[i + 1]], mat)
        self.face([o0[0], i0[0], i1[0], o1[0]], mat); self.face([o0[segs], o1[segs], i1[segs], i0[segs]], mat)

    def arc_wall(self, cx, cz, y0, h, ro, th, a0, a1, mat, course=0.2, block=0.4):
        """Curved wall (apse, exedra). Game mesh: one smooth shell. High detail: staggered courses of dressed curved blocks round a recessed core."""
        arc = abs(a1 - a0) * ro; ri = ro - th
        if not self.hi: return self._arc_solid(cx, cz, y0, y0 + h, ro, ri, a0, a1, max(8, int(arc / 0.14)), mat)
        self._arc_solid(cx, cz, y0, y0 + h, ro - 0.012, ri + 0.012, a0, a1, max(16, int(arc / 0.05)), 'stone')
        rows = max(1, round(h / course)); ch = h / rows; g = 0.012; J = self.rnd.random; nb = max(2, round(arc / block))
        for r in range(rows):
            off = 0.5 if r % 2 else 0.0
            for i in range(nb + 1):
                b0 = max(0.0, (i - off) / nb); b1 = min(1.0, (i + 1 - off) / nb)
                if (b1 - b0) * arc < 0.06: continue
                u0, u1 = a0 + (a1 - a0) * b0, a0 + (a1 - a0) * b1; gap = g / ro
                self._arc_solid(cx, cz, y0 + r * ch, y0 + (r + 1) * ch - g - J() * 0.006, ro + (J() - 0.5) * 0.012, ri - (J() - 0.5) * 0.012, u0 + gap, u1 - gap, max(2, int((u1 - u0) * ro / 0.06)), mat)

    def ring_roof(self, w, d, iw, idp, y0, h_out, h_in, mat='terra', cx=0.0, cz=0.0):
        """Mitred ring roof round a courtyard: outer rectangle w x d, opening iw x idp, closed slab sitting on y0 whose top falls from y0 + h_out at the outer edge to
        y0 + h_in at the opening (rain runs into the court). Hips come from joining outer and inner corners. High detail adds pan ribs and lap courses on all four slopes."""
        rect = lambda hw, hd, y: [self.v(cx + sx * hw, y, cz + sz * hd) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        ob, ot, it, ib = rect(w / 2, d / 2, y0), rect(w / 2, d / 2, y0 + h_out), rect(iw / 2, idp / 2, y0 + h_in), rect(iw / 2, idp / 2, y0)
        for i in range(4):
            j = (i + 1) % 4
            self.face([ot[i], ot[j], it[j], it[i]], mat); self.face([ob[i], ob[j], ot[j], ot[i]], 'lime')
            self.face([it[i], it[j], ib[j], ib[i]], mat); self.face([ob[j], ob[i], ib[i], ib[j]], mat)
        if not self.hi: return
        sl = math.atan2(h_out - h_in, (w - iw) / 2)  # slope for rib thickness only
        for side in range(4):  # 0 rear (-z), 1 right (+x), 2 front (+z), 3 left (-x): frame so the eave runs along local x with the opening toward -z
            yaw = (0.0, -math.pi / 2, math.pi, math.pi / 2)[side]; Lo, Li = (w, iw) if side in (0, 2) else (d, idp); Do, Di = (d, idp) if side in (0, 2) else (w, iw)
            with self.frame(cx, cz, yaw):
                zo, zi = Do / 2, Di / 2  # outer edge at local z = -zo (eave), opening at -zi ... mirrored for the frame (rear side faces -z)
                n = int(Li / 0.09)
                for i in range(n):
                    x = -Li / 2 + (i + 0.5) * Li / n; self.beam((x, y0 + h_out + 0.012, -zo), (x, y0 + h_in + 0.012, -zi), 0.035, 'terraD', 0.03)
                rows = max(2, int((zo - zi) / 0.11))
                for r in range(1, rows):
                    u = r / rows; hx = (Lo / 2) * (1 - u) + (Li / 2) * u - 0.04; zz = -zo + (zo - zi) * u; yy = y0 + h_out + (h_in - h_out) * u + 0.006
                    self.beam((-hx, yy, zz), (hx, yy, zz), 0.016, mat, 0.014)

    def cone_roof(self, cx, y0, cz, R, rise, a0, a1, mat='terra', segs=None):
        """Tiled conical roof sector: apex above (cx, cz), eaves ring of radius R from angle a0 to a1 (x = cx + R cos a, z = cz - R sin a). Closed (underside and cut faces),
        smooth on the game mesh; high detail adds a tapering cover-tile ridge on every ray and a lap course across every pan."""
        n = segs or max(10, int(abs(a1 - a0) * R / 0.12)) if not self.hi else max(40, int(abs(a1 - a0) * R / 0.045))
        ang = [a0 + (a1 - a0) * i / n for i in range(n + 1)]
        A = self.v(cx, y0 + rise, cz); C = self.v(cx, y0, cz); ring = [self.v(cx + R * math.cos(a), y0, cz - R * math.sin(a)) for a in ang]
        for i in range(n):
            self.face([A, ring[i + 1], ring[i]], mat, True); self.face([C, ring[i], ring[i + 1]], mat)
        full = abs(abs(a1 - a0) - TAU) < 1e-6
        if not full: self.face([A, ring[0], C], mat); self.face([A, C, ring[n]], mat)
        if not self.hi: return
        nr = max(8, int(abs(a1 - a0) * R / 0.09)); k = rise / R; nz = math.hypot(k, 1.0)
        for i in range(nr):
            a = a0 + (a1 - a0) * (i + 0.5) / nr; rx, rz = math.cos(a), -math.sin(a); tx, tz = -rz, rx  # ray (outward) and its horizontal perpendicular
            nx, ny, nzz = rx * k / nz, 1.0 / nz, rz * k / nz; pts = []
            for u, wd in ((0.0, 0.034), (0.5, 0.022), (0.93, 0.007)):
                px, py, pz = cx + R * (1 - u) * rx, y0 + rise * u, cz + R * (1 - u) * rz; hw = wd * (1 - u * 0.6) / 2 * (1 - u * 0.5) + 0.002
                pts.append((self.v(px + tx * hw, py, pz + tz * hw), self.v(px + nx * 0.018, py + ny * 0.018, pz + nzz * 0.018), self.v(px - tx * hw, py, pz - tz * hw)))
            for q in range(len(pts) - 1):
                (l0, t0, r0), (l1, t1, r1) = pts[q], pts[q + 1]; self.face([l0, t0, t1, l1], 'terraD'); self.face([t0, r0, r1, t1], 'terraD')
        rows = max(2, int(math.hypot(R, rise) / 0.11))
        for r in range(1, 1 if full else rows):  # full cones skip the lap rings: their dashed beams baked black blobs where they cross the ribs
            u = r / rows; rr = R * (1 - u); m = max(4, int(abs(a1 - a0) * rr / 0.09))
            for i in range(m):
                a = a0 + (a1 - a0) * (i + 0.5) / m; ca, sa = math.cos(a), -math.sin(a)
                da = (a1 - a0) / m * 0.4; ya = y0 + rise * u + 0.008
                self.beam((cx + rr * math.cos(a - da), ya, cz - rr * math.sin(a - da)), (cx + rr * math.cos(a + da), ya, cz - rr * math.sin(a + da)), 0.014, mat, 0.016)

    def prism_x(self, cx, y0, cz, w, d, h, mat):
        """Pediment prism: triangle in the xy plane, thickness d along z."""
        a, b, c = self.v(cx - w / 2, y0, cz - d / 2), self.v(cx + w / 2, y0, cz - d / 2), self.v(cx, y0 + h, cz - d / 2)
        a2, b2, c2 = self.v(cx - w / 2, y0, cz + d / 2), self.v(cx + w / 2, y0, cz + d / 2), self.v(cx, y0 + h, cz + d / 2)
        self.face([a, c, b], mat); self.face([a2, b2, c2], mat); self.face([a, b, b2, a2], mat); self.face([a, a2, c2, c], mat); self.face([b, c, c2, b2], mat)

    def acroterion(self, cx, y0, cz, s=1.0, mat='gold'):
        self.lathe(cx, y0, cz, [(0.0, 0.0), (0.05 * s, 0.0), (0.04 * s, 0.06 * s), (0.05 * s, 0.1 * s)], 8, 'lime')
        self.lathe(cx, y0 + 0.1 * s, cz, [(0.0, 0.0), (0.16 * s, 0.0), (0.16 * s, 0.03 * s), (0.0, 0.03 * s)] if not self.hi else [(0.0, 0.0), (0.16 * s, 0.0), (0.16 * s, 0.03 * s), (0.1 * s, 0.03 * s), (0.1 * s, 0.045 * s), (0.0, 0.045 * s)], 14 if self.hi else 8, mat, ratio=(1.0, 0.25))

    def triglyph_frieze(self, cx, y0, cz, w, d, h, side='z', mat='lime'):
        """Entablature band: architrave block plus alternating triglyphs (blue) and metopes; side z = front/back run along x, x = flanks."""
        self.box(cx, y0, cz, w, h * 0.45, d, mat)  # architrave
        fy = y0 + h * 0.45; fh = h * 0.55
        self.box(cx, fy, cz, w - 0.02, fh, d - 0.02, mat)
        if not self.hi: return
        n = max(2, int((w if side == 'z' else d) / 0.32))
        for i in range(n):
            t = (i + 0.5) / n; off = (t - 0.5) * ((w if side == 'z' else d) - 0.1)
            if side == 'z':
                for k in range(3): self.box(cx + off + (k - 1) * 0.04, fy, cz + d / 2 + 0.002, 0.025, fh, 0.02, 'blue')
                self.box(cx + off + 0.16, fy + 0.03, cz + d / 2 + 0.004, 0.14, fh - 0.06, 0.012, 'plaster')
            else:
                for k in range(3): self.box(cx + w / 2 + 0.002, fy, cz + off + (k - 1) * 0.04, 0.02, fh, 0.025, 'blue')

    def cornice(self, cx, y0, cz, w, d, mat='lime'):
        self.box(cx, y0, cz, w + 0.18, 0.07, d + 0.18, mat)
        if self.hi:
            for i in range(int(w / 0.07)): self.box(cx - w / 2 + (i + 0.5) * 0.07, y0 - 0.03, cz + d / 2 + 0.09, 0.035, 0.03, 0.03, mat)

    # ---- extra primitives for decor, cottages and kit pieces
    def beam(self, a, b, w, mat, h=None):
        """Square-section beam between two points (x, y, z) in frame space; w x h cross section (h defaults to w)."""
        h = h or w; A, B = Vector(a), Vector(b); d = B - A; L = d.length
        if L < 1e-6: return
        z = d.normalized(); up = Vector((0, 1, 0)) if abs(z.y) < 0.95 else Vector((1, 0, 0)); x = up.cross(z).normalized(); y = z.cross(x).normalized()
        vs = []
        for t in (A, B):
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)): p = t + x * sx * w / 2 + y * sy * h / 2; vs.append(self.v(p.x, p.y, p.z))
        for idx in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)): self.face([vs[i] for i in idx], mat)

    def rock(self, cx, y0, cz, r, mat='rock', seed=0, squash=0.62, sub=None):
        """Weathered boulder: displaced icosphere, flat base. High detail subdivides further and adds fine chips."""
        import bmesh as _bm
        rr = random.Random(seed * 7919 + 13); sub = sub or (4 if self.hi else 2)
        g = _bm.new(); _bm.ops.create_icosphere(g, subdivisions=sub, radius=1.0)
        ph = [rr.random() * 9 for _ in range(6)]
        for v in g.verts:
            n = v.co.normalized(); k = 1 + 0.28 * math.sin(n.x * 3.1 + ph[0]) * math.cos(n.z * 2.7 + ph[1]) + 0.12 * math.sin(n.y * 6.0 + n.x * 5.0 + ph[2])
            if self.hi: k += 0.035 * math.sin(n.x * 17 + ph[3]) * math.sin(n.z * 15 + ph[4]) * math.cos(n.y * 13 + ph[5])
            v.co = n * k
        m = []
        for v in g.verts: m.append(self.v(cx + v.co.x * r, y0 + max(v.co.y * squash, -0.28 * squash) * r + 0.28 * squash * r, cz + v.co.z * r))
        for f in g.faces: self.face([m[v.index] for v in f.verts], mat)
        g.free()

    def cloth(self, p00, p10, p01, p11, mat, sag=0.0, nx=8, nz=2):
        """Draped cloth patch through four corners (x, y, z); sag lowers the middle (parabolic) in y. Double sided by construction."""
        P = [[None] * (nz + 1) for _ in range(nx + 1)]
        for i in range(nx + 1):
            u = i / nx
            for j in range(nz + 1):
                t = j / nz; a = [p00[k] + (p10[k] - p00[k]) * u for k in range(3)]; b = [p01[k] + (p11[k] - p01[k]) * u for k in range(3)]
                q = [a[k] + (b[k] - a[k]) * t for k in range(3)]; q[1] -= sag * 4 * u * (1 - u); P[i][j] = self.v(*q)
        for i in range(nx):
            for j in range(nz):
                self.face([P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]], mat); self.face([P[i][j + 1], P[i + 1][j + 1], P[i + 1][j], P[i][j]], mat)

    def hull(self, cx, y0, cz, L, W, H, mat, mat2=None, n=14):
        """Open boat hull along z: lofted sections with sheer and a pointed bow and stern, plus thwarts and a mast step."""
        secs = []
        for i in range(n + 1):
            t = i / n; z = (t - 0.5) * L; f = math.sin(math.pi * t) ** 0.7; w = W / 2 * f; sheer = H * (1 + 0.35 * (2 * t - 1) ** 2)
            ring = [(-w, sheer), (-w * 0.93, sheer * 0.55), (-w * 0.6, sheer * 0.12), (0.0, 0.0), (w * 0.6, sheer * 0.12), (w * 0.93, sheer * 0.55), (w, sheer)]
            secs.append([self.v(cx + x, y0 + y, cz + z) for x, y in ring])
        for i in range(n):
            for j in range(6): self.face([secs[i][j], secs[i][j + 1], secs[i + 1][j + 1], secs[i + 1][j]], mat)
        for i in range(1, n):  # inner liner: thickness by a second inset hull
            pass
        for j in range(n // 2 - 3, n // 2 + 4, 3): self.box(cx, y0 + H * 0.55, cz + (j / n - 0.5) * L, W * 0.84, 0.03, 0.12, mat2 or mat)

    # ---- output
    def finish(self, name):
        bm = self.bm; bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        if not self.hi: self.bm = bm = _solidify_clean(bm)  # split intersecting solids, drop buried and coincident faces
        if not self.hi:  # game mesh: bevel every hard edge so silhouettes and light catch real supporting loops (no razor box corners)
            bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
            hard = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_length() > 0.1 and e.calc_face_angle(0.0) > math.radians(50)]
            if hard: bmesh.ops.bevel(bm, geom=hard, offset=0.012, offset_type='OFFSET', segments=1, affect='EDGES', profile=0.5, clamp_overlap=True)
            bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=2e-4)  # bevel can leave near-coincident verts that triangulate to zero-area slivers
            bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges[:])
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 2e-6], context='FACES')
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')  # no second recalc: merged, hole-ridden islands make it flip interior floors; per-primitive winding was already fixed at the top
        lim = math.radians(SMOOTH_DEG)
        for e in bm.edges:  # smooth only between two curved-surface faces (lathe, arc, cone, figure): a flat wall or roof plane never borrows its neighbour's normals
            if len(e.link_faces) == 2: e.smooth = all(f.smooth for f in e.link_faces) and e.calc_face_angle(0.0) < lim
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        if self.hi:
            for n in NAMES: me.materials.append(_hi_material(n))
        me.transform(Matrix.Rotation(math.pi / 2, 4, 'X')); me.update()
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob


def _hi_material(n):
    """High-poly source material: palette colour modulated by two noise octaves (weathering, lime wash, staining) so the baked colour and roughness maps carry real surface variation."""
    m = bpy.data.materials.new(n + '_hi'); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); n1 = nt.nodes.new('ShaderNodeTexNoise'); n2 = nt.nodes.new('ShaderNodeTexNoise')
    n1.inputs['Scale'].default_value = 2.4; n1.inputs['Detail'].default_value = 6.0; n1.inputs['Roughness'].default_value = 0.62
    n2.inputs['Scale'].default_value = 34.0; n2.inputs['Detail'].default_value = 3.0
    nt.links.new(tc.outputs['Object'], n1.inputs['Vector']); nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
    mix = nt.nodes.new('ShaderNodeMath'); mix.operation = 'ADD'; mix.use_clamp = True
    a = nt.nodes.new('ShaderNodeMath'); a.operation = 'MULTIPLY'; a.inputs[1].default_value = 0.65; bb = nt.nodes.new('ShaderNodeMath'); bb.operation = 'MULTIPLY'; bb.inputs[1].default_value = 0.35
    nt.links.new(n1.outputs['Fac'], a.inputs[0]); nt.links.new(n2.outputs['Fac'], bb.inputs[0]); nt.links.new(a.outputs[0], mix.inputs[0]); nt.links.new(bb.outputs[0], mix.inputs[1])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.28; ramp.color_ramp.elements[0].color = (0.78, 0.78, 0.78, 1); ramp.color_ramp.elements[1].position = 0.72; ramp.color_ramp.elements[1].color = (1.12, 1.1, 1.06, 1)
    vor = nt.nodes.new('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = 12.0 if n.startswith('terra') else 5.0; nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])  # per-stone / per-tile tint
    vsep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(vor.outputs['Color'], vsep.inputs[0])
    vw = nt.nodes.new('ShaderNodeMath'); vw.operation = 'MULTIPLY'; vw.inputs[1].default_value = 0.5 if n.startswith('terra') else 0.14; nt.links.new(vsep.outputs['Red'], vw.inputs[0])
    mix2 = nt.nodes.new('ShaderNodeMath'); mix2.operation = 'ADD'; mix2.use_clamp = True; nt.links.new(mix.outputs[0], mix2.inputs[0]); nt.links.new(vw.outputs[0], mix2.inputs[1])
    nt.links.new(mix2.outputs[0], ramp.inputs['Fac'])
    mc = nt.nodes.new('ShaderNodeMix'); mc.data_type = 'RGBA'; mc.blend_type = 'MULTIPLY'; mc.inputs[0].default_value = 1.0; mc.inputs[6].default_value = lin(PAL[n]); nt.links.new(ramp.outputs['Color'], mc.inputs[7])
    nt.links.new(mc.outputs[2], b.inputs['Base Color'])
    rr = nt.nodes.new('ShaderNodeMath'); rr.operation = 'MULTIPLY_ADD'; rr.use_clamp = True; rr.inputs[1].default_value = -0.35; rr.inputs[2].default_value = ROUGH.get(n, 0.9) + 0.17
    nt.links.new(mix.outputs[0], rr.inputs[0]); nt.links.new(rr.outputs[0], b.inputs['Roughness'])
    b.inputs['Metallic'].default_value = 0.0  # the metal map is baked separately (_bake_metal); a metallic high-poly made Cycles' DIFFUSE bake return base colour x (1 - metallic), i.e. near black bronze and gold
    return m


def _solidify_clean(bm):
    """Game mesh cleanup: weld doubles, delete faces buried inside another solid (odd ray parity along all 6 axes) and coincident duplicate
    faces, so no interior or z-fighting faces reach the UV2 unwrap or the bake. Intersecting solids are not cut: exact intersection fragments faces into shards that wreck UV2 islands and LOD decimation."""
    from mathutils.bvhtree import BVHTree
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bm.faces.ensure_lookup_table(); bvh = BVHTree.FromBMesh(bm, epsilon=1e-6); dirs = [Vector(d) for d in ((1, 0.013, 0.007), (-1, 0.011, -0.009), (0.008, 1, 0.012), (-0.006, -1, 0.01), (0.01, 0.009, 1), (-0.012, 0.007, -1))]
    def buried(p):
        odd = 0
        for d in dirs:
            n, o = 0, p
            for _ in range(64):
                hit = bvh.ray_cast(o, d)
                if hit[0] is None: break
                n += 1; o = hit[0] + d.normalized() * 1e-5
            odd += n % 2
        return odd >= 6
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        # a face is dead only when its centre and every vertex-inset sample are buried: a partly covered face (floor around a hall, pier top under a roof) stays whole
        if buried(c + f.normal * 2e-4) and all(buried(c + (v.co - c) * 0.7 + f.normal * 2e-4) for v in f.verts): dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    seen = {}; dup = []
    for f in bm.faces:
        k = tuple(sorted(v.index for v in f.verts))
        if k in seen: dup += [f, seen[k]] if f.normal.dot(seen[k].normal) < 0 else [f]  # opposite faces = buried contact (drop both); same-facing duplicates keep one
        else: seen[k] = f
    if dup: bmesh.ops.delete(bm, geom=list(set(dup)), context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return bm


def _uv2_overlap(ob, name, grid=256):
    """Fraction of covered 256-grid cells claimed by more than one triangle: the same measure as scripts/assets/check.mjs."""
    me = ob.data; me.calc_loop_triangles(); uv = np.empty(len(me.loops) * 2, dtype=np.float32); me.uv_layers[name].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2) * grid
    cells = np.zeros((grid, grid), bool); hit = over = 0
    for t in me.loop_triangles:
        a, b, c = (uv[l] for l in t.loops); den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-9: continue
        x0, x1 = max(0, int(min(a[0], b[0], c[0]))), min(grid - 1, int(max(a[0], b[0], c[0])) + 1); y0, y1 = max(0, int(min(a[1], b[1], c[1]))), min(grid - 1, int(max(a[1], b[1], c[1])) + 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den; w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den; w2 = 1 - w0 - w1
        m = (w0 >= 0.02) & (w1 >= 0.02) & (w2 >= 0.02); sub = cells[y0:y1 + 1, x0:x1 + 1]; hit += int(m.sum()); over += int((m & sub).sum()); sub |= m
    return over / hit if hit else 0.0


def tri_count(ob):
    me = ob.data; me.calc_loop_triangles(); return len(me.loop_triangles)


def _img(name, size, color=(0.5, 0.5, 0.5, 1), nc=False):
    im = bpy.data.images.new(name, size, size, alpha=False); im.generated_color = color
    if nc: im.colorspace_settings.name = 'Non-Color'
    return im


def _gpu():
    try:
        p = bpy.context.preferences.addons['cycles'].preferences; p.compute_device_type = 'METAL'; p.refresh_devices()
        for d in p.devices: d.use = d.type in ('METAL', 'GPU')
        bpy.context.scene.cycles.device = 'GPU'
    except Exception as e:  # CPU fallback
        print('GPU unavailable, CPU bake:', e)


def _bake(lo, hi, kind, img, node, **kw):
    nt = lo.data.materials[0].node_tree; nt.nodes.active = node
    for n in nt.nodes: n.select = n.name == node.name
    bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=kw.pop('ext', 0.04), max_ray_distance=kw.pop('ray', 0.1), margin=10, margin_type='EXTEND', use_clear=False, target='IMAGE_TEXTURES', **kw)


def _set_uv(lo, name):
    lo.data.uv_layers.active = lo.data.uv_layers[name]


def _bake_metal(lo, hi, img, node):
    """Metallic is not a Cycles bake pass: temporarily swap the high-poly materials for emission of their metallic value and bake EMIT."""
    saved = [m for m in hi.data.materials]; tmp = []
    for n in NAMES:
        m = bpy.data.materials.new(n + '_met'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); out = nt.nodes.new('ShaderNodeOutputMaterial'); e = nt.nodes.new('ShaderNodeEmission')
        v = METAL.get(n, 0.0); e.inputs['Color'].default_value = (v, v, v, 1); nt.links.new(e.outputs[0], out.inputs[0]); tmp.append(m)
    hi.data.materials.clear()
    for m in tmp: hi.data.materials.append(m)
    _bake(lo, hi, 'EMIT', img, node)
    hi.data.materials.clear()
    for m in saved: hi.data.materials.append(m)


def bake_and_export(asset_id, build, size=1024, lods=(1.0, 0.45, 0.16), ao_strength=0.55, lm_size=None, report=None):
    """build(K) fills a K; called once with hi=True and once with hi=False. Writes <OUT>/<asset_id>.glb with colour(+cavity AO), tangent normal,
    roughness/metallic (G/B of one ORM image), and a second UV set 'Lightmap' carrying a sky + ground bounce Cycles lightmap as occlusionTexture.
    The lightmap is lit by a uniform sky only (no sun), so one bake is valid for every yaw the instanced asset is placed at."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 64; sc.cycles.use_denoising = False
    if not os.environ.get('SITE_ASSET_CPU'): _gpu()
    kh = K(True); build(kh); hi = kh.finish(asset_id + '_hi')
    kl = K(False); build(kl); lo = kl.finish(asset_id + '_LOD0')
    tris_hi, tris_lo = tri_count(hi), tri_count(lo)
    bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.02, area_weight=0.6); bpy.ops.uv.average_islands_scale(); bpy.ops.uv.pack_islands(margin=max(0.008, 6.0 / size))
    bpy.ops.object.mode_set(mode='OBJECT')
    # second UV set for the lightmap: non overlapping, own island packing (separate from the texel-density-matched UV0)
    lo.data.uv_layers.new(name='Lightmap'); _set_uv(lo, 'Lightmap')
    for ang in (45, 30, 20, 12, 8):  # widest island angle whose packed UV2 passes the gate (check.mjs: overlap < 1% of covered cells), else finer islands
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=math.radians(ang), island_margin=0.03, area_weight=0.8); bpy.ops.uv.pack_islands(margin=0.03, rotate=False); bpy.ops.object.mode_set(mode='OBJECT')
        ov = _uv2_overlap(lo, 'Lightmap'); print('UV2', asset_id, ang, 'overlap', round(ov, 4))
        if ov < 0.004: break
    _set_uv(lo, lo.data.uv_layers[0].name)
    mat = bpy.data.materials.new(asset_id); mat.use_nodes = True; mat.use_backface_culling = True; nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    ic, inn, iorm = _img(asset_id + '_c', size, (0.8, 0.78, 0.72, 1)), _img(asset_id + '_n', size, (0.5, 0.5, 1.0, 1), True), _img(asset_id + '_orm', size, (1, 0.9, 0, 1), True)
    iao, irg, imt = _img(asset_id + '_ao', size, (1, 1, 1, 1), True), _img(asset_id + '_r', size, (0.9, 0.9, 0.9, 1), True), _img(asset_id + '_m', size, (0, 0, 0, 1), True)
    nc, nn, na, nrg, nmt = (nt.nodes.new('ShaderNodeTexImage') for _ in range(5))
    nc.image, nn.image, na.image, nrg.image, nmt.image = ic, inn, iao, irg, imt
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(nn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal']); nt.links.new(nc.outputs['Color'], bsdf.inputs['Base Color'])
    lo.data.materials.clear(); lo.data.materials.append(mat)
    for p in lo.data.polygons: p.material_index = 0
    _bake(lo, hi, 'DIFFUSE', ic, nc, pass_filter={'COLOR'})
    _bake(lo, hi, 'NORMAL', inn, nn, normal_space='TANGENT')
    _bake(lo, hi, 'AO', iao, na)
    _bake(lo, hi, 'ROUGHNESS', irg, nrg)
    _bake_metal(lo, hi, imt, nmt)
    a = np.empty(size * size * 4, dtype=np.float32); b = np.empty_like(a); ic.pixels.foreach_get(a); iao.pixels.foreach_get(b)
    a = a.reshape(-1, 4); b = b.reshape(-1, 4); ao = b[:, :1]; a[:, :3] *= (1.0 - ao_strength) + ao_strength * ao; ic.pixels.foreach_set(a.ravel()); ic.update()
    r = np.empty_like(a.ravel()); g = np.empty_like(r); irg.pixels.foreach_get(r); imt.pixels.foreach_get(g)
    r = r.reshape(-1, 4); g = g.reshape(-1, 4); orm = np.ones_like(r); orm[:, 1] = r[:, 0]; orm[:, 2] = g[:, 0]; iorm.pixels.foreach_set(orm.ravel()); iorm.update()
    # ORM wiring: G -> roughness, B -> metallic (glTF packs them into one metallicRoughness texture)
    no = nt.nodes.new('ShaderNodeTexImage'); no.image = iorm; sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(no.outputs['Color'], sep.inputs[0]); nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    nt.nodes.remove(na); nt.nodes.remove(nrg); nt.nodes.remove(nmt)
    bpy.data.objects.remove(hi, do_unlink=True)  # the lightmap lights the game mesh alone: with the high poly still in the scene its protruding blocks shadowed the game faces (black brick-patterned checker in the occlusion map)
    # ---- sky + bounce lightmap on UV 'Lightmap'
    lmpx = lm_size or (1024 if size >= 2048 else 512); lm = _img(asset_id + '_lm', lmpx, (1, 1, 1, 1), True)
    bb = [lo.matrix_world @ Vector(c) for c in lo.bound_box]; zmin = min(v.z for v in bb); ext = max(max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb)) + 6
    bpy.ops.mesh.primitive_plane_add(size=ext * 2, location=(0, 0, zmin - 0.001)); ground = bpy.context.active_object
    gm = bpy.data.materials.new('lmground'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.42, 0.36, 0.28, 1); gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0; ground.data.materials.append(gm)
    w = bpy.data.worlds.new('sky'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0; sc.world = w
    sc.cycles.samples = 160; sc.cycles.use_denoising = True; sc.cycles.max_bounces = 3
    # lit with a plain white diffuse material: the real one samples the colour / normal / ORM maps through the active UV layer, which is 'Lightmap' during this bake,
    # so its normals and metallic came out as garbage and the occlusion map baked black, brick-patterned blocks (the dark checker on walls and undersides)
    lmm = bpy.data.materials.new('lmbake'); lmm.use_nodes = True; lb = lmm.node_tree.nodes['Principled BSDF']; lb.inputs['Base Color'].default_value = (1, 1, 1, 1); lb.inputs['Roughness'].default_value = 1.0; lb.inputs['Metallic'].default_value = 0.0
    tn = lmm.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = lm; lmm.node_tree.nodes.active = tn; tn.select = True
    lo.data.materials.clear(); lo.data.materials.append(lmm); _set_uv(lo, 'Lightmap')
    bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_selected_to_active=False, margin=8, margin_type='EXTEND', use_clear=True, target='IMAGE_TEXTURES')
    lo.data.materials.clear(); lo.data.materials.append(mat); bpy.data.objects.remove(ground, do_unlink=True); _set_uv(lo, lo.data.uv_layers[0].name)
    l = np.empty(lmpx * lmpx * 4, dtype=np.float32); lm.pixels.foreach_get(l); l = l.reshape(-1, 4); lum = np.clip(l[:, 0] * 0.2126 + l[:, 1] * 0.7152 + l[:, 2] * 0.0722, 0.0, 1.0); l[:, 0] = l[:, 1] = l[:, 2] = lum; l[:, 3] = 1; lm.pixels.foreach_set(l.ravel()); lm.update(); lm.pack()
    g = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    if 'Occlusion' not in [i.name for i in g.interface.items_tree]: g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = g; sp = nt.nodes.new('ShaderNodeSeparateColor'); tl = nt.nodes.new('ShaderNodeTexImage'); tl.image = lm; um = nt.nodes.new('ShaderNodeUVMap'); um.uv_map = 'Lightmap'
    nt.links.new(um.outputs[0], tl.inputs[0]); nt.links.new(tl.outputs[0], sp.inputs[0]); nt.links.new(sp.outputs[0], gn.inputs['Occlusion'])
    dbg = os.environ.get('SITE_ASSET_DEBUG')
    if dbg:
        os.makedirs(dbg, exist_ok=True)
        for im in (ic, inn, iorm, lm): im.filepath_raw = os.path.join(dbg, im.name + '.png'); im.file_format = 'PNG'; im.save()
    objs = [lo]
    for i, ratio in enumerate(lods[1:], 1):
        c = lo.copy(); c.data = lo.data.copy(); c.name = f'{asset_id}_LOD{i}'; bpy.context.scene.collection.objects.link(c)
        m = c.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True; objs.append(c)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    glb = os.path.join(OUT, asset_id + '.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_apply=True, export_image_format='WEBP', export_yup=True, export_cameras=False, export_lights=False)
    st = dict(id=asset_id, tris_hi=tris_hi, tris_lod0=tris_lo, tex=size, lm=lmpx, bytes=os.path.getsize(glb))
    dg = bpy.context.evaluated_depsgraph_get(); st['tris_lods'] = []
    for o in objs:
        e = o.evaluated_get(dg); me = e.to_mesh(); me.calc_loop_triangles(); st['tris_lods'].append(len(me.loop_triangles)); e.to_mesh_clear()
    print('ASSET', json.dumps(st)); return st
