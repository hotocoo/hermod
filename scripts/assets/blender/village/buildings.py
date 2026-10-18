"""Village section buildings. Each builder fills a V (hi = high-poly source, lo = game mesh) in world axes (+z front, origin = footprint centre). Dimensions follow the former
procedural builders (src/scene/world/*) so doors, anchors, interiors and contact decals still line up. Levels: module(1) base, module(2) wing + banners, module(3) tower + lights + garden."""
import math
from vlib import V, TAU
from mathutils import Matrix
from parts import dress

P = math.pi


def ring_blocks(v, r, y0, h, n, depth, mat, rows=1, jitter=0.0):
    """Curved masonry: n blocks per row around radius r (outer face), each tangent-aligned."""
    ch = h / rows
    for row in range(rows):
        off = 0.5 if row % 2 else 0.0
        for i in range(n):
            a = TAU * (i + off) / n; yaw = -a - P / 2; w = TAU * r / n - 0.014
            v.box((r - depth / 2) * math.cos(a), y0 + row * ch, (r - depth / 2) * math.sin(a), w, ch - 0.012, depth, mat, yaw=yaw)


def bench(v, x, z, ang):
    with v.frame(x, z, ang):
        v.box(0, 0.26, 0, 0.62, 0.05, 0.24, 'timber')
        if v.hi:
            for k in range(3): v.box(0, 0.309, -0.08 + k * 0.08, 0.62, 0.002, 0.004, 'beam')
        for sx in (-1, 1):
            v.box(sx * 0.25, 0.0, 0, 0.05, 0.26, 0.2, 'beam'); v.box(sx * 0.25, 0.1, 0, 0.05, 0.04, 0.2 + 0.08, 'beam')
        v.box(0, 0.12, 0, 0.5, 0.03, 0.04, 'beam')


