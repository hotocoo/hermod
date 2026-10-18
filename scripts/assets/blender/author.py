"""Procedural hero assets. blender -b --factory-startup -P author.py -- <id> <out.glb> <repoRoot> <bakePx>
Every builder is deterministic (seeded by id). High-poly sources are baked down (normal, colour, AO) onto clean quad low meshes with an
atlas UV (smart project + pack) so the shipped mesh is cheap but carries the detail."""
import sys, os, math, bpy, bmesh, mathutils
sys.path.insert(0, os.path.dirname(__file__))
from common import *

ID, OUT, ROOT, BAKE = argv()[0], argv()[1], argv()[2], int(argv()[3])
R = rng('hermod:' + ID)
P = lambda name, mid, **k: pbr(name, ROOT, mid, **k)

def subsurf_hi(obj, levels=2, disp=None, disp_scale=0.004):
    """High-poly source: subdivision + optional displacement from a real texture (never shipped, only baked)."""
    bpy.context.view_layer.objects.active = obj
    s = obj.modifiers.new('sub', 'SUBSURF'); s.levels = s.render_levels = levels
    return obj

def bake_low(low, highs, px, base_from_high=True, rough=0.6, metal=0.0, ao=True, ao_samples=48):
    smart_uv(low, 'Atlas'); setup_cycles(24 if not ao else ao_samples)
    low.data.materials.clear(); low.data.materials.append(bpy.data.materials.new('bake'))
    nrm = bake_pass(low, highs, 'NORMAL', px, ID + '_n', extrusion=0.015, ray=0.05)
    col = bake_pass(low, highs, 'DIFFUSE', px, ID + '_c', extrusion=0.015, ray=0.05) if base_from_high else None
    occ = bake_pass(low, [], 'AO', px, ID + '_ao', selected=False) if ao else None
    d = os.path.join(os.path.dirname(OUT), 'tex'); os.makedirs(d, exist_ok=True)
    for im, n in ((nrm, 'n'), (col, 'c'), (occ, 'ao')):
        if im: save_img(im, os.path.join(d, f'{ID}_{n}.png')); im.pack()
    low.data.materials.clear()
    low.data.materials.append(lowpoly_material(ID, col, nrm, 'Atlas', occ, rough, metal))

# --------------------------------------------------------------------------- builders
def book_row():
    """A row of 15 books: high = bevelled/subsurf covers, raised bands, page blocks; low = clean beveled boxes, baked."""
    leather = P('leather', 'brown_leather'); linen = P('linen', 'rough_linen')
    highs, lows = [], []; x = 0.0
    palette = [(0.34, 0.1, 0.09), (0.12, 0.18, 0.3), (0.2, 0.28, 0.16), (0.42, 0.3, 0.12), (0.16, 0.12, 0.1), (0.45, 0.18, 0.12), (0.1, 0.22, 0.26)]
    for i in range(15):
        w = R.uniform(0.028, 0.06); h = R.uniform(0.2, 0.31); d = R.uniform(0.15, 0.21); lean = R.uniform(-0.05, 0.05) if i in (6, 7) else 0
        col = palette[R.randrange(len(palette))]; mat = P('cover%d' % i, R.choice(['brown_leather', 'rough_linen']), tint=tuple(c * 0.55 for c in col) + (1,))
        cx = x + w / 2; x += w + 0.002
        cover = box('cv%d' % i, (w, d, h), (cx, 0, h / 2), mat, rot=(0, lean, 0)); finish(cover, 0.002, True); box_uv(cover)
        pages = box('pg%d' % i, (w - 0.008, d - 0.012, h - 0.012), (cx, 0.004, h / 2), plain('paper', (0.86, 0.8, 0.68, 1), 0.9), rot=(0, lean, 0)); finish(pages, 0.0008, True)
        parts = [cover, pages]
        for k in range(R.choice([2, 3, 4])):
            z = h * (0.12 + 0.76 * (k + 1) / 5); band = box('bd', (w + 0.003, 0.004, 0.006), (cx, -d / 2 - 0.0005, z), plain('gilt', (0.62, 0.48, 0.2, 1), 0.35, 0.8), rot=(0, lean, 0)); finish(band, 0.0008); parts.append(band)
        highs += parts
        lw = box('lw%d' % i, (w, d, h), (cx, 0, h / 2), None, rot=(0, lean, 0)); finish(lw, 0.0025, True); lows.append(lw)
    # shelf-lean bookend
    low = join(lows, 'LOD0'); bake_low(low, highs, BAKE, True, rough=0.62)
    for h in highs: bpy.data.objects.remove(h, do_unlink=True)
    return [low]

