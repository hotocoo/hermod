"""Card-foliage trees (trees_cards.py; the vertex-coloured no-card set lives in trees.py): real trunk and branch hierarchy (tapered tubes, root flare)
with leaf-spray cards from the atlas authored in foliage_tex. blender -b --factory-startup -P trees_cards.py -- [species ...]  (also: hedge)
One raw glb per species in .cache/nature/raw: <id>_v<k>_LOD<l> meshes (k = variant 0..2), shared bark and leaf materials, wind weights in COLOR_0 (nlib doc),
plus the far octahedral impostor <id>_imp. scripts/assets/nature-pack.mjs publishes them to public/assets/nature/<id>.glb."""
import math, random, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector, Matrix
import nlib
from nlib import Mesh, tube, to_image, pbr_material, export, turntable
import foliage_tex as ft

TAU = math.tau
SP = dict(
    oak=dict(H=2.3, r0=0.10, r1=0.032, trunk_h=0.44, f0=0.5, n1=7, ang1=(50, 78), len1=0.36, kids=3, ang2=(30, 55), len2=0.5, depth=3, tropism=0.12, droop=0.0, curv=0.22, lean=0.08, flare=0.8, roots=5,
             cl_r=0.20, cl_n=9, card=0.40, aspect=0.95, bark='oak', leaf='oak', cl_mid=True),
    birch=dict(H=2.5, r0=0.05, r1=0.016, trunk_h=0.5, f0=0.5, n1=8, ang1=(28, 50), len1=0.42, kids=3, ang2=(25, 45), len2=0.5, depth=3, tropism=0.1, droop=0.05, curv=0.28, lean=0.12, flare=0.3, roots=3,
               cl_r=0.16, cl_n=8, card=0.32, aspect=0.9, bark='birch', leaf='birch', cl_mid=True),
    apple=dict(H=1.45, r0=0.07, r1=0.025, trunk_h=0.3, f0=0.35, n1=6, ang1=(50, 78), len1=0.6, kids=3, ang2=(30, 55), len2=0.55, depth=3, tropism=0.1, droop=0.04, curv=0.3, lean=0.1, flare=0.6, roots=4,
               cl_r=0.17, cl_n=8, card=0.34, aspect=0.95, bark='apple', leaf='apple', cl_mid=True),
    willow=dict(H=2.6, r0=0.11, r1=0.04, trunk_h=0.3, f0=0.34, n1=6, ang1=(40, 65), len1=0.5, kids=7, ang2=(20, 40), len2=0.55, depth=2, tropism=-0.05, droop=0.5, curv=0.2, lean=0.12, flare=0.9, roots=5,
                cl_r=0.06, cl_n=3, card=0.34, aspect=0.45, bark='willow', leaf='willow', cl_mid=True, weep=True),
    plane=dict(H=2.9, r0=0.12, r1=0.04, trunk_h=0.42, f0=0.5, n1=7, ang1=(40, 65), len1=0.55, kids=3, ang2=(30, 52), len2=0.55, depth=3, tropism=0.1, droop=0.0, curv=0.18, lean=0.06, flare=0.8, roots=5,
               cl_r=0.24, cl_n=7, card=0.52, aspect=1.0, bark='plane', leaf='plane', cl_mid=True),
    olive=dict(H=1.55, r0=0.085, r1=0.03, trunk_h=0.25, f0=0.3, n1=6, ang1=(35, 65), len1=0.68, kids=4, ang2=(25, 50), len2=0.5, depth=3, tropism=0.1, droop=0.0, curv=0.45, lean=0.2, flare=0.5, roots=4,
               cl_r=0.16, cl_n=9, card=0.26, aspect=0.8, bark='olive', leaf='olive', cl_mid=True, strands=3),
    pine=dict(H=3.1, r0=0.07, r1=0.012, trunk_h=0.12, f0=0.14, n1=26, ang1=(78, 100), len1=0.22, kids=0, ang2=(30, 50), len2=0.4, depth=1, tropism=-0.04, droop=0.18, curv=0.12, lean=0.05, flare=0.4, roots=3,
              cl_r=0.0, cl_n=3, card=0.36, aspect=1.0, bark='pine', leaf='pine', along=True, whorl=True),
    stonepine=dict(H=2.7, r0=0.09, r1=0.03, trunk_h=0.5, f0=0.55, n1=9, ang1=(55, 80), len1=0.42, kids=3, ang2=(40, 65), len2=0.45, depth=2, tropism=0.18, droop=0.0, curv=0.22, lean=0.1, flare=0.6, roots=4,
                   cl_r=0.22, cl_n=8, card=0.46, aspect=0.95, bark='stonepine', leaf='stonepine', cl_mid=False, umbrella=True),
    poplar=dict(H=3.0, r0=0.07, r1=0.014, trunk_h=0.14, f0=0.16, n1=30, ang1=(18, 32), len1=0.16, kids=0, ang2=(20, 30), len2=0.4, depth=1, tropism=0.5, droop=0.0, curv=0.1, lean=0.03, flare=0.4, roots=4,
                cl_r=0.0, cl_n=3, card=0.34, aspect=0.8, bark='birch', leaf='poplar', along=True),
    cypress=dict(H=3.2, r0=0.06, r1=0.012, trunk_h=0.1, f0=0.1, n1=34, ang1=(14, 24), len1=0.11, kids=0, ang2=(20, 30), len2=0.4, depth=1, tropism=0.55, droop=0.0, curv=0.08, lean=0.03, flare=0.3, roots=3,
                 cl_r=0.0, cl_n=3, card=0.30, aspect=0.6, bark='cypress', leaf='cypress', along=True),
)
HEDGE = dict(H=0.5, depth=1, card=0.15, aspect=1.0, bark='apple', leaf='hedge', cl_mid=False)
SP['hedge'] = HEDGE
LODK = [dict(seg=9, cards=1.0, size=1.0, depth_cut=0), dict(seg=6, cards=0.42, size=1.5, depth_cut=1), dict(seg=4, cards=0.15, size=2.6, depth_cut=2)]
UVT = 0.5
GOLD = 2.39996