def hearth(v):
    y0 = 0.0; posts = 10
    with v.module(1):
        # stone drum: two curved courses, capstone ring, radial deck planks
        ring_blocks(v, 2.6, 0, 0.1, 44, 0.3, 'stone', 1); ring_blocks(v, 2.5, 0.1, 0.1, 42, 0.28, 'stone', 1)
        v.lathe(0, 0.19, 0, [(0.0, 0.0), (2.5, 0.0), (2.52, 0.015), (2.5, 0.03), (0.0, 0.03)], 90 if v.hi else 40, 'stone')
        np_ = 36 if v.hi else 18
        for i in range(np_):
            a = TAU * i / np_; a1 = TAU * (i + 1) / np_
            for (r0, r1) in ((0.72, 1.5), (1.5, 2.26)):
                p = lambda rr, aa: (math.cos(aa) * rr, math.sin(aa) * rr)
                q = [v.v(p(r0, a)[0], 0.26, p(r0, a)[1]), v.v(p(r1, a)[0], 0.26, p(r1, a)[1]), v.v(p(r1, a1 - 0.006)[0], 0.26, p(r1, a1 - 0.006)[1]), v.v(p(r0, a1 - 0.006)[0], 0.26, p(r0, a1 - 0.006)[1])]
                v._jit('timber'); v.face(q[::-1], 'timber')
        v.lathe(0, 0.22, 0, [(0.0, 0.0), (2.26, 0.0), (2.26, 0.04), (0.0, 0.04)], 72 if v.hi else 30, 'beam')
        # fire pit: stone ring, embers, logs
        n = 18 if v.hi else 10
        for i in range(n):
            a = TAU * i / n; v.lathe(math.cos(a) * 0.58, 0.26, math.sin(a) * 0.58, [(0.0, 0.0), (0.13, 0.0), (0.15, 0.07), (0.09, 0.14), (0.0, 0.15)], 9 if v.hi else 5, 'rock', ratio=(1.25, 1.0))
        v.lathe(0, 0.26, 0, [(0.0, 0.0), (0.52, 0.0), (0.52, 0.05), (0.0, 0.05)], 36 if v.hi else 14, 'char')
        for i in range(5):
            a = TAU * i / 5; v.beam((math.cos(a) * 0.38, 0.33, math.sin(a) * 0.38), (math.cos(a) * 0.05, 0.5, math.sin(a) * 0.05), 0.11, 0.11, 'timber' if i % 2 else 'beam')
        v.lathe(0, 0.3, 0, [(0.0, 0.0), (0.2, 0.0), (0.16, 0.04), (0.0, 0.05)], 16, 'ember')
        # posts: turned, with stone footings, brackets, capitals
        for i in range(posts):
            a = TAU * (i + 0.5) / posts; x, z = math.cos(a) * 2.08, math.sin(a) * 2.08
            v.box(x, 0.26, z, 0.26, 0.14, 0.26, 'stone', yaw=-a - P / 2)
            v.lathe(x, 0.4, z, [(0.0, 0.0), (0.1, 0.0), (0.085, 0.06), (0.075, 0.12), (0.07, 1.9), (0.085, 1.98), (0.1, 2.05), (0.0, 2.05)], 16 if v.hi else 8, 'beam')
            v.lathe(x, 2.42, z, [(0.0, 0.0), (0.11, 0.0), (0.12, 0.03), (0.1, 0.1), (0.0, 0.1)], 16 if v.hi else 8, 'timber')
            for k in range(7 if v.hi else 4):  # curved knee brace toward the ring beam
                t = k / (6 if v.hi else 3); rr = 2.08 - 0.28 * t
                p0 = (math.cos(a) * (2.08 - 0.02), 2.12 - t * 0.0, math.sin(a) * 2.06); 
            v.beam((math.cos(a) * 2.06, 2.05, math.sin(a) * 2.06), (math.cos(a) * 1.7, 2.5, math.sin(a) * 1.7), 0.06, 0.06, 'beam')
            # lattice rails between posts at 0.9 m
            b = TAU * (i + 1.5) / posts; x2, z2 = math.cos(b) * 2.08, math.sin(b) * 2.08
            v.beam((x, 0.82, z), (x2, 0.82, z2), 0.05, 0.05, 'beam'); v.beam((x, 1.04, z), (x2, 1.04, z2), 0.04, 0.04, 'beam')
            if v.hi:
                for k in range(5):
                    tt = (k + 0.5) / 5; v.lathe(x + (x2 - x) * tt, 0.84, z + (z2 - z) * tt, [(0.0, 0.0), (0.02, 0.02), (0.014, 0.1), (0.02, 0.18), (0.0, 0.2)], 8, 'beam')
        # ring beam (polygonal segments) and roof underside
        for i in range(posts):
            a = TAU * (i + 0.5) / posts; b = TAU * (i + 1.5) / posts
            v.beam((math.cos(a) * 2.08, 2.56, math.sin(a) * 2.08), (math.cos(b) * 2.08, 2.56, math.sin(b) * 2.08), 0.16, 0.14, 'timber')
        # benches around the fire (seat positions kept for the town's seated figures)
        for i in range(8):
            a = TAU * i / 8; bench(v, math.cos(a) * 1.4, math.sin(a) * 1.4, -a + P / 2)
        # conical roof of tile bands, rotated half a facet like the original
        v.cone_roof(0, 2.58, 0, [(2.6, 0.0), (2.45, 0.08), (1.9, 0.55), (1.2, 1.1), (0.62, 1.48)], posts if not v.hi else posts * 4, 'roofSlate')
        for i in range(posts):  # hip ribs and eave tails
            a = TAU * i / posts
            v.beam((math.cos(a) * 2.62, 2.6, math.sin(a) * 2.62), (math.cos(a) * 0.64, 4.12, math.sin(a) * 0.64), 0.07, 0.07, 'trim')
            v.box(math.cos(a) * 2.55, 2.5, math.sin(a) * 2.55, 0.1, 0.1, 0.34, 'beam', yaw=-a)
        v.lathe(0, 2.56, 0, [(2.55, 0.0), (2.0, 0.01), (0.6, 1.5)], 40 if v.hi else 20, 'timber')
        # roof lantern and finial
        v.lathe(0, 4.06, 0, [(0.0, 0.0), (0.64, 0.0), (0.64, 0.05), (0.0, 0.06)], 24 if v.hi else 10, 'trim')
        for i in range(posts):
            a = TAU * i / posts; v.box(math.cos(a) * 0.56, 4.1, math.sin(a) * 0.56, 0.05, 0.42, 0.05, 'trim', yaw=-a)
        v.lathe(0, 4.14, 0, [(0.0, 0.0), (0.5, 0.0), (0.5, 0.36), (0.0, 0.36)], 24 if v.hi else 10, 'lampg')
        v.cone_roof(0, 4.5, 0, [(0.72, 0.0), (0.55, 0.1), (0.25, 0.4), (0.06, 0.6)], posts * 2 if v.hi else posts, 'roofSlate')
        v.lathe(0, 5.08, 0, [(0.0, 0.0), (0.03, 0.0), (0.016, 0.4), (0.0, 0.42)], 8, 'gold'); v.lathe(0, 5.3, 0, [(0.0, 0.0), (0.07, 0.04), (0.0, 0.1)], 12, 'gold')
        v.empty('door', 0.0, 0.3, 2.7); v.empty('smoke', 0.0, 4.9, 0.0); v.empty('fire', 0.0, 0.32, 0.0)
    with v.module(2):  # six banners around the posts
        for i in range(6):
            a = TAU * i / 6 + 0.3; v.banner(math.cos(a) * 2.75, 2.4, math.sin(a) * 2.75, -a + P / 2, i)
    with v.module(3):  # string lights on the posts and a low flower hedge ring with four path gaps
        for i in range(8):
            a0 = TAU * i / 8; a1 = TAU * (i + 1) / 8; n = 8; pts = []
            for k in range(n + 1):
                t = k / n; a = a0 + (a1 - a0) * t; pts.append((math.cos(a) * 2.6, 2.1 - 0.2 * 4 * t * (1 - t), math.sin(a) * 2.6))
            for k in range(n):
                v.beam(pts[k], pts[k + 1], 0.01, 0.01, 'iron')
                v.lathe(pts[k][0], pts[k][1] - 0.07, pts[k][2], [(0.0, 0.0), (0.025, 0.02), (0.03, 0.05), (0.0, 0.075)], 8 if v.hi else 5, 'lampg')
        G = 3.3; seg = 44
        for i in range(seg):
            a = TAU * (i + 0.5) / seg
            if min(abs(((a - q + P) % TAU) - P) for q in (0, P / 2, P, 3 * P / 2)) < 0.17: continue
            v.hedge(math.cos(a) * G, math.sin(a) * G, 0.4, 0.34, 0.3, yaw=-a - P / 2); v.flowers(math.cos(a) * (G - 0.28), math.sin(a) * (G - 0.28), 0.3, 0.2, 2)
    v.meta.update(anchorY=4.9, door=dict(x=0.0, y=0.3, z=2.7, h=1.0), dims=[5.2, 5.2, 5.3], contact=[3.3, 3.3], level3=dict(anchorBoost=0.2, gardenGapsAtDeg=[0, 90, 180, 270]))