def candle(height):
    wax = plain('wax', (0.93, 0.88, 0.74, 1), 0.45); wick = plain('wick', (0.05, 0.04, 0.03, 1), 0.9)
    prof = [(0.0, 0.0), (0.0175, 0.0), (0.019, 0.004)] + [(0.019 + 0.0012 * math.sin(i * 1.7 + R.random()), height * i / 12) for i in range(1, 12)] + [(0.0185, height - 0.004), (0.016, height - 0.001), (0.007, height - 0.004), (0.0, height - 0.012)]
    body = lathe('body', prof, (0, 0, 0), wax, 48); finish(body, 0, True)
    w = cyl('wick', 0.0012, 0.0010, 0.014, (0, 0, height + 0.0005), wick, 8); finish(w, 0, False)
    drip = lathe('drip', [(0, 0), (0.0045, 0.0), (0.0045, -0.03), (0.0, -0.034)], (0.0165, 0.0, height - 0.002), wax, 16); finish(drip, 0, True)
    o = join([body, w, drip], 'LOD0'); box_uv(o, 0.5); return [o]

def window_casement():
    """Arched-top leaded casement: frame, mullions, sill, bevelled glass panes (alpha), all proper quads."""
    oak = P('oak', 'dark_planks'); glass = plain('glass', (0.82, 0.9, 0.95, 1), 0.04, 0.0, alpha=0.18)
    W, H, D, T = 1.0, 1.8, 0.14, 0.07; parts = []
    def bar(sz, loc): o = box('b', sz, loc, oak); finish(o, 0.004); parts.append(o)
    bar((T, D, H), (-W / 2 + T / 2, 0, H / 2)); bar((T, D, H), (W / 2 - T / 2, 0, H / 2)); bar((W, D, T), (0, 0, T / 2)); bar((W, D, T), (0, 0, H - T / 2))
    bar((0.035, D * 0.6, H - 2 * T), (0, 0, H / 2))
    for i in range(1, 5): bar((W - 2 * T, D * 0.6, 0.03), (0, 0, T + (H - 2 * T) * i / 5))
    bar((W + 0.16, 0.26, 0.05), (0, 0.06, -0.025)); bar((W + 0.1, 0.1, 0.06), (0, -0.04, H + 0.03))
    pane = box('glass', (W - 2 * T, 0.008, H - 2 * T), (0, 0, H / 2), glass); finish(pane, 0.001, True)
    o = join(parts, 'frame'); box_uv(o); g = pane; return [o, g]

def notice_board():
    wood = P('wood', 'rough_wood'); cork = P('cork', 'dark_planks', tint=(0.78, 0.55, 0.34, 1), rough=0.95)
    content = paintable(plain('content', (0.7, 0.55, 0.38, 1), 0.9), (0.7, 0.55, 0.38, 1))
    W, H, D = 1.6, 1.0, 0.045; out = []
    for sz, loc in [((W, D, 0.07), (0, 0, H - 0.035)), ((W, D, 0.07), (0, 0, 0.035)), ((0.07, D, H), (-W / 2 + 0.035, 0, H / 2)), ((0.07, D, H), (W / 2 - 0.035, 0, H / 2))]:
        o = box('f', sz, loc, wood); finish(o, 0.004); out.append(o)
    face = box('content', (W - 0.14, 0.01, H - 0.14), (0, 0.008, H / 2), content); finish(face, 0, True)
    # UV 0..1 across the board face: the content slot (runtime paints a canvas here)
    me = face.data; uv = me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co; uv.data[li].uv = ((v.x + (W - 0.14) / 2) / (W - 0.14), (v.z + (H - 0.14) / 2) / (H - 0.14) - 0.0)
    fr = join(out, 'frame'); box_uv(fr); return [fr, face]

