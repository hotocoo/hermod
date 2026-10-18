"""Village props (plan placement kinds). Each builder fills a V (hi source / lo game mesh) in world axes, origin at ground centre, +z front.
Run via build.py (registered in BUILDERS). Dimensions in world units (1 unit ~ 4 m)."""
import math
from vlib import V, TAU
P = math.pi
S = 1024


def stall(v, var=0):
    cl = f'cloth{var % 4}'; w, d = 0.95, 0.55
    for sx in (-1, 1):
        for sz in (-1, 1): v.box(sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03), 0.05, 0.62 if sz > 0 else 0.78, 0.05, 'beam')
    v.box(0, 0.38, 0, w, 0.04, d, 'timber'); v.box(0, 0, 0, w - 0.1, 0.38, d - 0.1, 'timber')
    for i in range(7): v.box(-w / 2 + 0.07 + i * 0.135, 0.34, d / 2 + 0.001, 0.12, 0.04, 0.012, 'wood2')
    v.cloth((-w / 2 - 0.05, 0.78, -d / 2), (w / 2 + 0.05, 0.78, -d / 2), (-w / 2 - 0.05, 0.62, d / 2 + 0.12), (w / 2 + 0.05, 0.62, d / 2 + 0.12), cl, sag=0.01, nx=10, nz=4)
    for i in range(6): v.box(-w / 2 + 0.05 + i * 0.18, 0.62, d / 2 + 0.12, 0.1, 0.05, 0.004, 'cloth0' if i % 2 else 'cloth1')
    goods = ['flowerA', 'flowerB', 'hedge2', 'brick', 'trim', 'cloth0'][var % 6]
    for i in range(5):
        v.sphere(-0.34 + i * 0.17, 0.46, 0.05, 0.065, goods, 10)
    v.crate(0.38, -0.05, 0.16, 0.2, 0.42); v.barrel(-0.5, 0.45, 0.0, 0.8)
    v.meta.update(anchorY=1.0, dims=[w + 0.2, d + 0.3, 0.9])


def well(v, var=0):
    v.lathe(0, 0, 0, [(0.0, 0.0), (0.46, 0.0), (0.46, 0.06), (0.4, 0.06), (0.4, 0.46), (0.46, 0.46), (0.46, 0.5), (0.0, 0.5)], 24 if v.hi else 14, 'stone')
    if v.hi:
        for k in range(28): a = TAU * k / 28; v.box(math.cos(a) * 0.43, 0.06, math.sin(a) * 0.43, 0.09, 0.4, 0.05, 'stone', yaw=-a)
    v.lathe(0, 0.46, 0, [(0.0, 0.0), (0.38, 0.0), (0.38, -0.01), (0.0, -0.01)], 14, 'water')
    for sx in (-1, 1): v.box(sx * 0.4, 0.46, 0, 0.06, 0.62, 0.06, 'beam')
    v.box(0, 1.02, 0, 0.9, 0.06, 0.07, 'beam'); v.gable_roof(0, 0, 1.0, 0.7, 1.06, 0.6, 'roofTile', ov=0.1, ove=0.1, wall='plaster', gables=False)
    v.lathe(0, 0.9, 0, [(0.0, 0.0), (0.05, 0.0), (0.05, 0.14), (0.0, 0.14)], 8, 'timber'); v.box(0.0, 0.5, 0.0, 0.01, 0.4, 0.01, 'rope')
    v.lathe(0, 0.46, 0, [(0.0, 0.0), (0.07, 0.0), (0.08, 0.1), (0.0, 0.1)], 8, 'timber')
    v.meta.update(anchorY=1.4, dims=[1.1, 1.0, 1.3])


def bench(v, var=0):
    v.box(0, 0.26, 0, 0.7, 0.05, 0.26, 'timber')
    for k in range(3): v.box(0, 0.31, -0.08 + k * 0.08, 0.7, 0.01, 0.01, 'beam')
    v.box(0, 0.4, -0.14, 0.7, 0.2, 0.04, 'timber')
    for sx in (-1, 1): v.box(sx * 0.3, 0.0, 0, 0.06, 0.26, 0.22, 'iron' if var else 'beam')
    v.meta.update(anchorY=0.6, dims=[0.8, 0.4, 0.6])