def moulding(v, w, d, y, mat='trim', prof=((0, 0.06, 0.02), (0.06, 0.05, 0.08), (0.11, 0.07, 0.14))):
    for (yy, hh, out) in prof: v.box(0, y + yy, 0, w + out * 2, hh, d + out * 2, mat)


def chat(v):
    """The Commons: stone ground floor, timber-framed plaster upper floor, slate gable, clock tower with spire."""
    with v.module(1):
        v.plinth(0, 0, 4.3, 3.1, 0.35, 'stone', steps=2)
        v.masonry(0, 0, 4.0, 2.8, 0.35, 1.3, 'stone', course=0.2, block=0.55)
        moulding(v, 4.0, 2.8, 1.62)
        v.plaster(0, 0, 3.96, 2.76, 1.72, 1.16, 'plaster')
        for sz in (1, -1):
            for x in (-1.96, -1.0, 0, 1.0, 1.96): v.box(x, 1.72, sz * 1.415, 0.1, 1.16, 0.07, 'beam')
            for y in (1.73, 2.79): v.box(0, y, sz * 1.415, 4.0, 0.09, 0.07, 'beam')
        for sx in (1, -1):
            for z in (-1.36, 0, 1.36): v.box(sx * 1.995, 1.72, z, 0.07, 1.16, 0.1, 'beam')
            for y in (1.73, 2.79): v.box(sx * 1.995, y, 0, 0.07, 0.09, 2.8, 'beam')
            for (z0, z1) in ((-1.36, 0.0), (1.36, 0.0)): v.beam((sx * 1.995, 1.83, z0 + (0.06 if z1 > z0 else -0.06)), (sx * 1.995, 2.78, z1 - (0.06 if z1 > z0 else -0.06)), 0.06, 0.06, 'beam')
        v.gable_roof(0, 0, 4.0, 2.8, 2.88, 0.7, 'roofSlate', ov=0.3, ove=0.12, wall='plaster')
        v.door(0, 0.35, 1.4, 0.6, 0.82, 0.0, True, 3, name='door')
        for x in (-1.65, -1.05, 1.05, 1.65):
            v.window(x, 1.0, 1.402, 0.32, 0.52, 0.0, arch=True); v.window(x, 1.0, -1.402, 0.32, 0.52, P, arch=True)
        for z in (-0.75, 0.75): v.window(2.002, 1.0, z, 0.32, 0.52, P / 2, arch=True); v.window(-2.002, 1.0, z, 0.32, 0.52, -P / 2, arch=True)
        for x in (-1.5, -0.5, 0.5, 1.5): v.window(x, 2.3, 1.385, 0.36, 0.5, 0.0, rows=2); v.window(x, 2.3, -1.385, 0.36, 0.5, P, rows=2)
        # clock tower on the ridge
        with v.frame(0, -0.55):
            v.plaster(0, 0, 0.9, 0.9, 3.45, 1.1, 'plaster')
            for sx in (-1, 1):
                for sz in (-1, 1): v.box(sx * 0.45, 3.45, sz * 0.45, 0.08, 1.1, 0.08, 'beam')
            for (x, z, ry) in ((0, 0.455, 0), (0, -0.455, P), (0.455, 0, P / 2), (-0.455, 0, -P / 2)): v.window(x, 4.0, z, 0.26, 0.42, ry, arch=True, rows=1)
            v.plaster(0, 0, 1.0, 1.0, 4.55, 0.72, 'plaster')
            v.disc(0, 4.92, 0.502, 0.3, 'paper'); v.ringz(0, 4.92, 0.502, 0.3, 0.335, 'gold', thick=0.03)
            for k in range(60 if v.hi else 12):
                a = TAU * k / (60 if v.hi else 12); big = (k % 5 == 0) or not v.hi
                v.box(math.sin(a) * 0.265, 4.92 + math.cos(a) * 0.265 - 0.02, 0.515, 0.012 if not big else 0.02, 0.04 if big else 0.025, 0.006, 'ink')
            for k in range(4):  # roman numerals as blocks
                a = TAU * k / 4; v.box(math.sin(a) * 0.2 - 0.02, 4.92 + math.cos(a) * 0.2 - 0.03, 0.516, 0.05, 0.06, 0.005, 'ink')
            with v.part('clockH', origin=v.w(0, 4.92, 0.518)): v.box(-0.009, 4.92, 0.518, 0.018, 0.16, 0.008, 'ink')
            with v.part('clockM', origin=v.w(0, 4.92, 0.523)): v.box(-0.006, 4.92, 0.523, 0.012, 0.24, 0.008, 'ink')
            moulding(v, 1.0, 1.0, 5.27)
            v.cone_roof(0, 5.43, 0, [(0.78, 0.0), (0.68, 0.12), (0.45, 0.55), (0.2, 1.05), (0.05, 1.35)], 4 if not v.hi else 8, 'roofSlate')
            v.lathe(0, 6.83, 0, [(0.0, 0.0), (0.015, 0.0), (0.015, 0.5), (0.0, 0.52)], 8, 'gold'); v.box(0.1, 7.06, 0, 0.28, 0.12, 0.01, 'gold')
        v.empty('smoke', *v.chimney(1.4, 3.25, 0.6, 1.1, 'brick'))
        v.empty('door', 0.0, 0.35, 1.52)
    dress(v, 'chat')
    v.meta.update(anchorY=5.6, door=dict(x=0.0, y=0.35, z=1.52, h=0.82), dims=[4.3, 3.1, 7.2], contact=[2.9, 2.3], level3=dict(anchorBoost=0.5))