def easel_gallery():
    """Studio easel: two splayed front legs, rear prop leg, cross rails, canvas tray and clamp, painted canvas on a stretcher frame (content slot). Front faces +Z (three)."""
    wood = P('wood', 'dark_planks'); brass = plain('brass', (0.62, 0.46, 0.2, 1), 0.35, 0.9)
    canvas = paintable(plain('canvas', (0.78, 0.74, 0.66, 1), 0.9), (0.78, 0.74, 0.66, 1)); parts = []
    def bar(sz, loc, rot=(0, 0, 0), m=wood, b=0.005):
        o = box('b', sz, loc, m, rot=rot); finish(o, b); parts.append(o); return o
    for sx in (-1, 1):  # front legs lean back toward the top
        bar((0.045, 0.045, 1.86), (sx * 0.3, -0.04, 0.93), rot=(math.radians(-4), 0, math.radians(sx * -5)))
    bar((0.05, 0.045, 1.7), (0, 0.38, 0.85), rot=(math.radians(13), 0, 0))             # prop leg
    bar((0.66, 0.035, 0.05), (0, -0.06, 0.55)); bar((0.66, 0.035, 0.05), (0, -0.09, 1.52))  # cross rails
    bar((0.52, 0.09, 0.03), (0, -0.14, 0.78))                                            # canvas tray
    bar((0.05, 0.09, 0.04), (0, -0.115, 1.58), m=wood)                                   # top clamp bar
    bar((0.014, 0.014, 0.16), (0, -0.155, 1.605), m=brass, b=0.002)                      # clamp screw
    bar((0.03, 0.03, 0.07), (0, -0.155, 1.675), m=brass, b=0.003)
    for z in (0.6, 1.0, 1.4): bar((0.03, 0.04, 0.02), (0.31 * (1 if z != 1.0 else -1), -0.0, z), m=brass, b=0.002)  # pegs
    frame = join(parts, 'frame'); box_uv(frame)
    sw, sh, sd = 0.62, 0.78, 0.028; zc = 1.17
    st = [box('s', sz, loc, wood) for sz, loc in [((sw, sd, 0.03), (0, -0.17, zc + sh / 2 - 0.015)), ((sw, sd, 0.03), (0, -0.17, zc - sh / 2 + 0.015)), ((0.03, sd, sh), (-sw / 2 + 0.015, -0.17, zc)), ((0.03, sd, sh), (sw / 2 - 0.015, -0.17, zc))]]
    for o in st: finish(o, 0.003)
    stretcher = join(st, 'stretcher'); box_uv(stretcher)
    face = box('canvas', (sw - 0.02, 0.006, sh - 0.02), (0, -0.188, zc), canvas); finish(face, 0, True)
    me = face.data; uv = me.uv_layers.new(name='UVMap')
    for pl in me.polygons:
        for li in pl.loop_indices:
            v = me.vertices[me.loops[li].vertex_co if False else me.loops[li].vertex_index].co; uv.data[li].uv = ((v.x + (sw - 0.02) / 2) / (sw - 0.02), (v.z + (sh - 0.02) / 2) / (sh - 0.02))  # local coords: the face object sits at zc, so world-z maths pushed v to 1.5..2.5 (clamped, streaked canvas)
    return [frame, stretcher, face]

