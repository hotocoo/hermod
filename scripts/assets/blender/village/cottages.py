"""Member cottages (6 variants, instanceable): gabled houses with porch/dormer/bay/lean-to differences, lit windows, chimneys, hedge garden and picket fence. Door faces +z."""
import math
from vlib import V, TAU
P = math.pi
# name: (w, d, wallH, wall, roof, pitch, extras...)
VAR = [
    dict(w=1.5, d=1.25, h=0.82, wall='plaster', roof='roofTile', pitch=0.7, chim=1, extra='porch', shut=True),
    dict(w=1.6, d=1.3, h=0.88, wall='brick', roof='roofSlate', pitch=0.78, chim=-1, extra='dormer', shut=False),
    dict(w=1.45, d=1.35, h=0.8, wall='stone', roof='roofBrown', pitch=0.66, chim=1, extra='leanto', shut=True),
    dict(w=1.7, d=1.2, h=0.78, wall='plasterW', roof='roofOchre', pitch=0.62, chim=-1, extra='bay', shut=True),
    dict(w=1.4, d=1.3, h=0.84, wall='plaster', roof='roofSlate', pitch=0.74, chim=1, extra='timber', shut=False),
    dict(w=1.35, d=1.15, h=1.05, wall='stone', roof='roofTile', pitch=0.82, chim=-1, extra='tall', shut=True),
]