def feed(v):
    """The Gallery: small classical temple, ionic columns all round, gilded tympanum and acroteria, bronze urns."""
    with v.module(1):
        for i in range(3): v.masonry(0, 0, 4.6 - i * 0.28, 3.4 - i * 0.28, i * 0.16, 0.16, 'stone', course=0.16, block=0.7, quoin=False)
        v.masonry(0, -0.25, 2.8, 1.7, 0.485, 1.75, 'stone', course=0.22, block=0.6)
        v.door(0, 0.48, 0.6, 0.7, 1.1, 0.0, True, 0, name='door')
        for x in (-1.0, 1.0): v.window(x, 1.35, 0.602, 0.32, 0.7, 0.0, arch=True, rows=3)
        for i in range(6):
            x = -1.75 + i * 0.7; v.column(x, 1.25, 0.48, 1.86, 0.125, 0.105, 'ionic'); v.column(x, -1.25, 0.48, 1.86, 0.125, 0.105, 'ionic')
        for z in (-0.42, 0.42):
            for sx in (-1, 1): v.column(sx * 1.75, z, 0.48, 1.86, 0.125, 0.105, 'ionic')
        v.box(0, 2.34, 0, 4.0, 0.12, 2.9, 'trim'); v.box(0, 2.46, 0, 3.9, 0.22, 2.8, 'stone')
        moulding(v, 3.9, 2.8, 2.68, 'trim', ((0, 0.05, 0.03), (0.05, 0.05, 0.07), (0.1, 0.06, 0.12)))
        for i in range(18): v.box(-1.9 + i * 0.224 + 0.035, 2.59, 1.46, 0.07, 0.06, 0.12, 'trim')
        rise = v.gable_roof(0, 0, 3.9, 2.8, 2.86, 0.36, 'roofTile', ov=0.12, ove=0.1, wall='stone')
        v.disc(0, 2.86 + rise * 0.38, 1.395, 0.28, 'gold', thick=0.02); v.ringz(0, 2.86 + rise * 0.38, 1.395, 0.28, 0.32, 'bronze', thick=0.035)
        for k in (-1, 0, 1): v.lathe(k * 1.96, (2.86 + rise + 0.02) if k == 0 else 2.92, 1.42, [(0.0, 0.0), (0.08, 0.0), (0.06, 0.1), (0.02, 0.2), (0.0, 0.22)], 24 if v.hi else 10, 'gold')
        for sx in (-1, 1): v.lathe(sx * 2.05, 0.48, 1.6, [(0.0, 0.0), (0.12, 0.02), (0.08, 0.1), (0.16, 0.26), (0.18, 0.36), (0.12, 0.42), (0.0, 0.42)], 32 if v.hi else 14, 'bronze')
        v.empty('smoke', 1.2, 3.1, -0.3); v.empty('door', 0.0, 0.48, 0.72)
    dress(v, 'feed', 'roofTile')
    v.meta.update(anchorY=4.0, door=dict(x=0.0, y=0.48, z=0.72, h=1.1), dims=[4.6, 3.4, 4.0], contact=[3.1, 2.5], level3=dict(anchorBoost=0.5))


