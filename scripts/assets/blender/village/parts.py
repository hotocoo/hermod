"""Shared sub-assemblies for the level modules (wing, tower, garden, string lights) and common building pieces."""
import math
from vlib import V, TAU
P = math.pi
WALL = {'plasterW': 'plaster', 'brickW': 'brick', 'stoneW': 'stone'}
# BUILDING_GROWTH (src/config/scene.ts), copied so the assets match the data the town reads.
GROWTH = {
    'chat': dict(wing=(-3.35, -0.1, 2.3, 2.2, 1.15, 0.62, 'plasterW'), banners=[(-1.4, 3.2, 1.62, 0), (1.4, 3.2, 1.62, 0), (-4.05, 2.15, 1.04, 0)], tower=(2.4, -1.0, 0.55, 3.3), lights=[((-2.0, 2.0, 1.55), (2.0, 2.0, 1.55), 0.22, 12), ((-4.4, 1.65, 1.05), (-2.2, 1.65, 1.05), 0.16, 7)], garden=(3.35, 0.9, 2.0, 2.6)),
    'feed': dict(wing=(3.65, -0.3, 2.4, 2.6, 1.6, 0.4, 'stoneW'), banners=[(-1.2, 2.0, 1.55, 0), (1.2, 2.0, 1.55, 0), (3.6, 2.05, 1.05, 0)], tower=(-2.9, -0.9, 0.5, 3.5), lights=[((-1.9, 2.3, 1.5), (1.9, 2.3, 1.5), 0.2, 12)], garden=(-3.4, 1.0, 1.8, 2.4)),
    'board': dict(wing=(-3.75, 0.0, 2.4, 2.4, 1.3, 0.55, 'brickW'), banners=[(-0.9, 1.95, 1.35, 0), (1.4, 1.95, 1.35, 0), (-3.75, 1.9, 1.25, 0)], tower=(3.05, -0.9, 0.5, 3.0), lights=[((-1.5, 1.9, 1.4), (1.8, 1.9, 1.4), 0.18, 12)], garden=(3.35, 1.3, 1.9, 1.6)),
    'skein': dict(wing=(1.95, 0.1, 1.8, 1.7, 1.4, 0.7, 'stoneW'), banners=[(-0.55, 2.9, 1.08, 0), (0.55, 2.9, 1.08, 0), (1.95, 1.95, 0.98, 0)], tower=(-1.75, -0.5, 0.5, 3.0), lights=[((-1.0, 2.5, 1.0), (1.0, 2.5, 1.0), 0.2, 9)], garden=(-1.4, 1.9, 1.6, 1.4)),
    'desk': dict(wing=(-2.75, 0.0, 2.0, 2.2, 1.3, 0.6, 'brickW'), banners=[(-0.85, 1.95, 1.45, 0), (0.85, 1.95, 1.45, 0), (-2.75, 1.8, 1.15, 0)], tower=(2.2, -0.9, 0.45, 3.1), lights=[((-1.4, 1.95, 1.5), (1.4, 1.95, 1.5), 0.18, 10)], garden=(2.85, 1.2, 1.7, 1.6)),
    'arcade': dict(wing=(-2.85, 0.0, 2.0, 2.2, 1.3, 0.6, 'plasterW'), banners=[(-1.4, 1.85, 1.5, 0), (1.4, 1.85, 1.5, 0), (-2.85, 1.8, 1.15, 0)], tower=(2.3, -0.9, 0.45, 3.1), lights=[((1.95, 1.9, -1.2), (1.95, 1.9, 1.5), 0.18, 8)], garden=(3.0, 1.5, 1.6, 1.6)),
}


def wing(v, spec, roof='roofSlate'):
    x, z, w, d, h, pitch, wall = spec; y0 = 0.24; wm = WALL[wall]; sx = 1 if x >= 0 else -1
    v.plinth(x, z, w + 0.2, d + 0.2, y0, 'stone')
    if wm == 'plaster': v.plaster(x, z, w, d, y0, h, 'plaster')
    else: v.masonry(x, z, w, d, y0, h, wm, course=0.075 if wm == 'brick' else 0.2, block=0.2 if wm == 'brick' else 0.5)
    v.gable_roof(x, z, w, d, y0 + h, pitch, roof, ov=0.22, ove=0.1, wall=wm if wm != 'brick' else 'brick')
    for k in (-1, 1): v.window(x + k * w * 0.24, y0 + h * 0.55, z + d / 2 + 0.002, 0.28, 0.46, 0.0, arch=True, rows=2)
    v.window(x + sx * (w / 2 + 0.002), y0 + h * 0.55, z, 0.3, 0.46, sx * P / 2, arch=True, rows=2)
    v.chimney(x - sx * w * 0.22, y0 + h + 0.1, z - d * 0.18, 0.8, 'brick')


