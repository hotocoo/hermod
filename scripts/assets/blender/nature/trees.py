"""Modelled trees (no cards): branching trunk with tapered limbs and individually modelled leaves / needle fans.
blender -b --factory-startup -P trees.py -- [species ...]  ->  public/assets/nature/<species>_<variant>.glb (LOD0..2 as separate nodes <name>_LOD0..2).
Vertex colour RGB = albedo, A = wind bend weight (0 at the base, 1 at the tips) read by the wind vertex shader. World units: 1 unit ~ 4 m; heights below.
"""
import bpy, bmesh, math, os, sys, json, random
from mathutils import Vector, Matrix
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
OUT = os.environ.get('NATURE_OUT', os.path.join(ROOT, 'public', 'assets', 'nature'))
TAU = math.tau

def lin(h):
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(((h >> 16) & 255) / 255), f(((h >> 8) & 255) / 255), f((h & 255) / 255))

# species: height, trunk radius, bark, leaf colours, leaf size, leaves per lod0, crown (radius, base, top as fraction of height), branching, kind
SP = {
    'oak':    dict(h=1.7, tr=0.075, bark=0x5b4636, leaf=[0x5f7f3a, 0x6f8f42, 0x4f7034], ls=0.11, n=1100, crown=(0.62, 0.38, 1.0), br=7, kind='broad', lean=0.15),
    'birch':  dict(h=1.8, tr=0.045, bark=0xd9d3c6, leaf=[0x8fae4c, 0x9cba58, 0x7f9f42], ls=0.075, n=900, crown=(0.38, 0.4, 1.0), br=8, kind='broad', lean=0.25),
    'poplar': dict(h=2.3, tr=0.05, bark=0x6c5a47, leaf=[0x6a8d3c, 0x5b7c34], ls=0.08, n=900, crown=(0.22, 0.2, 1.0), br=10, kind='column', lean=0.05),
    'apple':  dict(h=1.0, tr=0.055, bark=0x5a4638, leaf=[0x6a8a3a, 0x7a9a45], ls=0.085, n=600, crown=(0.5, 0.45, 1.0), br=6, kind='broad', lean=0.2),
    'pine':   dict(h=2.1, tr=0.06, bark=0x4e3c2e, leaf=[0x2f4f33, 0x39593a], ls=0.2, n=520, crown=(0.38, 0.22, 1.0), br=0, kind='conifer', lean=0.04),
    'olive':  dict(h=0.95, tr=0.07, bark=0x6c6454, leaf=[0x7d8b5c, 0x93a06e, 0x6a7a4c], ls=0.09, n=800, crown=(0.62, 0.35, 1.0), br=6, kind='broad', lean=0.3),
    'plane':  dict(h=1.7, tr=0.08, bark=0x8a7f6a, leaf=[0x6f8450, 0x5f7544], ls=0.13, n=900, crown=(0.95 / 1.7 * 1.0, 0.4, 1.0), br=7, kind='broad', lean=0.15),
    'cypress':dict(h=2.0, tr=0.045, bark=0x5a4a3a, leaf=[0x3f5a3d, 0x35503a], ls=0.075, n=800, crown=(0.14, 0.08, 1.0), br=0, kind='column', lean=0.02),
}
LODS = (1.0, 0.4, 0.14)


class M:
    def __init__(s): s.bm = bmesh.new(); s.col = s.bm.loops.layers.float_color.new('Col')
    def vert(s, p): return s.bm.verts.new(p)
    def face(s, vs, c, ws):
        try: f = s.bm.faces.new(vs)
        except ValueError: return
        for lp, w in zip(f.loops, ws): lp[s.col] = (c[0], c[1], c[2], w)


def limb(m, a, b, r0, r1, c, segs=5, wa=0.0, wb=0.0):
    d = b - a; L = d.length
    if L < 1e-5: return
    z = d.normalized(); x = z.cross(Vector((0, 1, 0)) if abs(z.y) < 0.95 else Vector((1, 0, 0))).normalized(); y = z.cross(x)
    ra = [m.vert(a + (x * math.cos(TAU * i / segs) + y * math.sin(TAU * i / segs)) * r0) for i in range(segs)]
    rb = [m.vert(b + (x * math.cos(TAU * i / segs) + y * math.sin(TAU * i / segs)) * r1) for i in range(segs)]
    for i in range(segs):
        j = (i + 1) % segs; m.face([ra[i], ra[j], rb[j], rb[i]], c, (wa, wa, wb, wb))