def board(v):
    """The Workshop: brick hall under a sawtooth glazed roof, sliding workshop door, crates and barrel, chimney."""
    with v.module(1):
        v.plinth(0, 0, 5.2, 3.0, 0.24, 'stone')
        v.masonry(0, 0, 4.8, 2.6, 0.24, 1.6, 'brick', course=0.075, block=0.2)
        v.box(0, 1.84, 0, 4.96, 0.07, 2.76, 'stone')
        for i in range(4):
            x0 = -2.4 + i * 1.2; y0 = 1.91; hh = 0.68
            R = Matrix.Rotation(math.atan2(hh, 1.18), 3, 'Z'); L = math.hypot(1.18, hh)
            v.box(x0 + 0.59, y0 + hh / 2 - 0.05, 0, L, 0.08, 2.9, 'roofSlate', rot=R)
            if v.hi:
                for r in range(int(L / 0.07)):
                    u = 0.04 + r * 0.07; ang = math.atan2(hh, 1.18)
                    for k in range(int(2.8 / 0.09)): v.box(x0 + u * math.cos(ang), y0 + u * math.sin(ang) + 0.005, -1.4 + k * 0.09 + (0.045 if r % 2 else 0), 0.09, 0.014, 0.08, 'roofSlate', rot=R)
            else:
                for r in range(4): v.box(x0 + (0.2 + r * 0.28) * 0.87, y0 + (0.2 + r * 0.28) * 0.5, 0, 0.3, 0.012, 2.9, 'roofSlate', rot=R)
            v.box(x0 + 1.17, y0, 0, 0.05, hh, 2.62, 'win')  # clerestory glass
            for m in range(6): v.box(x0 + 1.19, y0, -1.2 + m * 0.48, 0.05, hh + 0.02, 0.04, 'iron')
            v.box(x0 + 1.19, y0 + hh - 0.02, 0, 0.07, 0.05, 2.7, 'iron'); v.box(x0 + 1.19, y0, 0, 0.07, 0.04, 2.7, 'iron')
            for sz in (-1, 1): v.prism_x(x0 + 0.59, y0 - 0.02, sz * 1.31, 1.18, 0.08, hh * 0.98, 'brick')
        with v.part('slide', origin=v.w(-1.0, 0.24, 1.32)):
            v.box(-1.0, 0.24, 1.34, 1.5, 1.3, 0.08, 'timber')
            for k in range(2): v.box(-1.0, 0.24 + 0.3 + k * 0.6, 1.4, 1.5, 0.08, 0.04, 'beam')
            v.beam((-1.7, 0.3, 1.41), (-0.3, 1.5, 1.41), 0.07, 0.04, 'beam'); v.box(-1.0, 1.54, 1.38, 1.8, 0.06, 0.08, 'iron')
            v.lathe(-0.45, 0.8, 1.45, [(0.0, 0.0), (0.03, 0.0), (0.02, 0.03), (0.0, 0.035)], 10 if v.hi else 5, 'iron')
        v.box(-1.0, 0.24, 1.296, 1.46, 1.26, 0.02, 'signD')
        for x in (0.55, 1.35): v.window(x, 1.1, 1.302, 0.5, 0.75, 0.0, rows=3, arch=True)
        for x in (-1.6, -0.5, 0.6, 1.7): v.window(x, 1.1, -1.302, 0.5, 0.75, P, rows=3, arch=True)
        for (x, z, s, r, y) in ((2.05, 1.7, 0.5, 0.2, 0.24), (2.6, 1.55, 0.42, -0.3, 0.24), (2.25, 1.65, 0.36, 0.5, 0.74)): v.crate(x, z, s, r, y)
        v.barrel(-2.55, 1.6, 0.24)
        v.empty('smoke', *v.chimney(2.0, 1.84, -0.7, 1.9, 'brick')); v.empty('door', -1.0, 0.24, 1.45)
    dress(v, 'board')
    v.meta.update(anchorY=4.0, door=dict(x=-1.0, y=0.24, z=1.45, h=1.3), dims=[5.2, 3.0, 4.2], contact=[3.4, 2.3], level3=dict(anchorBoost=0.5), slide=dict(axis='x', dist=1.2))