def turret(v, spec, roof='roofSlate'):
    x, z, r, h = spec
    with v.frame(x, z):
        v.lathe(0, 0, 0, [(0.0, 0.0), (r * 1.2, 0.0), (r * 1.28, 0.05), (r * 1.2, 0.3), (0.0, 0.3)], 24 if v.hi else 12, 'stone')
        v.lathe(0, 0.3, 0, [(0.0, 0.0), (r * 1.05, 0.0), (r, 0.1), (r, h - 0.1), (r * 1.02, h), (0.0, h)], 28 if v.hi else 14, 'stone', mod=None)
        if v.hi:
            for k in range(int(h / 0.22)):
                n = 24
                for i in range(n):
                    a = TAU * (i + (0.5 if k % 2 else 0)) / n
                    v.box(math.cos(a) * (r - 0.012), 0.3 + k * 0.22, math.sin(a) * (r - 0.012), TAU * r / n - 0.014, 0.205, 0.05, 'stone', yaw=-a - P / 2)
        for f in (0.34, 0.68): v.lathe(0, 0.3 + h * f, 0, [(r * 1.0, 0.0), (r * 1.09, 0.02), (r * 1.09, 0.05), (r * 1.0, 0.06)], 28 if v.hi else 14, 'trim')
        for i, f in enumerate((0.3, 0.62, 0.86)):
            a = i * 2.1; v.window(math.sin(a) * r, 0.3 + h * f, math.cos(a) * r, 0.18, 0.34, a, arch=True, rows=1)
        v.lathe(0, 0.3 + h, 0, [(r * 1.28, 0.0), (r * 1.1, 0.12), (0.0, 0.12)], 28 if v.hi else 14, 'trim')
        v.cone_roof(0, 0.4 + h, 0, [(r * 1.5, 0.0), (r * 1.3, 0.1), (r * 0.85, 0.5), (r * 0.4, 1.0), (r * 0.1, 1.4)], 20 if not v.hi else 40, roof)
        v.lathe(0, 0.4 + h + 1.4, 0, [(0.0, 0.0), (0.012, 0.0), (0.012, 0.4), (0.0, 0.42)], 8, 'gold')
        v.lathe(0, 0.3 + h + 1.5, 0, [(0.0, 0.0), (0.06, 0.04), (0.0, 0.1)], 12, 'lampg')


def strings(v, lights):
    for (a, b, sag, n) in lights:
        pts = []
        for i in range(n + 1):
            t = i / n; pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t))
        for i in range(n):
            v.beam(pts[i], pts[i + 1], 0.01, 0.01, 'iron')
        for p in pts: v.lathe(p[0], p[1] - 0.075, p[2], [(0.0, 0.0), (0.025, 0.02), (0.03, 0.05), (0.0, 0.075)], 8 if v.hi else 5, 'lampg')


def garden(v, spec):
    x, z, w, d = spec
    v.box(x, 0.0, z, w - 0.4, 0.045, d - 0.4, 'path')
    n = max(1, int(w / 0.3))
    for i in range(n + 1): v.hedge(x - w / 2 + i * w / n, z - d / 2, 0.3, 0.26, 0.3)
    m = max(1, int(d / 0.3))
    for i in range(m + 1):
        v.hedge(x - w / 2, z - d / 2 + i * d / m, 0.26, 0.3, 0.3); v.hedge(x + w / 2, z - d / 2 + i * d / m, 0.26, 0.3, 0.3)
    v.flowers(x, z, w - 0.5, d - 0.5, 18)


def banners(v, spec):
    for i, (x, y, z, ry) in enumerate(spec): v.banner(x, y, z, ry, i)


def dress(v, id_, roof='roofSlate'):
    g = GROWTH[id_]
    with v.module(2): wing(v, g['wing'], roof); banners(v, g['banners'])
    with v.module(3): turret(v, g['tower'], roof); strings(v, g['lights']); garden(v, g['garden'])