def barrel(v, var=0): v.barrel(0, 0, 0.0, 1.0 + 0.2 * var); v.meta.update(anchorY=0.6, dims=[0.5, 0.5, 0.55])


def crate(v, var=0):
    s = (0.3, 0.36, 0.26)[var % 3]; v.crate(0, 0, s, 0.2 * var, 0.0)
    if var == 1: v.crate(0.28, 0.05, 0.22, 0.5, 0.0); v.crate(0.05, 0.0, 0.2, 0.9, s)
    v.meta.update(anchorY=0.5, dims=[0.8, 0.8, 0.6])


def cart(v, var=0):
    v.box(0, 0.22, 0, 0.9, 0.05, 0.5, 'timber')
    for sz in (-1, 1): v.box(0, 0.27, sz * 0.25, 0.9, 0.12, 0.04, 'wood2')
    for sx in (-1, 1):
        for k in range(12):
            a = TAU * k / 12; v.box(sx * 0.48, 0.2 + math.sin(a) * 0.17, 0.0 + math.cos(a) * 0.17, 0.03, 0.04, 0.06, 'iron', yaw=0.0)
        v.lathe(sx * 0.48, 0.2, 0, [(0, -0.015), (0.04, -0.015), (0.04, 0.015), (0, 0.015)], 8, 'beam')
    v.box(0, 0.3, 0.52, 0.04, 0.04, 0.6, 'beam')
    for i in range(6): v.sphere(-0.3 + (i % 3) * 0.3, 0.38, -0.1 + (i // 3) * 0.2, 0.09, 'hedge2' if i % 2 else 'brick', 8)
    v.meta.update(anchorY=0.7, dims=[1.2, 1.2, 0.6])


def fence(v, var=0):
    for i in range(7): v.box(-0.9 + i * 0.3, 0, 0, 0.05, 0.4, 0.04, 'timber')
    v.box(0, 0.12, 0.03, 1.9, 0.04, 0.025, 'beam'); v.box(0, 0.28, 0.03, 1.9, 0.04, 0.025, 'beam')
    v.meta.update(anchorY=0.5, dims=[2.0, 0.2, 0.5])


def hedge_run(v, var=0):
    """Hedge run for orchard and allotment boundaries (placed end to end along plan.walls): 1.2 long, leaf clumps from vlib.hedge."""
    v.hedge(0, 0, 1.2, 0.36, 0.34 + 0.05 * var)
    v.meta.update(anchorY=0.4, dims=[1.2, 0.36, 0.4])


def haystack(v, var=0):
    r = (0.42, 0.34, 0.5)[var % 3]
    v.lathe(0, 0, 0, [(0.0, 0.0), (r, 0.0), (r * 1.05, r * 0.5), (r * 0.8, r * 0.95), (r * 0.35, r * 1.35), (0.0, r * 1.5)], 28 if v.hi else 12, 'thatch')
    v.meta.update(anchorY=1.0, dims=[r * 2.2, r * 2.2, r * 1.5])


def beehive(v, var=0):
    for i in range(3): v.box(0, 0, 0, 0.0, 0.0, 0.0, 'timber') if False else None
    for sx in (-1, 1): v.box(sx * 0.2, 0, 0, 0.04, 0.26, 0.04, 'beam')
    v.box(0, 0.26, 0, 0.5, 0.03, 0.2, 'wood2')
    for k in range(3):
        v.lathe(-0.12 + k * 0.12, 0.29, 0, [(0.0, 0.0), (0.08, 0.0), (0.075, 0.07), (0.05, 0.13), (0.0, 0.15)], 14 if v.hi else 8, 'thatch')
    v.meta.update(anchorY=0.5, dims=[0.6, 0.3, 0.45])


def firewood(v, var=0):
    for row in range(4):
        for i in range(7 - row):
            v.lathe(-0.45 + row * 0.07 + i * 0.145, 0.07 + row * 0.12, -0.15, [(0, -0.15), (0.06, -0.15), (0.06, 0.15), (0, 0.15)], 10 if v.hi else 6, 'wood2', ratio=(1, 1)) if False else v.box(-0.45 + row * 0.07 + i * 0.145, row * 0.12, -0.15, 0.12, 0.12, 0.34, 'wood2' if (i + row) % 2 else 'timber', yaw=0.0)
    v.box(0, 0.5, -0.15, 1.0, 0.02, 0.4, 'beam') if False else None
    v.meta.update(anchorY=0.6, dims=[1.1, 0.5, 0.5])


def washing_line(v, var=0):
    for sx in (-1, 1): v.box(sx * 0.7, 0, 0, 0.05, 0.9, 0.05, 'beam')
    v.beam((-0.7, 0.86, 0), (0.7, 0.8, 0), 0.01, 0.01, 'rope')
    for i in range(5):
        x = -0.5 + i * 0.25; c = f'cloth{i % 4}'; v.cloth((x - 0.07, 0.82, 0), (x + 0.07, 0.82, 0), (x - 0.07, 0.5 - (i % 2) * 0.1, 0.01), (x + 0.07, 0.5 - (i % 2) * 0.1, 0.01), c, sag=0.0, nx=3, nz=4)
    v.meta.update(anchorY=1.0, dims=[1.5, 0.2, 0.95])


def festival_table(v, var=0):
    v.box(0, 0.38, 0, 0.9, 0.04, 0.4, 'timber')
    for sx in (-1, 1): v.box(sx * 0.4, 0, 0, 0.05, 0.38, 0.36, 'beam')
    v.box(0, 0.42, 0, 0.9, 0.012, 0.42, f'cloth{var % 4}'); v.barrel(0, 0, 0.42, 0.25) if False else None
    for i in range(3): v.lathe(-0.25 + i * 0.25, 0.43, 0.0, [(0, 0), (0.04, 0), (0.035, 0.07), (0, 0.07)], 8, 'trim')
    for sz in (-1, 1): v.box(0, 0.2, sz * 0.32, 0.9, 0.04, 0.12, 'wood2')
    v.meta.update(anchorY=0.7, dims=[1.0, 0.8, 0.6])


def maypole(v, var=0):
    v.lathe(0, 0, 0, [(0.0, 0.0), (0.07, 0.0), (0.045, 0.2), (0.04, 2.2), (0.0, 2.25)], 12 if v.hi else 8, 'timber')
    v.lathe(0, 2.1, 0, [(0.0, 0.0), (0.14, 0.0), (0.14, 0.06), (0.0, 0.06)], 14, 'gold')
    for i in range(8):
        a = TAU * i / 8; c = f'cloth{i % 4}'; v.cloth((0, 2.12, 0), (0.001, 2.12, 0), (math.cos(a) * 0.95, 0.12, math.sin(a) * 0.95), (math.cos(a) * 0.95 + 0.04, 0.12, math.sin(a) * 0.95), c, sag=-0.02, nx=2, nz=10)
    v.meta.update(anchorY=2.4, dims=[2.0, 2.0, 2.3])


def bunting_post(v, var=0):
    v.lathe(0, 0, 0, [(0, 0), (0.035, 0), (0.025, 1.0), (0, 1.02)], 8, 'timber')
    for i in range(5): v.cloth((0.0, 0.98, 0), (0.0, 0.98, 0), (0.12, 0.8 - 0.02 * i, 0.04 * i), (0.12, 0.8 - 0.02 * i, 0.04 * i + 0.06), f'cloth{i % 4}', nx=1, nz=1) if False else None
    for i in range(4): v.box(0.08 + i * 0.1, 0.88 - (i % 2) * 0.03, 0.0, 0.06, 0.08, 0.004, f'cloth{i % 4}')
    v.meta.update(anchorY=1.1, dims=[0.5, 0.2, 1.0])


def scarecrow(v, var=0):
    v.box(0, 0, 0, 0.04, 1.0, 0.04, 'timber'); v.box(0, 0.7, 0, 0.8, 0.04, 0.04, 'timber')
    v.box(0, 0.45, 0, 0.26, 0.3, 0.16, 'cloth1'); v.sphere(0, 0.88, 0, 0.1, 'thatch', 10)
    v.cone_roof(0, 0.95, 0, [(0.18, 0.0), (0.1, 0.05), (0.0, 0.2)], 10, 'wood2') if hasattr(v, 'cone_roof') else None
    v.meta.update(anchorY=1.2, dims=[0.9, 0.2, 1.1])


def allotment_bed(v, var=0):
    v.box(0, 0, 0, 0.8, 0.12, 0.38, 'soil')
    for r in range(4):
        for i in range(5):
            x = -0.32 + i * 0.16; z = -0.12 + r * 0.08
            if var == 0: v.sphere(x, 0.17, z, 0.05, 'hedge2', 8)
            else: v.lathe(x, 0.12, z, [(0, 0), (0.04, 0.0), (0.02, 0.12), (0, 0.16)], 6, 'hedge')
    for sx in (-1, 1): v.box(sx * 0.4, 0, 0, 0.03, 0.14, 0.4, 'timber')
    for sz in (-1, 1): v.box(0, 0, sz * 0.19, 0.8, 0.14, 0.03, 'timber')
    v.meta.update(anchorY=0.4, dims=[0.9, 0.5, 0.3])


def net_rack(v, var=0):
    for sx in (-1, 1): v.box(sx * 0.5, 0, 0, 0.05, 0.9, 0.05, 'beam')
    v.box(0, 0.8, 0, 1.1, 0.04, 0.05, 'beam')
    v.cloth((-0.48, 0.8, 0.0), (0.48, 0.8, 0.0), (-0.45, 0.25, 0.04), (0.45, 0.25, 0.04), 'rope', sag=0.03, nx=14, nz=8)
    for i in range(4): v.sphere(-0.3 + i * 0.2, 0.22, 0.05, 0.05, 'trim', 8)
    v.meta.update(anchorY=1.0, dims=[1.2, 0.3, 0.9])


def dock_post(v, var=0):
    v.lathe(0, -0.2, 0, [(0.0, 0.0), (0.07, 0.0), (0.06, 0.65), (0.075, 0.7), (0.0, 0.7)], 10, 'beam')
    v.lathe(0, 0.4, 0, [(0.07, 0.0), (0.09, 0.0), (0.09, 0.03), (0.07, 0.03)], 10, 'rope')
    v.meta.update(anchorY=0.6, dims=[0.2, 0.2, 0.55])


def pier(v, var=0):
    L = 2.6; w = 0.7
    for i in range(int(L / 0.1)): v.box(0, 0.36, 0.0 + i * 0.1 + 0.05, w, 0.03, 0.095, 'wood2' if i % 2 else 'timber')
    for sx in (-1, 1): v.box(sx * (w / 2 - 0.04), 0.3, L / 2, 0.06, 0.06, L, 'beam')
    for k in range(5):
        z = 0.1 + k * L / 4.1
        for sx in (-1, 1): v.lathe(sx * (w / 2 + 0.03), -0.35, z, [(0, 0), (0.05, 0), (0.045, 0.75), (0, 0.77)], 8, 'beam')
    v.meta.update(anchorY=0.6, dims=[w + 0.3, L, 0.5])


def boat(v, var=0):
    L = (1.1, 1.4, 0.9)[var % 3]; W = L * 0.34
    v.hull(0, 0.0, 0, L, W, 0.2, 'hull', 'wood2')
    for k in range(-1, 2): v.box(0.0, 0.16, k * L * 0.2, W * 0.8, 0.03, 0.07, 'wood2')
    if var % 3 == 1:
        v.lathe(0, 0.0, 0.1, [(0, 0), (0.025, 0), (0.02, 1.1), (0, 1.12)], 8, 'timber'); v.cloth((0.0, 1.0, 0.1), (0.0, 1.0, 0.1), (0.0, 0.3, 0.1), (0.0, 0.3, 0.1), 'sail', nx=1, nz=1) if False else v.cloth((0.0, 1.05, 0.12), (0.0, 1.05, 0.55), (0.0, 0.3, 0.12), (0.0, 0.3, 0.5), 'sail', sag=0.0, nx=6, nz=6)
    for sx in (-1, 1): v.beam((sx * W * 0.3, 0.15, -0.1), (sx * W * 1.05, 0.02, 0.15), 0.025, 0.02, 'beam')
    v.lathe(0.0, 0.0, -L * 0.5 + 0.02, [(0, 0), (0.02, 0), (0.02, 0.25), (0, 0.25)], 6, 'rope')
    v.meta.update(anchorY=0.6, dims=[W + 0.3, L + 0.2, 0.4])


def fisher_hut(v, var=0):
    w, d, wh, y0 = 1.5, 1.2, 0.8, 0.1
    v.plinth(0, 0, w + 0.1, d + 0.1, y0, 'stone'); v.plaster(0, 0, w, d, y0, wh, 'plasterW')
    v.gable_roof(0, 0, w, d, y0 + wh, 0.6, 'roofBrown', ov=0.18, ove=0.1, wall='plaster')
    v.door(0, y0, d / 2 + 0.01, 0.32, 0.55, 0.0, False, 1, name='door'); v.window(w * 0.3, y0 + wh * 0.6, d / 2 + 0.004, 0.2, 0.28, 0.0, rows=2, shutters=True)
    v.chimney(w * 0.22, y0 + wh + 0.16, -d * 0.1, 0.5, 'stone', w=0.2); v.barrel(-0.55, d / 2 + 0.2); v.box(-0.8, y0, d / 2 + 0.05, 0.05, 0.7, 0.05, 'beam')
    v.beam((-0.8, 0.8, d / 2 + 0.05), (-0.3, 0.8, d / 2 + 0.3), 0.008, 0.008, 'rope'); v.cloth((-0.7, 0.8, d / 2 + 0.05), (-0.45, 0.8, d / 2 + 0.2), (-0.7, 0.45, d / 2 + 0.05), (-0.45, 0.45, d / 2 + 0.2), 'rope', sag=0.02, nx=6, nz=5)
    v.meta.update(anchorY=1.8, dims=[w + 0.6, d + 0.7, 1.4])


def craft_house(v, var=0):
    w, d, wh, y0 = 2.0, 1.5, 1.0, 0.12
    v.plinth(0, 0, w + 0.14, d + 0.14, y0, 'stone'); v.masonry(0, 0, w, d, y0, wh, 'brick', course=0.075, block=0.2)
    v.gable_roof(0, 0, w, d, y0 + wh, 0.7, 'roofTile', ov=0.2, ove=0.1, wall='brick')
    v.door(0, y0, d / 2 + 0.01, 0.4, 0.66, 0.0, True, 2, name='door')
    for k in (-1, 1): v.window(k * w * 0.32, y0 + wh * 0.58, d / 2 + 0.004, 0.26, 0.38, 0.0, rows=2, shutters=True)
    v.chimney(w * 0.3, y0 + wh + 0.2, -d * 0.12, 0.7, 'brick', w=0.26)
    v.box(w / 2 + 0.2, y0, 0.1, 0.5, 0.3, 0.5, 'timber'); v.barrel(-w / 2 - 0.3, 0.2); v.crate(w / 2 + 0.25, 0.7, 0.22, 0.3, 0.0)
    v.beam((0.0, y0 + wh - 0.1, d / 2 + 0.02), (0.0, y0 + wh + 0.3, d / 2 + 0.3), 0.04, 0.04, 'beam'); v.box(0, y0 + wh + 0.18, d / 2 + 0.3, 0.5, 0.3, 0.02, 'sign')
    v.meta.update(anchorY=2.0, dims=[w + 0.8, d + 0.7, 1.6])


def watermill(v, var=0):
    w, d, wh, y0 = 2.0, 1.8, 1.25, 0.12
    v.plinth(0, 0, w + 0.14, d + 0.14, y0, 'stone'); v.masonry(0, 0, w, d, y0, wh, 'stone', course=0.14, block=0.34)
    v.gable_roof(0, 0, w, d, y0 + wh, 0.85, 'roofSlate', ov=0.22, ove=0.1, wall='stone')
    v.door(0, y0, d / 2 + 0.01, 0.4, 0.66, 0.0, True, 2, name='door')
    for k in (-1, 1): v.window(k * w * 0.3, y0 + wh * 0.6, d / 2 + 0.004, 0.24, 0.4, 0.0, rows=2)
    v.chimney(-w * 0.26, y0 + wh + 0.2, -d * 0.1, 0.7, 'stone', w=0.26)
    # wheel on the east wall, axis along x
    R = 0.85; cx = w / 2 + 0.22; cy = y0 + 0.75
    for k in range(16):
        a = TAU * k / 16; v.beam((cx, cy, 0), (cx, cy + math.sin(a) * R, math.cos(a) * R), 0.05, 0.035, 'timber')
        a2 = TAU * (k + 0.5) / 16; v.box(cx, cy + math.sin(a2) * R - 0.04, math.cos(a2) * R - 0.04, 0.34, 0.08, 0.08, 'wood2', rot=None)
    for sx in (-1, 1): v.lathe(cx + sx * 0.14, cy, 0, [(0, 0), (0.03, 0), (0.03, 0.01), (0, 0.01)], 6, 'iron') if False else None
    v.lathe(cx, cy, 0, [(0.0, -0.2), (0.07, -0.2), (0.07, 0.2), (0.0, 0.2)], 10, 'iron', mod=None) if False else v.box(cx, cy - 0.06, -0.06, 0.4, 0.12, 0.12, 'iron')
    v.meta.update(anchorY=2.4, dims=[w + 1.2, d + 0.6, 2.0])


def lighthouse(v, var=0):
    v.lathe(0, 0, 0, [(0.0, 0.0), (0.62, 0.0), (0.62, 0.15), (0.5, 0.25), (0.44, 1.0), (0.4, 2.0), (0.36, 2.8), (0.0, 2.8)], 40 if v.hi else 20, 'stone')
    for k in range(5):
        v.lathe(0, 0.5 + k * 0.5, 0, [(0.0, 0.0), (0.455 - 0.016 * k, 0.0), (0.46 - 0.016 * k, 0.05), (0.0, 0.05)], 24, 'trim' if k % 2 == 0 else 'brick')
    v.lathe(0, 2.8, 0, [(0.0, 0.0), (0.5, 0.0), (0.5, 0.06), (0.4, 0.08), (0.0, 0.08)], 28, 'stone')
    for k in range(12):
        a = TAU * k / 12; v.box(math.cos(a) * 0.46, 2.88, math.sin(a) * 0.46, 0.03, 0.2, 0.03, 'iron')
    v.lathe(0, 2.88, 0, [(0.0, 0.0), (0.2, 0.0), (0.2, 0.32), (0.0, 0.32)], 18, 'win')
    v.lathe(0, 3.2, 0, [(0.0, 0.0), (0.52, 0.0), (0.4, 0.15), (0.0, 0.4)], 28, 'roofSlate')
    v.sphere(0, 3.6, 0, 0.05, 'gold', 8)
    v.door(0, 0.15, 0.43, 0.3, 0.5, 0.0, False, 0, name='door')
    for k in range(4): v.window(0, 0.8 + k * 0.5, 0.45, 0.12, 0.2, 0.0, rows=1)
    v.meta.update(anchorY=4.0, dims=[1.4, 1.4, 3.7])


def flower_patch(v, var=0):
    cols = [('flowerC', 'hedge2'), ('flowerA', 'hedge'), ('flowerB', 'flowerA'), ('trim', 'hedge2')][var % 4]
    r = v.r
    for i in range(34 if v.hi else 20):
        a = r.random() * TAU; d = r.random() ** 0.5 * 0.32; x, z = math.cos(a) * d, math.sin(a) * d; h = 0.12 + r.random() * 0.1
        v.lathe(x, 0, z, [(0.0, 0.0), (0.006, 0.0), (0.005, h), (0.0, h)], 4, 'hedge')
        v.sphere(x, h + 0.01, z, 0.028, cols[i % 2], 6)
        v.box(x + 0.03, h * 0.5, z, 0.05, 0.004, 0.025, 'hedge2', yaw=a)
    v.meta.update(anchorY=0.3, dims=[0.7, 0.7, 0.25])


def shrub(v, var=0):
    r = v.r
    for i in range(16 if v.hi else 8):
        a = r.random() * TAU; d = r.random() * 0.22; v.sphere(math.cos(a) * d, 0.16 + r.random() * 0.18, math.sin(a) * d, 0.13 + r.random() * 0.06, 'hedge2' if i % 2 else 'hedge', 8)
    v.meta.update(anchorY=0.5, dims=[0.7, 0.7, 0.5])


def rock(v, var=0): v.rock(0, 0, 0, (0.22, 0.3, 0.16)[var % 3], 'rock', seed=var + 3); v.meta.update(anchorY=0.3, dims=[0.7, 0.7, 0.3])
def boulder(v, var=0): v.rock(0, 0, 0, (0.5, 0.62, 0.42)[var % 3], 'rock', seed=var + 11, squash=0.7); v.meta.update(anchorY=0.5, dims=[1.4, 1.4, 0.6])


def reed(v, var=0):
    r = v.r
    for i in range(18 if v.hi else 10):
        a = r.random() * TAU; d = r.random() * 0.14; h = 0.35 + r.random() * 0.3; x, z = math.cos(a) * d, math.sin(a) * d; lean = (r.random() - 0.5) * 0.12
        v.beam((x, 0, z), (x + lean, h, z + lean * 0.5), 0.012, 0.01, 'hedge2')
        if i % 3 == 0: v.lathe(x + lean, h - 0.02, z + lean * 0.5, [(0, 0), (0.018, 0.02), (0.015, 0.09), (0, 0.11)], 6, 'soil')
    v.meta.update(anchorY=0.7, dims=[0.4, 0.4, 0.6])


def lamp(v, var=0):
    v.lathe(0, 0, 0, [(0.0, 0.0), (0.09, 0.0), (0.08, 0.05), (0.05, 0.1), (0.035, 0.2), (0.03, 1.12), (0.0, 1.12)], 14 if v.hi else 8, 'iron')
    v.lathe(0, 0.6, 0, [(0.036, 0.0), (0.05, 0.0), (0.05, 0.03), (0.036, 0.03)], 10, 'iron')
    v.lathe(0, 1.12, 0, [(0.0, 0.0), (0.12, 0.0), (0.13, 0.03), (0.0, 0.03)], 12, 'iron')
    v.lathe(0, 1.15, 0, [(0.0, 0.0), (0.085, 0.0), (0.095, 0.1), (0.085, 0.2), (0.0, 0.2)], 12, 'lampg')
    for k in range(4): a = TAU * k / 4 + P / 4; v.box(math.cos(a) * 0.088, 1.14, math.sin(a) * 0.088, 0.012, 0.22, 0.012, 'iron')
    v.lathe(0, 1.35, 0, [(0.0, 0.0), (0.13, 0.0), (0.09, 0.07), (0.0, 0.13)], 12, 'iron'); v.sphere(0, 1.5, 0, 0.02, 'iron', 6)
    v.meta.update(anchorY=1.7, dims=[0.3, 0.3, 1.5])


KINDS = dict(lamp=(lamp, 1), stall=(stall, 5), well=(well, 1), bench=(bench, 2), barrel=(barrel, 3), crate=(crate, 3), cart=(cart, 1), fence=(fence, 1), hedge=(hedge_run, 2), haystack=(haystack, 3), beehive=(beehive, 1),
             firewood=(firewood, 1), **{'washing-line': (washing_line, 1), 'festival-table': (festival_table, 3), 'bunting-post': (bunting_post, 1), 'allotment-bed': (allotment_bed, 2), 'net-rack': (net_rack, 1),
             'dock-post': (dock_post, 1), 'fisher-hut': (fisher_hut, 1), 'craft-house': (craft_house, 1), 'flower-patch': (flower_patch, 4)},
             maypole=(maypole, 1), scarecrow=(scarecrow, 1), pier=(pier, 1), boat=(boat, 3), watermill=(watermill, 1), lighthouse=(lighthouse, 1), shrub=(shrub, 3), rock=(rock, 3), boulder=(boulder, 3), reed=(reed, 3))


def make(fn, var):
    def f(v):
        with v.module(1): fn(v, var)
    return f


# asset id: <kind>_<variant>; texture size per kind (small props 512)
BIG = {'watermill', 'lighthouse', 'craft-house', 'fisher-hut'}
BUILDERS = {}
for k, (fn, n) in KINDS.items():
    for i in range(n): BUILDERS[f'{k}_{i}'] = (make(fn, i), 1024)