def rug_woven():
    """2.4 x 3.2 m rug: displaced fabric weave baked to a clean grid, tasselled fringe."""
    fab = P('fab', 'fabric_pattern_07')
    low = bpy.ops.mesh.primitive_grid_add(x_subdivisions=48, y_subdivisions=64, size=1.0); low = bpy.context.active_object; low.scale = (2.4, 3.2, 1); bpy.ops.object.transform_apply(scale=True)
    me = low.data; me.materials.append(fab)
    bm = bmesh.new(); bm.from_mesh(me)
    for v in bm.verts:
        e = min(1.0, (1.2 - abs(v.co.x)) / 0.05, (1.6 - abs(v.co.y)) / 0.05); v.co.z = 0.008 + 0.006 * max(0, min(1, e)) + 0.002 * math.sin(v.co.x * 9 + v.co.y * 7)
    bm.to_mesh(me); bm.free(); box_uv(low, 1.2)
    fr = []
    for side in (-1, 1):
        for i in range(60):
            x = -1.17 + i * 0.039; t = cyl('t', 0.004, 0.0025, 0.07, (x, side * (1.6 + 0.03), 0.006), plain('fringe', (0.82, 0.76, 0.62, 1), 0.9), 6, rot=(math.pi / 2 + R.uniform(-0.15, 0.15), 0, R.uniform(-0.2, 0.2))); fr.append(t)
    f = join(fr, 'fringe'); finish(f, 0, True); finish(low, 0, True)
    return [low, f]