def cottage(v, p):
    w, d, wh, y0 = p['w'], p['d'], p['h'], 0.12; wall = p['wall']; sx = p['chim']
    v.plinth(0, 0, w + 0.14, d + 0.14, y0, 'stone')
    if wall in ('plaster', 'plasterW'): v.plaster(0, 0, w, d, y0, wh, wall)
    else: v.masonry(0, 0, w, d, y0, wh, wall, course=0.075 if wall == 'brick' else 0.14, block=0.2 if wall == 'brick' else 0.34)
    v.box(0, y0 + wh - 0.05, 0, w + 0.03, 0.05, d + 0.03, 'beam')
    gw = 'brick' if wall == 'brick' else ('stone' if wall == 'stone' else wall)
    v.gable_roof(0, 0, w, d, y0 + wh, p['pitch'], p['roof'], ov=0.16, ove=0.08, wall=gw)
    ex = p['extra']
    if ex == 'timber':  # half-timbered gable and walls
        for x in (-w / 2 + 0.03, 0.0, w / 2 - 0.03):
            v.box(x, y0, d / 2 + 0.006, 0.05, wh, 0.03, 'beam'); v.box(x, y0, -d / 2 - 0.006, 0.05, wh, 0.03, 'beam')
        v.box(0, y0 + wh * 0.5, d / 2 + 0.006, w, 0.045, 0.03, 'beam'); v.beam((-w / 2 + 0.05, y0 + 0.04, d / 2 + 0.012), (0.0 - 0.05, y0 + wh - 0.06, d / 2 + 0.012), 0.04, 0.03, 'beam'); v.beam((w / 2 - 0.05, y0 + 0.04, d / 2 + 0.012), (0.05, y0 + wh - 0.06, d / 2 + 0.012), 0.04, 0.03, 'beam')
    # door with stone surround, step and lantern
    v.door(-0.0 if ex != 'bay' else 0.0, y0 + 0.0, d / 2 + 0.01, 0.34, 0.58, 0.0, False, 0, name='door')
    v.box(0, y0 - 0.02, d / 2 + 0.14, 0.5, 0.08, 0.22, 'stone')
    v.lantern(0.27, y0 + 0.46, d / 2 + 0.08, 0.7)
    for k in (-1, 1): v.window(k * w * 0.3, y0 + wh * 0.62, d / 2 + 0.004, 0.2, 0.3, 0.0, rows=2, shutters=p['shut'] and k > 0 or p['shut'], arch=False)
    for k in (-1, 1): v.window(k * (w / 2 + 0.004), y0 + wh * 0.6, 0.0, 0.2, 0.28, k * P / 2, rows=2)
    v.window(0, y0 + wh * 0.6, -d / 2 - 0.004, 0.2, 0.28, P, rows=2)
    smoke = v.chimney(sx * w * 0.26, y0 + wh + 0.18, -d * 0.12, 0.55, 'brick' if wall != 'stone' else 'stone', w=0.2)
    v.empty('smoke', *smoke)
    if ex == 'porch':
        for s in (-1, 1): v.lathe(s * 0.24, y0, d / 2 + 0.3, [(0.0, 0.0), (0.03, 0.0), (0.025, 0.55), (0.0, 0.55)], 8, 'beam')
        v.gable_roof(0, d / 2 + 0.18, 0.62, 0.34, y0 + 0.58, 0.55, p['roof'], ov=0.06, ove=0.06, wall=gw, th=0.04)
    elif ex == 'dormer':
        v.plaster(0, 0.2, 0.34, 0.3, y0 + wh + 0.1, 0.3, 'plaster'); v.gable_roof(0, 0.2, 0.34, 0.3, y0 + wh + 0.4, 0.7, p['roof'], ov=0.05, ove=0.05, wall='plaster', th=0.04)
        v.window(0, y0 + wh + 0.28, 0.2 + 0.152, 0.16, 0.2, 0.0, rows=2)
    elif ex == 'leanto':
        sx2 = -sx; v.masonry(sx2 * (w / 2 + 0.28), 0.0, 0.5, d * 0.7, y0, wh * 0.7, 'stone', course=0.14, block=0.3)
        R = __import__('mathutils').Matrix.Rotation(-sx2 * 0.45, 3, 'Z'); v.box(sx2 * (w / 2 + 0.3), y0 + wh * 0.7 + 0.05, 0.0, 0.62, 0.05, d * 0.76, p['roof'], rot=R)
        v.box(sx2 * (w / 2 + 0.28), y0, d * 0.35 + 0.002, 0.26, 0.45, 0.03, 'timber')
    elif ex == 'bay':
        v.box(0.0, y0, d / 2 + 0.12, 0.6, 0.4, 0.22, wall if wall != 'plasterW' else 'plaster'); v.box(0.0, y0 + 0.4, d / 2 + 0.12, 0.66, 0.04, 0.26, 'stone')
        v.window(0.0, y0 + 0.2, d / 2 + 0.236, 0.4, 0.22, 0.0, rows=2)
        v.box(0.0, y0 + 0.44, d / 2 + 0.12, 0.62, 0.12, 0.24, 'trim')
    elif ex == 'tall':
        v.box(0, y0 + wh * 0.55, d / 2 + 0.02, w + 0.04, 0.03, 0.03, 'trim')
        v.box(0.0, y0 + 0.62, d / 2 + 0.07, 0.34, 0.03, 0.12, 'stone'); [v.box(sx3 * 0.17, y0 + 0.62, d / 2 + 0.07, 0.03, 0.08, 0.12, 'iron') for sx3 in (-1, 1)]
    # garden: hedges at sides and front corners, flower box, picket fence
    r = v.r
    z = -d / 2
    while z <= d / 2:
        v.hedge(-w / 2 - 0.2, z, 0.22, 0.3, 0.26)
        if r.random() > 0.35: v.hedge(w / 2 + 0.2, z, 0.22, 0.3, 0.26)
        z += 0.3
    for f in (0.1, 0.25): v.hedge(w * (f + 0.15), d / 2 + 0.2, 0.24, 0.22, 0.24)
    for i in range(-3, 4):
        if abs(i) < 1: continue
        v.box(i * 0.26 - 0.01, 0, d / 2 + 0.52, 0.025, 0.22, 0.02, 'timber')
        if v.hi: v.prism(i * 0.26, 0.22, d / 2 + 0.52, 0.026, 0.02, 0.03, 'timber')
    v.box(0, 0.15, d / 2 + 0.52, 1.8, 0.02, 0.015, 'timber'); v.box(0, 0.06, d / 2 + 0.52, 1.8, 0.02, 0.015, 'timber')
    v.flowers(w * 0.3, d / 2 + 0.28, 0.4, 0.1, 5, 0.0)
    v.empty('door', 0.0, y0, d / 2 + 0.1)
    v.meta.update(anchorY=2.15, door=dict(x=0.0, y=y0, z=d / 2 + 0.1, h=0.58), dims=[w + 0.6, d + 0.9, wh + 0.9], contact=[1.35, 1.1], roofTint=True)


def make(i):
    def f(v):
        with v.module(1): cottage(v, VAR[i])
    return f


BUILDERS = {f'cottage_{i}': (make(i), 1024) for i in range(len(VAR))}