def rot_about(v, axis, a): return Matrix.Rotation(a, 3, axis) @ v


def path(R, p0, d, length, curv, tropism, droop, step=0.09, weep=False):
    pts = [p0.copy()]; n = max(3, int(length / step)); st = length / n; d = d.normalized()
    for i in range(n):
        d = (d + Vector((R.gauss(0, curv), R.gauss(0, curv), R.gauss(0, curv * 0.5))) * 0.35 + Vector((0, 0, tropism * 0.08 - droop * 0.06 * (i / n) * (1.5 if weep else 1.0)))).normalized()
        pts.append(pts[-1] + d * st)
    return pts


def structure(sp, seed):
    R = random.Random(seed); H = sp['H'] * (0.92 + 0.16 * R.random()); br = []; cl = []
    lean = Vector((R.uniform(-1, 1), R.uniform(-1, 1), 0)) * sp['lean']; th = H * max(sp['trunk_h'], sp['f0'] * 0.95)
    n_str = sp.get('strands', 1); trunks = []
    for s in range(n_str):
        off = Vector((math.cos(TAU * s / n_str), math.sin(TAU * s / n_str), 0)) * (0.02 if n_str > 1 else 0)
        t = path(R, Vector((off.x, off.y, -0.03)), Vector((lean.x + off.x * 2, lean.y + off.y * 2, 1)), th, sp['curv'] * (1.6 if n_str > 1 else 0.6), 0.25, 0, 0.1)
        if n_str > 1:
            for i, q in enumerate(t):
                a = i / len(t) * 2.6 + TAU * s / n_str; r = 0.035 * (1 - i / len(t)); t[i] = Vector((q.x * 0.5 + math.cos(a) * r, q.y * 0.5 + math.sin(a) * r, q.z))
        trunks.append(t)
    tp = trunks[0]; r0, r1 = sp['r0'] / (1.0 if n_str == 1 else 1.8), sp['r1']
    for t in trunks:
        rad = [(r0 + (r1 - r0) * (i / (len(t) - 1))) * (1 + sp['flare'] * math.exp(-max(0, t[i].z) / 0.1)) for i in range(len(t))]
        br.append(dict(pts=t, rad=rad, depth=0))
    for k in range(sp['roots']):
        a = TAU * k / sp['roots'] + R.random(); L = 0.16 + R.random() * 0.12
        br.append(dict(pts=[Vector((math.cos(a) * 0.01, math.sin(a) * 0.01, 0.06)), Vector((math.cos(a) * L * 0.5, math.sin(a) * L * 0.5, 0.025)), Vector((math.cos(a) * L, math.sin(a) * L, -0.04))], rad=[r0 * 0.55, r0 * 0.38, r0 * 0.18], depth=0))

    def branch(p, d, length, r, depth):
        pts = path(R, p, d, length, sp['curv'], sp['tropism'] * (0.6 if depth > 1 else 1), sp['droop'], 0.07 if depth > 1 else 0.09, sp.get('weep', False) and depth >= 1)
        rad = [r * (1 - 0.8 * (i / (len(pts) - 1))) for i in range(len(pts))]; br.append(dict(pts=pts, rad=rad, depth=depth))
        if depth < sp['depth']:
            for k in range(sp['kids']):
                f = 0.3 + 0.65 * (k + R.random() * 0.7) / max(1, sp['kids']); i = min(len(pts) - 2, int(f * (len(pts) - 1))); dd = (pts[i + 1] - pts[i]).normalized()
                ax = dd.cross(Vector((0, 0, 1))); ax = ax.normalized() if ax.length > 1e-3 else Vector((1, 0, 0))
                nd = rot_about(rot_about(dd, ax, math.radians(R.uniform(*sp['ang2']))), dd, k * GOLD + R.random())
                branch(pts[i], nd, length * sp['len2'] * (0.8 + 0.4 * R.random()), rad[i] * 0.6, depth + 1)
        if sp.get('along') and depth >= 1:
            for i in range(max(1, int(len(pts) * 0.35)), len(pts)):
                cl.append(dict(c=pts[i], d=(pts[min(i + 1, len(pts) - 1)] - pts[i]).normalized() if i + 1 < len(pts) else d, r=0.04, n=sp['cl_n'] + (1 if i == len(pts) - 1 else 0), depth=depth, flat=not sp.get('tropism', 0) > 0.3))
        elif depth == sp['depth'] or (depth >= 1 and sp.get('weep')):
            cl.append(dict(c=pts[-1], d=(pts[-1] - pts[-2]).normalized(), r=sp['cl_r'], n=sp['cl_n'], depth=depth, flat=False))
            if sp.get('cl_mid') and len(pts) > 3:
                i = len(pts) // 2; cl.append(dict(c=pts[i], d=(pts[i + 1] - pts[i]).normalized(), r=sp['cl_r'] * 0.8, n=max(2, sp['cl_n'] // 2), depth=depth, flat=False))
            if sp.get('weep') and len(pts) > 4:
                for i in range(2, len(pts), 2): cl.append(dict(c=pts[i], d=Vector((0.15 * R.gauss(0, 1), 0.15 * R.gauss(0, 1), -1)).normalized(), r=0.05, n=2, depth=depth, flat=False))

    nm = sp['n1']
    for i in range(nm):
        f = sp['f0'] + (1 - sp['f0']) * (i / nm) ** 0.9 if sp.get('whorl') else sp['f0'] + (1 - sp['f0']) * (i + R.random() * 0.6) / nm
        z = f * H; k = min(range(len(tp)), key=lambda j: abs(tp[j].z - z)) if z <= tp[-1].z else len(tp) - 1
        anchor = tp[k] if z <= tp[-1].z else tp[-1] + Vector((0, 0, max(0, z - tp[-1].z)))
        a = i * GOLD + R.random() * 0.5; lo, hi = sp['ang1']; el = math.radians(R.uniform(lo, hi)); d = Vector((math.sin(el) * math.cos(a), math.sin(el) * math.sin(a), math.cos(el)))
        env = (1 - f) ** (0.55 if sp.get('whorl') else 0.4) if sp.get('whorl') or sp.get('along') else (0.55 + 0.45 * math.sin(math.pi * min(1, f)))
        if sp.get('umbrella'): env = 0.6 + 0.6 * f
        br_len = sp['len1'] * H * env * (0.85 + 0.3 * R.random()); rr = max(sp['r1'], (r0 + (r1 - r0) * f) * 0.5) if not sp.get('along') else sp['r1'] * 1.6
        branch(anchor.copy(), d, br_len, rr, 1)
    if sp.get('whorl') or sp.get('along') or sp.get('umbrella'):
        top = tp[-1]; ext = path(R, top, Vector((lean.x * 0.3, lean.y * 0.3, 1)), max(0.05, H * (0.96 if not sp.get('umbrella') else 0.78) - top.z), 0.05, 0.3, 0, 0.1)
        br.append(dict(pts=ext, rad=[r1 * (1 - 0.7 * i / (len(ext) - 1)) for i in range(len(ext))], depth=0))
        if sp.get('umbrella') or sp.get('along'): cl.append(dict(c=ext[-1], d=Vector((0, 0, 1)), r=0.08, n=sp['cl_n'], depth=1, flat=False))
    return dict(H=H, br=br, cl=cl, seed=seed)