def loom_warp_weighted():
    """Free-standing two-post warp-weighted loom with warp threads, stone weights and a woven panel."""
    oak = P('oak', 'rough_wood'); thread = P('thread', 'rough_linen', tint=(0.88, 0.82, 0.68, 1)); wool = P('wool', 'poly_wool_herringbone', tint=(0.6, 0.18, 0.15, 1))
    stone = P('stone', 'large_sandstone_blocks_01'); parts = []
    H, W = 2.1, 1.5
    for sx in (-1, 1):
        p = box('post', (0.09, 0.09, H), (sx * W / 2, 0, H / 2), oak); finish(p, 0.006); parts.append(p)
        l = box('leg', (0.07, 0.8, 0.07), (sx * W / 2, 0.0, 0.035), oak); finish(l, 0.005); parts.append(l)
        br = box('brace', (0.05, 0.05, 1.0), (sx * W / 2, -0.35, 0.5), oak, rot=(0.6, 0, 0)); finish(br, 0.004); parts.append(br)
    top = cyl('beam', 0.045, 0.045, W + 0.3, (0, 0, H - 0.1), oak, 20, rot=(0, math.pi / 2, 0)); finish(top, 0.003); parts.append(top)
    cloth_beam = cyl('cloth', 0.04, 0.04, W + 0.12, (0, 0, H - 0.45), oak, 20, rot=(0, math.pi / 2, 0)); parts.append(cloth_beam)
    shed = cyl('shed', 0.022, 0.022, W, (0, -0.1, 0.95), oak, 12, rot=(0, math.pi / 2, 0)); parts.append(shed)
    th = []
    n = 60
    for i in range(n):
        x = -W / 2 + 0.05 + (W - 0.1) * i / (n - 1); ztop = H - 0.12; zb = 0.55 + R.uniform(-0.02, 0.02)
        t = cyl('w', 0.0017, 0.0017, ztop - zb, (x, (0.02 if i % 2 else -0.02), (ztop + zb) / 2), thread, 6); th.append(t)
    thr = join(th, 'warp')
    ws = []
    for g in range(n // 5):
        x = -W / 2 + 0.05 + (W - 0.1) * (g * 5 + 2) / (n - 1)
        o = lathe('wt', [(0.0, -0.045), (0.035, -0.04), (0.052, -0.012), (0.052, 0.012), (0.035, 0.04), (0.0, 0.045)], (x, 0, 0.5), stone, 32); o.scale = (1, 0.55, 1); ws.append(o)
    wsj = join(ws, 'weights'); finish(wsj, 0.003, True)
    cl = bpy.ops.mesh.primitive_grid_add(x_subdivisions=40, y_subdivisions=20, size=1.0); cl = bpy.context.active_object; cl.name = 'cloth'; cl.scale = (W - 0.16, 1, 0.5); bpy.ops.object.transform_apply(scale=True)
    cl.rotation_euler = (math.pi / 2, 0, 0); bpy.ops.object.transform_apply(rotation=True); cl.location = (0, -0.04, H - 0.75); cl.data.materials.append(wool)
    for v in cl.data.vertices: v.co.y += 0.012 * math.sin(v.co.x * 14) * math.cos(v.co.z * 9)
    box_uv(cl, 0.9)
    for o in parts: pass
    frame = join(parts, 'frame'); box_uv(frame); finish(thr, 0, True); box_uv(thr); box_uv(wsj)
    return [frame, thr, wsj, cl]

def hearth_stone():
    """Stone fireplace: pier/lintel surround, stone mantel, soot firebox, hearth slab. Real CC0 sandstone-block PBR set box-projected in metres (the stone courses come from the texture and its normal map, not from geometry or a bake)."""
    sand = P('sand', 'large_sandstone_blocks_01'); soot = plain('soot', (0.04, 0.035, 0.03, 1), 0.95)
    W, H, D, OW, OH = 2.3, 2.6, 0.55, 1.1, 0.95; PW = (W - OW) / 2
    stone = [box('pier_l', (PW, D, H), (-(OW / 2 + PW / 2), 0, H / 2), sand), box('pier_r', (PW, D, H), (OW / 2 + PW / 2, 0, H / 2), sand),
             box('breast', (OW, D, H - OH), (0, 0, OH + (H - OH) / 2), sand), box('hearth', (OW + 0.7, 0.55, 0.06), (0, D / 2 + 0.2, 0.03), sand)]
    stone += [box('mantel', (W + 0.3, D + 0.2, 0.12), (0, 0.08, 1.2), sand), box('lintel', (OW + 0.3, D + 0.04, 0.16), (0, 0, OH + 0.08), sand)]
    back = box('inside', (OW, 0.08, OH), (0, -D / 2 + 0.04, OH / 2), soot); finish(back, 0, True)
    for o in stone: finish(o, 0.01, True)
    st = join(stone, 'stone'); box_uv(st)
    return [st, back]


def log_pile():
    """Stacked split logs: high = displaced bark cylinders w/ ring end-grain, low = 10-sided cylinders baked."""
    bark = P('bark', 'rough_wood'); n = 7; highs, lows = [], []
    pos = [(-0.17, 0.0), (0.0, 0.0), (0.17, 0.0), (-0.085, 0.15), (0.085, 0.15), (0.0, 0.29), (-0.2, 0.3)]
    for i in range(n):
        r = R.uniform(0.065, 0.085); L = R.uniform(0.42, 0.55); x, z = pos[i]; rot = (0, math.pi / 2, R.uniform(-0.06, 0.06))
        h = cyl('h%d' % i, r, r * R.uniform(0.92, 1.05), L, (0, x, z + r), bark, 36, rot=rot); finish(h, 0, True)
        d = h.modifiers.new('d', 'DISPLACE'); t = bpy.data.textures.new('t%d' % i, 'CLOUDS'); t.noise_scale = 0.05; d.texture = t; d.strength = 0.012; d.mid_level = 0.5
        s = h.modifiers.new('s', 'SUBSURF'); s.levels = s.render_levels = 1
        bpy.context.view_layer.objects.active = h
        for m in list(h.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
        box_uv(h); highs.append(h)
        lw = cyl('l%d' % i, r, r * 0.98, L, (0, x, z + r), None, 12, rot=rot); finish(lw, 0.004, True); lows.append(lw)
    low = join(lows, 'LOD0'); bake_low(low, highs, BAKE, True, rough=0.88)
    for h in highs: bpy.data.objects.remove(h, do_unlink=True)
    return [low]

BUILD = {'book_row_a': book_row, 'book_row_b': book_row, 'candle_taper_tall': lambda: candle(0.26), 'candle_taper_mid': lambda: candle(0.16), 'candle_stub': lambda: candle(0.055),
         'window_casement': window_casement, 'easel_gallery': easel_gallery, 'notice_board': notice_board, 'rug_woven': rug_woven, 'loom_warp_weighted': loom_warp_weighted, 'hearth_stone': hearth_stone, 'log_pile': log_pile}

reset()
objs = BUILD[ID]()
# Blender is Z-up; exporter converts. Pivot: bottom-centre so JS pipeline's recentre is a no-op for most.
export_glb(OUT, [o for o in objs])
print('AUTHORED', ID, sum(len(o.data.polygons) for o in objs), 'polys')
