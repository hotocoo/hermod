"""Grass clumps grass_0..3 (village) and grass_dry_0..3 (sanctuary): blade-cluster cards from an authored blade atlas, LOD0-2, wind weight in COLOR_0.a (tip=1)."""
import math, os, sys, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import nlib
from nlib import Mesh, to_image, pbr_material, export, turntable
import foliage_tex as ft

CARDS = [5, 3, 2]; SEG = [4, 2, 1]


def clump(M, k, lod, R, W=0.34, Ht=0.3):
    tx, ty = k % 2, k // 2; u0, u1, v0, v1 = tx * .5 + .01, tx * .5 + .49, 1 - (ty + 1) * .5 + .01, 1 - ty * .5 - .01
    wide = 1.0 + 0.5 * lod  # coarser LODs: fewer, wider cards
    for c in range(CARDS[lod]):
        ang = math.pi * c / CARDS[lod] + R.uniform(-0.15, 0.15); d = Vector((math.cos(ang), math.sin(ang), 0)); off = Vector((R.gauss(0, .03), R.gauss(0, .03), 0)); bend = Vector((R.gauss(0, .5), R.gauss(0, .5), 0)) * 0.08
        rows = SEG[lod] + 1; pts = []
        for r in range(rows):
            t = r / SEG[lod]; h = Ht * t * (0.9 + 0.2 * R.random()); pts.append((off + bend * t * t + Vector((0, 0, h)), t))
        vl = [(M.vert(p - d * W * wide / 2), M.vert(p + d * W * wide / 2), t, p) for p, t in pts]
        for r in range(SEG[lod]):
            a, b, t0 = vl[r][0], vl[r][1], vl[r][2]; c2, d2, t1 = vl[r + 1][1], vl[r + 1][0], vl[r + 1][2]
            vv0, vv1 = v0 + (v1 - v0) * t0, v0 + (v1 - v0) * t1
            M.face([a, b, c2, d2], [(u0, vv0), (u1, vv0), (u1, vv1), (u0, vv1)], [(t0, 0.6, (k * .23 + c * .11) % 1)] * 2 + [(t1, 0.6, (k * .23 + c * .11) % 1)] * 2, 0, smooth=True)


def build(palette):
    nlib.reset(); pre = 'grass' if palette == 'village' else 'grass_dry'
    base, nrm, orm = ft.grass_atlas(2048, 9, palette)
    ml = pbr_material(pre + '_mat', to_image(pre + '_bc', base), to_image(pre + '_n', nrm, nc=True), to_image(pre + '_orm', orm, nc=True), alpha=True, normal_strength=0.6); ml['doubleSided'] = True
    objs = []
    for k in range(4):
        for lod in range(3):
            M = Mesh(); M.alpha_wind = True; clump(M, k, lod, random.Random(k * 7 + 3)); ob = M.finish(f'{pre}_{k}_LOD{lod}'); ob.data.materials.append(ml); objs.append(ob)
    # one glb with 4 variants; also split per-variant glbs for the binder (grass_<k>.glb)
    export(pre, objs, dict(kind='grass', variants=4, lods=3, card='alphaTest 0.42, alphaToCoverage', wind='COLOR_0.a'))
    for k in range(4):
        sel = [o for o in objs if o.name.startswith(f'{pre}_{k}_')]
        os.makedirs(nlib.RAW, exist_ok=True)
        export(f'{pre}_{k}', sel, dict(kind='grass', lods=3))
    turntable(pre, [o for o in objs if o.name.startswith(pre + '_0_')], dist_k=2.2)


if __name__ == '__main__':
    for p in (nlib.args() or ['village', 'sanctuary']): build(p)