def skein(v):
    """The Loom: round stone tower with crenellated crown and a bronze spool wound with golden thread that turns."""
    with v.module(1):
        v.masonry(0, 0, 2.6, 2.6, 0, 0.32, 'stone', course=0.16, block=0.6, quoin=False)
        n = 28 if v.hi else 14
        ring_blocks(v, 1.08, 0.32, 0.12, 36, 0.12, 'stoneD', 1)
        v.lathe(0, 0.32, 0, [(0.0, 0.0), (1.0, 0.0), (0.98, 3.4), (0.0, 3.4)], 72 if v.hi else 36, 'stone')
        if v.hi:
            for k in range(15):
                m = 30
                for i in range(m):
                    a = TAU * (i + (0.5 if k % 2 else 0)) / m
                    v.box(math.cos(a) * 0.985, 0.44 + k * 0.23, math.sin(a) * 0.985, TAU / m + 0.0, 0.215, 0.05, 'stone', yaw=-a - P / 2)
        v.lathe(0, 3.72, 0, [(0.98, 0.0), (1.08, 0.0), (1.08, 0.12), (0.98, 0.12)], 72 if v.hi else 36, 'stone')
        for y in (1.4, 2.6): v.lathe(0, y, 0, [(1.0, 0.0), (1.06, 0.02), (1.06, 0.07), (1.0, 0.09)], 60 if v.hi else 30, 'trim')
        for i in range(4):
            a = TAU * i / 4; v.window(math.sin(a) * 1.0, 2.05, math.cos(a) * 1.0, 0.28, 0.62, a, arch=True, rows=3)
            a2 = a + 0.78; v.window(math.sin(a2) * 1.0, 3.25, math.cos(a2) * 1.0, 0.22, 0.35, a2, arch=True, rows=1)
        v.door(0, 0.32, 1.0, 0.55, 0.95, 0.0, False, 2, name='door')
        for i in range(24):
            a = TAU * i / 24; v.box(math.cos(a) * 1.04, 3.84, math.sin(a) * 1.04, 0.16, 0.18, 0.14, 'stone', yaw=-a - P / 2)
        v.lathe(0, 3.84, 0, [(0.0, 0.0), (0.96, 0.0), (0.96, 0.03), (0.0, 0.03)], 48 if v.hi else 20, 'stoneD')
        v.lathe(0, 4.1, 0, [(0.18, 0.0), (0.24, 0.0), (0.2, 0.5), (0.2, 0.5)], 32 if v.hi else 14, 'bronze')
        with v.part('spool', origin=v.w(0, 4.95, 0)):
            for (yy, flip) in ((-0.62, 1), (0.52, -1)):
                v.lathe(0, 4.95 + yy, 0, [(0.0, 0.0), (1.05, 0.0), (1.12, 0.04), (1.12, 0.1), (1.0, 0.14), (0.5, 0.16), (0.45, 0.16), (0.0, 0.16)] if flip > 0 else [(0.0, 0.16), (1.05, 0.16), (1.12, 0.12), (1.12, 0.06), (1.0, 0.02), (0.5, 0.0), (0.0, 0.0)], 72 if v.hi else 32, 'bronze')
            v.lathe(0, 4.4, 0, [(0.0, 0.0), (0.44, 0.0), (0.44, 1.1), (0.0, 1.1)], 40 if v.hi else 20, 'timber')
            for i in range(11):
                v.lathe(0, 4.5 + i * 0.09, 0, [(0.44, 0.0), (0.52 + math.sin(i * 0.9) * 0.02, 0.0), (0.54 + math.sin(i * 0.9) * 0.02, 0.05), (0.44, 0.08)], 60 if v.hi else 24, 'gold')
            for i in range(6):
                a = TAU * i / 6; v.box(math.cos(a) * 0.95, 4.33, math.sin(a) * 0.95, 0.06, 1.25, 0.06, 'bronze', yaw=-a)
            v.lathe(0, 5.45, 0, [(0.0, 0.0), (0.04, 0.0), (0.04, 0.6), (0.0, 0.62)], 12, 'gold'); v.lathe(0, 6.1, 0, [(0.0, 0.0), (0.08, 0.04), (0.0, 0.16)], 14, 'gold')
        v.empty('door', 0.0, 0.32, 1.1); v.empty('smoke', 0.0, 4.2, 0.0)
    dress(v, 'skein')
    v.meta.update(anchorY=6.4, door=dict(x=0.0, y=0.32, z=1.1, h=0.95), dims=[2.6, 2.6, 6.4], contact=[2.2, 2.2], level3=dict(anchorBoost=0.4), spool=dict(origin=[0, 4.95, 0], axis='y'))