def hedge_structure(seed, length=1.0, width=0.46, h=0.5):
    R = random.Random(seed); br = []; cl = []
    for i in range(7):
        x = -length / 2 + (i + R.random() * 0.6) / 7 * length; z = (R.random() - 0.5) * width * 0.6
        pts = path(R, Vector((x, z, -0.02)), Vector((R.gauss(0, 0.2), R.gauss(0, 0.2), 1)), h * 0.8, 0.3, 0.2, 0, 0.08); br.append(dict(pts=pts, rad=[0.022 * (1 - 0.6 * k / (len(pts) - 1)) for k in range(len(pts))], depth=0))
    for k in range(70):
        x = (R.random() - 0.5) * length; a = R.random() * math.pi; r = 0.8 + 0.2 * R.random(); zz = math.cos(a) * width / 2 * r; yy = 0.08 + math.sin(a) * (h - 0.08) * r
        end = 1.0 - min(1.0, max(0.0, (abs(x) - (length / 2 - 0.1)) / 0.1)) * 0.3
        c = Vector((x, zz * end, yy)); d = Vector((R.gauss(0, 0.3), zz / (width / 2) + R.gauss(0, 0.3), yy / h + R.gauss(0, 0.3))).normalized()
        cl.append(dict(c=c, d=d, r=0.05, n=4, depth=1, flat=False))
    return dict(H=h, br=br, cl=cl, seed=seed)