def leaf(m, p, n, size, c, rnd, wb):
    # modelled leaf: elongated hexagon with a mid fold, oriented along random tangent
    t = n.cross(Vector((rnd.random() - .5, rnd.random() - .5, rnd.random() - .5))).normalized() if n.length > 0 else Vector((1, 0, 0))
    b = n.cross(t).normalized(); L, W = size, size * 0.55
    v0 = m.vert(p); v1 = m.vert(p + t * L * 0.3 + b * W * 0.5 + n * 0.1 * size); v2 = m.vert(p + t * L * 0.75 + b * W * 0.38 + n * 0.18 * size); v3 = m.vert(p + t * L + n * 0.12 * size)
    v4 = m.vert(p + t * L * 0.75 - b * W * 0.38 + n * 0.18 * size); v5 = m.vert(p + t * L * 0.3 - b * W * 0.5 + n * 0.1 * size)
    j = 0.85 + rnd.random() * 0.3; cc = (c[0] * j, c[1] * j, c[2] * j); w = wb
    m.face([v0, v1, v2, v3, v4, v5], cc, (w, w, w, w, w, w)); m.face([v5, v4, v3, v2, v1, v0], cc, (w, w, w, w, w, w))


def needle_fan(m, p, d, size, c, rnd, wb):
    # conifer: a fan of needle-bundle blades around a twig tip
    up = Vector((0, 1, 0)); side = d.cross(up).normalized() if abs(d.y) < 0.95 else Vector((1, 0, 0))
    for k in range(5):
        a = (k - 2) * 0.35; dd = (d * math.cos(a) + side * math.sin(a)).normalized() - up * 0.18; dd.normalize(); j = 0.85 + rnd.random() * 0.3; cc = (c[0] * j, c[1] * j, c[2] * j)
        tip = p + dd * size; mid = p + dd * size * 0.5; w = size * 0.07; nrm = dd.cross(up).normalized() * w
        v0 = m.vert(p); v1 = m.vert(mid + nrm + up * w); v2 = m.vert(tip); v3 = m.vert(mid - nrm + up * w)
        m.face([v0, v1, v2, v3], cc, (wb, wb, 1, wb)); m.face([v3, v2, v1, v0], cc, (wb, wb, 1, wb))