def desk(v):
    """The Counting House: brick hall, shuttered windows, hanging ledger plaque, stacked ledgers and a lantern at the door."""
    with v.module(1):
        v.plinth(0, 0, 3.7, 3.1, 0.26, 'stone')
        v.masonry(0, 0, 3.4, 2.8, 0.26, 1.9, 'brick', course=0.075, block=0.2)
        v.box(0, 2.16, 0, 3.54, 0.07, 2.94, 'stone')
        v.gable_roof(0, 0, 3.4, 2.8, 2.22, 0.9 * 0 + 0.62, 'roofSlate', ov=0.28, ove=0.1, wall='brick')
        v.door(0, 0.26, 1.4, 0.5, 0.9, 0.0, True, 2, name='door')
        for x in (-1.1, 1.1): v.window(x, 1.35, 1.402, 0.3, 0.52, 0.0, arch=True, rows=2, shutters=True)
        for z in (-0.8, 0.8):
            for s in (-1, 1): v.window(s * 1.702, 1.35, z, 0.28, 0.5, s * P / 2, arch=True, rows=2)
        for x in (-0.9, 0.9): v.window(x, 1.35, -1.402, 0.3, 0.5, P, arch=True, rows=2)
        v.box(1.3, 2.03, 1.46, 0.62, 0.04, 0.04, 'iron'); v.box(1.45, 1.63, 1.46, 0.38, 0.34, 0.03, 'gold')
        v.beam((1.33, 1.83, 1.46), (1.33, 2.03, 1.46), 0.008, 0.008, 'iron')
        if v.hi:
            for k in range(3): v.box(1.45, 1.7 + k * 0.1, 1.48, 0.28, 0.012, 0.01, 'ink')
        for i, (x, y, z, m, ys) in enumerate(((-0.95, 0.26, 1.55, 'ink', 0.12), (-0.95, 0.38, 1.55, 'timber', 0.12), (-0.9, 0.5, 1.55, 'ink', 0.12))): v.box(x, y, z, 0.42 - i * 0.03, 0.12, 0.3, m, yaw=0.4)
        v.lantern(0.0, 1.3, 1.5, 1.3, bracket=(0.0, 1.62))
        v.empty('smoke', *v.chimney(1.0, 2.2, -0.6, 1.5, 'brick')); v.empty('door', 0.0, 0.26, 1.5)
    dress(v, 'desk')
    v.meta.update(anchorY=3.7, door=dict(x=0.0, y=0.26, z=1.5, h=0.9), dims=[3.7, 3.1, 4.0], contact=[2.0, 1.7], level3=dict(anchorBoost=0.4))


PAWN = [(0.0, 0.0), (0.24, 0.0), (0.24, 0.05), (0.14, 0.14), (0.1, 0.34), (0.17, 0.4), (0.07, 0.44), (0.12, 0.52), (0.12, 0.62), (0.0, 0.72)]


def arcade(v):
    """The Games Hall: plastered hall under a slate gable, checkerboard sign (glow part) above the door, bunting and two stone pawns."""
    with v.module(1):
        v.plinth(0, 0, 3.9, 3.2, 0.26, 'stone')
        v.plaster(0, 0, 3.6, 2.9, 0.26, 1.8, 'plaster')
        v.box(0, 2.06, 0, 3.74, 0.06, 3.04, 'trim')
        for x in (-1.7, 1.7): v.box(x, 0.26, 1.43, 0.14, 1.8, 0.14, 'beam')
        for x in (-1.7, 1.7):
            for sz in (-1, 1): pass
        v.gable_roof(0, 0, 3.6, 2.9, 2.12, 0.58 + 0.0, 'roofSlate', ov=0.28, ove=0.1, wall='plaster')
        v.door(0, 0.26, 1.45, 0.52, 0.9, 0.0, True, 2, name='door')
        for x in (-1.2, 1.2): v.window(x, 1.2, 1.452, 0.3, 0.5, 0.0, arch=True, rows=2)
        for z in (-0.8, 0.8):
            for s in (-1, 1): v.window(s * 1.802, 1.3, z, 0.28, 0.5, s * P / 2, arch=True, rows=2)
        for x in (-0.9, 0.9): v.window(x, 1.3, -1.452, 0.3, 0.5, P, arch=True, rows=2)
        v.box(0, 1.64, 1.47, 1.7, 0.62, 0.05, 'timber')
        with v.part('sign'): v.box(0, 1.72, 1.505, 1.54, 0.46, 0.03, 'sign')
        for c in range(8):
            for r in range(2):
                if (c + r) % 2 == 0: v.box(-0.665 + c * 0.19, 1.76 + r * 0.19 - 0.095, 1.525, 0.19, 0.19, 0.012, 'signD')
        pen = ('cloth0', 'cloth1', 'cloth2', 'cloth3'); n = 14
        for i in range(n):
            t = i / (n - 1); x = -1.65 + t * 3.3; y = 2.2 - 0.4 * t * (1 - t)
            v.prism(x, y - 0.2, 1.62, 0.18, 0.012, 0.2, pen[i % 4], ridge='x') if False else v.box(x, y - 0.2, 1.62, 0.17, 0.2, 0.01, pen[i % 4])
        v.beam((-1.65, 2.2, 1.62), (1.65, 2.2, 1.62), 0.01, 0.01, 'iron')
        for s in (-1, 1): v.lathe(s * 0.95, 0.26, 1.75, PAWN, 24 if v.hi else 10, 'pawn')
        v.empty('smoke', *v.chimney(1.1, 2.12, -0.7, 1.4, 'brick')); v.empty('door', 0.0, 0.26, 1.55)
    dress(v, 'arcade')
    v.meta.update(anchorY=3.6, door=dict(x=0.0, y=0.26, z=1.55, h=0.9), dims=[3.9, 3.2, 3.8], contact=[2.1, 1.8], level3=dict(anchorBoost=0.4), signMaterial='arcade_sign')