def emit(M, st, sp, lod, R):
    L = LODK[lod]; H = st['H']; wf = lambda p: (min(1.0, max(0.0, p.z / H)) ** 1.25, 0.0, ((p.x * 7.13 + p.y * 3.1) % 1.0))
    for b in st['br']:
        if b['depth'] > max(0, sp['depth'] - L['depth_cut']): continue
        pts, rad = b['pts'], b['rad']
        if lod > 0 and len(pts) > 4:
            idx = list(range(0, len(pts), 2)); idx = idx if idx[-1] == len(pts) - 1 else idx + [len(pts) - 1]; pts = [pts[i] for i in idx]; rad = [rad[i] for i in idx]
        tube(M, pts, rad, max(3, L['seg'] - (1 if b['depth'] > 1 else 0)), 1.0, wf, uv_u0=0.0, uv_tile=UVT, mat=0, cap=True)
    for c in st['cl']:
        n = max(1, round(c['n'] * L['cards'])) if lod else c['n']
        size = sp['card'] * L['size'] * (0.8 + 0.4 * R.random()); asp = sp['aspect']
        for k in range(n):
            jitter = Vector((R.gauss(0, 1), R.gauss(0, 1), R.gauss(0, 1))) * (c['r'] * 0.7); pivot = c['c'] + jitter * (0.6 if lod == 0 else 0.4)
            ud = (c['d'] * 0.9 + Vector((R.gauss(0, 0.8), R.gauss(0, 0.8), R.gauss(0, 0.8)))).normalized()
            if sp.get('weep'): ud = (ud + Vector((0, 0, -1.4))).normalized()
            elif c['flat']: ud = Vector((ud.x, ud.y, ud.z * 0.35 - 0.04)).normalized()
            elif sp.get('umbrella'): ud = (ud + Vector((0, 0, 0.35))).normalized()
            side = ud.cross(Vector((R.gauss(0, 1), R.gauss(0, 1), R.gauss(0.2, 1)))); side = side.normalized() if side.length > 1e-3 else Vector((1, 0, 0))
            passes = (0, math.pi / 2) if lod < 2 else (0.6,)
            tile = R.randrange(4); tx, ty = tile % 2, tile // 2; u0, u1 = tx * 0.5 + 0.01, tx * 0.5 + 0.49; v0, v1 = 1 - (ty + 1) * 0.5 + 0.01, 1 - ty * 0.5 - 0.01
            for ph in passes:
                s2 = rot_about(side, ud, ph); U = ud * size; S = s2 * size * asp
                a, b2, c2, d2 = pivot - S / 2, pivot + S / 2, pivot + S / 2 + U, pivot - S / 2 + U; ph_ = ((pivot.x * 5.3 + pivot.y * 2.7 + k * 0.37) % 1.0)
                w0 = (min(1, max(0, pivot.z / H)) ** 1.25, 0.15, ph_); w1 = (min(1, max(0, (pivot.z + U.z) / H)) ** 1.25, 1.0, ph_)
                M.face([M.vert(a), M.vert(b2), M.vert(c2), M.vert(d2)], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], [w0, w0, w1, w1], 1, smooth=True)