def build(name, sp, seed, lod):
    s = SP[sp]; rnd = random.Random(seed * 7777 + hash(sp) % 1000); m = M(); bark = lin(s['bark']); H = s['h'] * (0.9 + rnd.random() * 0.2); cr, cb, ct = s['crown']
    lodk = LODS[lod]; segs = (7, 5, 4)[lod]; leafc = [lin(c) for c in s['leaf']]
    # trunk with a gentle lean/curve
    pts = [Vector((0, 0, 0))]; lean = Vector((rnd.uniform(-1, 1), 0, rnd.uniform(-1, 1))).normalized() * s['lean'] * 0.15 * H
    top = H * (cb + 0.15 if s['kind'] != 'conifer' else 1.0)
    for i in range(1, 6): t = i / 5; pts.append(Vector((lean.x * t * t + math.sin(t * 4 + seed) * 0.01, top * t, lean.z * t * t)))
    for i in range(5):
        t0, t1 = i / 5, (i + 1) / 5
        limb(m, pts[i], pts[i + 1], s['tr'] * (1 - 0.7 * t0), s['tr'] * (1 - 0.7 * t1), bark, segs, t0 * 0.3, t1 * 0.3)
    # flared root buttress
    if lod == 0:
        for k in range(5):
            a = TAU * k / 5 + rnd.random(); limb(m, Vector((math.cos(a) * s['tr'] * 1.9, 0, math.sin(a) * s['tr'] * 1.9)), Vector((math.cos(a) * s['tr'] * 0.8, H * 0.08, math.sin(a) * s['tr'] * 0.8)), s['tr'] * 0.35, s['tr'] * 0.2, bark, 4)
    tips = []
    def branch(a, d, L, r, depth, wb):
        b = a + d * L; limb(m, a, b, r, r * 0.55, bark, max(3, segs - 2), wb, min(1, wb + 0.25))
        if depth > 0:
            for k in range(2 if depth > 1 else 3):
                nd = (d + Vector((rnd.uniform(-.7, .7), rnd.uniform(0.0, .5), rnd.uniform(-.7, .7)))).normalized(); branch(b, nd, L * rnd.uniform(0.55, 0.75), r * 0.6, depth - 1, min(1, wb + 0.25))
        else: tips.append((b, d, wb))
    if s['kind'] == 'conifer':
        # whorls of branches down the trunk, drooping
        nw = int(14 * (0.6 + 0.4 * lodk)); apex = pts[-1]
        for w_i in range(nw):
            t = 0.22 + 0.78 * w_i / nw; y = H * t; rad = cr * H * (1 - t) ** 0.9 * 1.15 + 0.03
            for k in range(5):
                a = TAU * (k / 5 + w_i * 0.37) + rnd.random() * 0.3; base = Vector((lean.x * t * t, y, lean.z * t * t)); d = Vector((math.cos(a), -0.28, math.sin(a))).normalized(); e = base + d * rad
                limb(m, base, e, s['tr'] * 0.22, s['tr'] * 0.08, bark, 3, t * 0.4, 0.8); tips.append((e, d, 0.9)); mid = base + d * rad * 0.6; tips.append((mid, d, 0.8))
    elif s['kind'] == 'column':
        nb = int(s['br'] * 2 * (0.5 + 0.5 * lodk))
        for k in range(nb):
            t = cb + (1 - cb) * (k / nb) * 0.95; y = H * t; a = TAU * k * 0.618; base = Vector((lean.x * (y / top) ** 2, y, lean.z * (y / top) ** 2)); d = Vector((math.cos(a) * 0.5, 1.0, math.sin(a) * 0.5)).normalized(); L = cr * H * (1.1 - abs(t - 0.55) * 0.8)
            branch(base, d, L, s['tr'] * 0.3, 1, t * 0.5)
    else:
        nb = max(3, int(s['br'] * (0.55 + 0.45 * lodk)))
        for k in range(nb):
            t = cb + (1 - cb) * (k / nb) * 0.8; y = top * 0.55 + H * (t - cb) * 0.6; a = TAU * k * 0.618 + rnd.random() * 0.3; base = pts[min(5, int(1 + 4 * min(1, y / top)))]
            d = Vector((math.cos(a), 0.7 + rnd.random() * 0.5, math.sin(a))).normalized(); branch(base, d, cr * H * (0.55 + rnd.random() * 0.25), s['tr'] * 0.42, 2 if lod == 0 else 1, 0.25)
        tips.append((pts[-1] + Vector((0, H * 0.18, 0)), Vector((0, 1, 0)), 0.8))
    # foliage
    n = max(40, int(s['n'] * lodk)); size = s['ls'] * (1 + 0.9 * (1 - lodk)); crown_c = Vector((lean.x * 0.6, H * (cb + 1.0) / 2 * (0.92 if s['kind'] != 'column' else 0.98), lean.z * 0.6))
    for i in range(n):
        bp, bd, wb = tips[i % len(tips)] if tips else (crown_c, Vector((0, 1, 0)), 0.8)
        if s['kind'] == 'conifer':
            needle_fan(m, bp + Vector((rnd.uniform(-1, 1), rnd.uniform(-.3, .3), rnd.uniform(-1, 1))) * 0.03, bd, size * (1.0 - 0.3 * rnd.random()), leafc[i % len(leafc)], rnd, wb)
        else:
            off = Vector((rnd.gauss(0, 1), rnd.gauss(0, 0.8), rnd.gauss(0, 1))) * (cr * H * 0.28 if s['kind'] == 'broad' else cr * H * 0.35); p = bp + off
            nrm = (p - crown_c).normalized() if (p - crown_c).length > 0.01 else Vector((0, 1, 0)); leaf(m, p, nrm, size, leafc[i % len(leafc)], rnd, min(1, wb + 0.3 + rnd.random() * 0.2))
    bmesh.ops.recalc_face_normals(m.bm, faces=m.bm.faces[:]) if False else None
    me = bpy.data.meshes.new(name); m.bm.to_mesh(me); m.bm.free(); me.update()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new(sp + '_tree'); mat.use_nodes = True; b = mat.node_tree.nodes['Principled BSDF']; vc = mat.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    mat.node_tree.links.new(vc.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.85; mat.use_backface_culling = False; me.materials.append(mat)
    for p_ in me.polygons: p_.use_smooth = True
    return ob


def main():
    ids = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(SP)
    os.makedirs(OUT, exist_ok=True); info = {}
    for sp in ids:
        for var in range(3):
            bpy.ops.wm.read_factory_settings(use_empty=True); name = f'{sp}_{var}'; root = bpy.data.objects.new(name, None); bpy.context.scene.collection.objects.link(root); tris = []
            for lod in range(3):
                ob = build(f'{name}_LOD{lod}', sp, var + 1, lod); ob.parent = root; ob.rotation_euler = (math.pi / 2, 0, 0)  # y-up to blender z-up export
                me = ob.data; me.calc_loop_triangles(); tris.append(len(me.loop_triangles))
            fn = os.path.join(OUT, name + '.glb'); bpy.ops.object.select_all(action='SELECT')
            bpy.ops.export_scene.gltf(filepath=fn, export_format='GLB', export_yup=True, export_apply=True, export_vertex_color='ACTIVE' if hasattr(bpy.types, 'x') else 'MATERIAL', export_attributes=True)
            info[name] = dict(tris=tris, height=SP[sp]['h'], bytes=os.path.getsize(fn)); print('TREE', name, tris, flush=True)
    jp = os.path.join(OUT, 'trees.stats.json'); old = json.load(open(jp)) if os.path.exists(jp) else {}; old.update(info); json.dump(old, open(jp, 'w'), indent=1)

main()