SIGN_ARMS = (('Commons', 2.2), ('Gallery', -2.4), ('Workshop', 0.5), ('Loom', -0.4))


def signpost(v):
    """The signpost monument (search): stone plinth and obelisk, four lettered timber arms, a gilded orb on a cup with a floating ring (orb and ring are animated parts)."""
    with v.module(1):
        v.masonry(0, 0, 1.1, 1.1, 0, 0.2, 'stone', course=0.2, block=0.55, quoin=False); v.masonry(0, 0, 0.9, 0.9, 0.2, 0.2, 'stone', course=0.2, block=0.45, quoin=False)
        v.lathe(0, 0.4, 0, [(0.3, 0.0), (0.3, 0.1), (0.25, 0.14), (0.21, 0.5), (0.18, 1.8), (0.2, 1.85), (0.24, 1.92), (0.24, 2.0), (0.0, 2.0)], 8, 'stone')
        if v.hi:
            for k in range(11):
                for i in range(4):
                    a = TAU * i / 4 + P / 4; r = 0.226 - 0.0225 * (k / 10.0) * 1.0
                    v.box(math.cos(a) * 0.205, 0.55 + k * 0.125, math.sin(a) * 0.205, 0.17, 0.118, 0.04, 'stone', yaw=-a - P / 2)
        for k, (nm, ang) in enumerate(SIGN_ARMS):
            with v.frame(0, 0, ang):
                y = 1.55 - k * 0.24
                v.box(0.5, y - 0.085, 0, 0.9, 0.17, 0.05, 'timber')
                for sz in (-1, 1):
                    v.box(0.5, y - 0.085, sz * 0.027, 0.9, 0.02, 0.006, 'beam')
                    v.box(0.5, y + 0.065, sz * 0.027, 0.9, 0.02, 0.006, 'beam') if False else None
                    if v.hi:
                        v.box(0.5, y + 0.075, sz * 0.03, 0.88, 0.014, 0.01, 'beam'); v.box(0.5, y - 0.095, sz * 0.03, 0.88, 0.014, 0.01, 'beam')
                        v.text(nm, 0.1 if sz > 0 else 0.9, y - 0.135, sz * 0.03, 0.085, 0.0 if sz > 0 else P, 'paper')
                v.beam((0.99, y, 0.0), (1.12, y - 0.085, 0.0), 0.05, 0.05, 'timber'); v.box(1.0, y - 0.125, 0.0, 0.1, 0.08, 0.05, 'timber')
                for bx in (0.12, 0.85): v.box(bx, y - 0.03, 0.0, 0.03, 0.2, 0.07, 'iron')
        v.lathe(0, 2.42, 0, [(0.0, 0.0), (0.12, 0.02), (0.22, 0.12), (0.26, 0.2), (0.0, 0.2)], 36 if v.hi else 14, 'bronze')
        v.lathe(0, 2.62, 0, [(0.0, 0.0), (0.04, 0.0), (0.03, 0.4), (0.0, 0.4)], 12, 'bronze')
        with v.part('orb', origin=v.w(0, 3.05, 0)): v.sphere(0, 3.05, 0, 0.3, 'gold')
        with v.part('ring', origin=v.w(0, 3.05, 0)): v.torus(0, 3.05, 0, 0.6, 0.018, 'gold')
        v.empty('door', 0.0, 0.0, 0.8)
    v.meta.update(anchorY=3.7, door=dict(x=0.0, y=0.0, z=0.8, h=1.0), dims=[1.1, 1.1, 3.4], orb=dict(origin=[0, 3.05, 0]), ring=dict(origin=[0, 3.05, 0]), arms=[dict(label=n, yaw=a) for n, a in SIGN_ARMS])


BUILDERS = {'hearth': (hearth, 2048), 'chat': (chat, 2048), 'feed': (feed, 2048), 'board': (board, 2048), 'skein': (skein, 2048), 'desk': (desk, 2048), 'arcade': (arcade, 2048), 'signpost': (signpost, 1024)}