def build(sid, nvar=3, seed0=7, tex=2048, bark_px=1024):
    nlib.reset(); sp = SP[sid]; hedge = sid == 'hedge'
    if hedge: seed0 = 5
    base, nrm, orm = ft.leaf_atlas(sid + '_leaf', ft.LEAF[sp['leaf']]['kind'], ft.LEAF[sp['leaf']], size=tex, seed=seed0 + 5); bb, bn, bo = ft.bark_maps(sp['bark'], bark_px, seed0 + 11)
    mb = pbr_material(sid + '_bark', to_image(sid + '_bark_bc', bb), to_image(sid + '_bark_n', bn, nc=True), to_image(sid + '_bark_orm', bo, nc=True))
    ml = pbr_material(sid + '_leaf', to_image(sid + '_leaf_bc', base), to_image(sid + '_leaf_n', nrm, nc=True), to_image(sid + '_leaf_orm', orm, nc=True), alpha=True, normal_strength=0.8); ml['doubleSided'] = True
    objs = []
    for k in range(nvar):
        st = hedge_structure(seed0 * 50 + k) if hedge else structure(sp, seed0 * 100 + k * 13 + 1)
        for lod in range(3):
            M = Mesh(); R = random.Random(seed0 * 977 + k * 31); emit(M, st, sp, lod, R); ob = M.finish(f'{sid}_v{k}_LOD{lod}'); ob.data.materials.append(mb); ob.data.materials.append(ml); objs.append(ob)
    if not hedge:  # scale so the crown matches the target height
        lo = [o for o in objs if o.name.endswith('_LOD0')]; mn, mx = nlib.bounds(lo); k = (sp['H'] * 1.06) / max(1e-3, mx.z)
        for ob in objs: ob.scale = (k, k, k)
        bpy.context.view_layer.update()
        for ob in objs:
            for o in bpy.context.selected_objects: o.select_set(False)
            ob.select_set(True); bpy.context.view_layer.objects.active = ob; bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    export(sid, objs, dict(kind='hedge' if hedge else 'tree', variants=nvar, lods=3, height=sp['H'], bark_px=bark_px, leaf_px=tex))
    return objs


if __name__ == '__main__':
    import impostor
    for s in (nlib.args() or list(SP)):
        objs = build(s); v0 = [o for o in objs if o.name.startswith(s + '_v0_')]; turntable(s, v0); impostor.bake_impostor(s, v0)
