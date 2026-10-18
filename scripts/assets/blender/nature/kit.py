"""Prop kit: every prop is authored twice from one builder (hi=True high-poly detail, hi=False clean-quad game mesh) with procedural node
materials, then baked (colour, normal, AO, roughness, metallic) from hi onto the unwrapped game mesh and exported as LOD0..2 with PBR maps.
UV0 is a non-overlapping atlas (also exported as TEXCOORD_1 for the lightmap pass). World axes while building: x east, y up, +z front;
rotated into Blender Z-up at the end so the exported glTF matches (front = +z, origin = footprint centre on the ground)."""
import math, os, sys, random, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Matrix, Vector
import nlib
from nlib import lin, setup_cycles, export, turntable, add_marker, tri_count, RAW, ROOT

TAU = math.tau


# ---------------------------------------------------------------- procedural materials (node graphs, baked later)
def _mk(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(bs.outputs[0], out.inputs[0]); return m, nt, bs


def _ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB'); e = r.color_ramp
    while len(e.elements) > len(stops): e.elements.remove(e.elements[-1])
    while len(e.elements) < len(stops): e.elements.new(0.5)
    for el, (p, h) in zip(e.elements, stops): el.position = p; el.color = lin(h)
    nt.links.new(fac, r.inputs['Fac']); return r


def _noise(nt, scale, detail=6.0, rough=0.55, vec=None, kind='noise', scale_vec=None):
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    c = nt.nodes.new('ShaderNodeTexCoord'); src = c.outputs['Object']
    if scale_vec is not None:
        mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = scale_vec; nt.links.new(src, mp.inputs['Vector']); src = mp.outputs[0]
    nt.links.new(src, n.inputs['Vector']); return n


def mat_wood(name, hexes=(0x4a3320, 0x7a5636, 0xa27b4f), grain=40, rough=0.78):
    m, nt, bs = _mk(name); n1 = _noise(nt, grain, 8, 0.6, scale_vec=(1.0, 0.07, 1.0)); n2 = _noise(nt, 6, 4, 0.5)
    mix = nt.nodes.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'; nt.links.new(n1.outputs['Fac'], mix.inputs[0]); mix.inputs[1].default_value = 0.7; nt.links.new(n2.outputs['Fac'], mix.inputs[2])
    r = _ramp(nt, mix.outputs[0], [(0.3, hexes[0]), (0.55, hexes[1]), (0.85, hexes[2])]); nt.links.new(r.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = rough; bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35; nt.links.new(n1.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs[0], bs.inputs['Normal']); return m


def mat_metal(name, hexes=(0x1b1b1d, 0x3a3a3e), rough=0.5, metal=1.0, rust=0.0):
    m, nt, bs = _mk(name); n = _noise(nt, 18, 8, 0.6); r = _ramp(nt, n.outputs['Fac'], [(0.35, hexes[0]), (0.7, hexes[1])])
    if rust > 0:
        n2 = _noise(nt, 5, 6, 0.6); rr = _ramp(nt, n2.outputs['Fac'], [(1 - rust - 0.02, 0x000000), (1 - rust + 0.02, 0xffffff)]); rc = _ramp(nt, n.outputs['Fac'], [(0.3, 0x5a2e14), (0.8, 0x8a4a22)])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; nt.links.new(rr.outputs['Color'], mx.inputs['Factor']); nt.links.new(r.outputs['Color'], mx.inputs['A']); nt.links.new(rc.outputs['Color'], mx.inputs['B']); nt.links.new(mx.outputs['Result'], bs.inputs['Base Color'])
        bs.inputs['Metallic'].default_value = metal * (1 - rust * 0.7)
    else: nt.links.new(r.outputs['Color'], bs.inputs['Base Color']); bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough; return m


def mat_stone(name, hexes=(0x6e6a60, 0x9a9486, 0xc2bcac), scale=9, rough=0.9, moss=0.0):
    m, nt, bs = _mk(name); n = _noise(nt, scale * 3, 8, 0.65); n2 = _noise(nt, scale, 5, 0.5); a = nt.nodes.new('ShaderNodeMath'); a.operation = 'ADD'; nt.links.new(n.outputs['Fac'], a.inputs[0]); nt.links.new(n2.outputs['Fac'], a.inputs[1])
    d = nt.nodes.new('ShaderNodeMath'); d.operation = 'MULTIPLY'; d.inputs[1].default_value = 0.5; nt.links.new(a.outputs[0], d.inputs[0]); r = _ramp(nt, d.outputs[0], [(0.25, hexes[0]), (0.55, hexes[1]), (0.8, hexes[2])])
    nt.links.new(r.outputs['Color'], bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = rough; bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.5; nt.links.new(n.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs[0], bs.inputs['Normal'])
    if moss > 0:
        n3 = _noise(nt, 4, 5, 0.6); mr = _ramp(nt, n3.outputs['Fac'], [(1 - moss - 0.03, 0x000000), (1 - moss + 0.03, 0xffffff)]); mc = _ramp(nt, n.outputs['Fac'], [(0.2, 0x3a5224), (0.8, 0x6b8a3a)])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; nt.links.new(mr.outputs['Color'], mx.inputs['Factor']); nt.links.new(r.outputs['Color'], mx.inputs['A']); nt.links.new(mc.outputs['Color'], mx.inputs['B']); nt.links.new(mx.outputs['Result'], bs.inputs['Base Color'])
    return m


def mat_cloth(name, hexes=(0x7a2a24, 0xa33b32), weave=260, rough=0.92):
    m, nt, bs = _mk(name); c = nt.nodes.new('ShaderNodeTexCoord'); w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.inputs['Scale'].default_value = weave; w.inputs['Distortion'].default_value = 0.6
    w2 = nt.nodes.new('ShaderNodeTexWave'); w2.wave_type = 'BANDS'; w2.bands_direction = 'Z'; w2.inputs['Scale'].default_value = weave; nt.links.new(c.outputs['Object'], w.inputs['Vector']); nt.links.new(c.outputs['Object'], w2.inputs['Vector'])
    s = nt.nodes.new('ShaderNodeMath'); s.operation = 'ADD'; nt.links.new(w.outputs['Fac'], s.inputs[0]); nt.links.new(w2.outputs['Fac'], s.inputs[1]); n = _noise(nt, 3.0, 4, 0.5)
    mm = nt.nodes.new('ShaderNodeMath'); mm.operation = 'MULTIPLY_ADD'; mm.inputs[1].default_value = 0.25; nt.links.new(s.outputs[0], mm.inputs[0]); nt.links.new(n.outputs['Fac'], mm.inputs[2])
    r = _ramp(nt, mm.outputs[0], [(0.2, hexes[0]), (0.8, hexes[1])]); nt.links.new(r.outputs['Color'], bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = rough; bs.inputs['Sheen Weight'].default_value = 0.3
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.3; nt.links.new(s.outputs[0], bump.inputs['Height']); nt.links.new(bump.outputs[0], bs.inputs['Normal']); return m


def mat_flat(name, hex_, rough=0.8, metal=0.0, noise=0.12):
    m, nt, bs = _mk(name); n = _noise(nt, 14, 6, 0.6); r = _ramp(nt, n.outputs['Fac'], [(0.3, _shade(hex_, 1 - noise)), (0.7, _shade(hex_, 1 + noise))]); nt.links.new(r.outputs['Color'], bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal; return m


def mat_straw(name, hexes=(0x8a6a2a, 0xd2b055)):
    m, nt, bs = _mk(name); n = _noise(nt, 90, 8, 0.6, scale_vec=(1.0, 1.0, 0.06)); r = _ramp(nt, n.outputs['Fac'], [(0.3, hexes[0]), (0.7, hexes[1])]); nt.links.new(r.outputs['Color'], bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.85
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.5; nt.links.new(n.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs[0], bs.inputs['Normal']); return m


def mat_rope(name, hexes=(0x8a7448, 0xc2aa72)):
    m, nt, bs = _mk(name); c = nt.nodes.new('ShaderNodeTexCoord'); w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'SAW'; w.inputs['Scale'].default_value = 120; w.inputs['Distortion'].default_value = 2.0; nt.links.new(c.outputs['UV'], w.inputs['Vector'])
    r = _ramp(nt, w.outputs['Fac'], [(0.2, hexes[0]), (0.9, hexes[1])]); nt.links.new(r.outputs['Color'], bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.95
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.6; nt.links.new(w.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs[0], bs.inputs['Normal']); return m


def mat_glow(name, hex_, strength=6.0):
    m, nt, bs = _mk(name); bs.inputs['Base Color'].default_value = lin(hex_); bs.inputs['Emission Color'].default_value = lin(hex_); bs.inputs['Emission Strength'].default_value = strength; bs.inputs['Roughness'].default_value = 0.3; return m


def _shade(h, k):
    r, g, b = (h >> 16) & 255, (h >> 8) & 255, h & 255; f = lambda c: max(0, min(255, int(c * k))); return (f(r) << 16) | (f(g) << 8) | f(b)


# ---------------------------------------------------------------- builder
class B:
    """Mesh accumulator (world axes, y up). hi selects the high-poly variant of every primitive. Materials are registered by name."""

    def __init__(self, hi, mats):
        self.hi = hi; self.bm = bmesh.new(); self.mats = mats; self.names = list(mats); self.idx = {n: i for i, n in enumerate(self.names)}; self.fr = [Matrix.Identity(4)]

    def push(self, x=0.0, y=0.0, z=0.0, yaw=0.0, pitch=0.0, roll=0.0):
        m = Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Z'); self.fr.append(self.fr[-1] @ m); return self

    def pop(self): self.fr.pop(); return self

    def _v(self, p): return self.bm.verts.new(self.fr[-1] @ Vector(p))

    def _f(self, vs, mat, smooth=True):
        try: f = self.bm.faces.new(vs)
        except ValueError: return None
        f.material_index = self.idx[mat]; f.smooth = smooth; return f

    def box(self, cx, y0, cz, w, h, d, mat, bevel=0.012, yaw=0.0):
        """Box centred on (cx, cz) from y0 to y0+h with beveled edges (bmesh bevel; more segments at high detail)."""
        self.push(cx, y0 + h / 2, cz, yaw)
        vs = [self._v((sx * w / 2, sy * h / 2, sz * d / 2)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        fs = []
        for idx in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)): f = self._f([vs[i] for i in idx], mat, False); fs.append(f)
        self.pop()
        if bevel > 0:
            ed = list({e for f in fs if f for e in f.edges}); bmesh.ops.bevel(self.bm, geom=ed + [v for f in fs if f for v in f.verts], offset=min(bevel, w / 3, h / 3, d / 3), segments=3 if self.hi else 1, profile=0.6, affect='EDGES')
        return self

    def cyl(self, cx, y0, cz, r0, r1, h, mat, seg=None, caps=True, axis='y', yaw=0.0, bevel=0.0, hole=0.0):
        """Tapered cylinder (r0 bottom, r1 top). axis 'x' or 'z' lays it down (spans h along that axis, centred on cx/cz, y0 is the axis height)."""
        seg = seg or (24 if self.hi else 12); self.push(cx, y0, cz, yaw)
        if axis == 'x': self.push(0, 0, 0, 0, 0, math.pi / 2); self.push(-0.0, 0, 0)
        elif axis == 'z': self.push(0, 0, 0, 0, math.pi / 2, 0)
        a = [self._v((math.cos(TAU * j / seg) * r0, (-h / 2 if axis != 'y' else 0), math.sin(TAU * j / seg) * r0)) for j in range(seg)]
        b = [self._v((math.cos(TAU * j / seg) * r1, (h / 2 if axis != 'y' else h), math.sin(TAU * j / seg) * r1)) for j in range(seg)]
        for j in range(seg): self._f([a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]], mat, True)
        if caps:
            ca = self._v((0, (-h / 2 if axis != 'y' else 0), 0)); cb = self._v((0, (h / 2 if axis != 'y' else h), 0))
            for j in range(seg): self._f([a[(j + 1) % seg], a[j], ca], mat, False); self._f([b[j], b[(j + 1) % seg], cb], mat, False)
        if axis == 'x': self.pop(); self.pop()
        elif axis == 'z': self.pop()
        self.pop(); return self

    def lathe(self, cx, y0, cz, prof, mat, seg=None, closed=True, yaw=0.0, sx=1.0, sz=1.0):
        """Surface of revolution of [(r, y)] bottom to top with cap fans."""
        seg = seg or (32 if self.hi else 14); self.push(cx, y0, cz, yaw); rings = [[self._v((math.cos(TAU * j / seg) * r * sx, y, math.sin(TAU * j / seg) * r * sz)) for j in range(seg)] for r, y in prof]
        for i in range(len(rings) - 1):
            for j in range(seg): self._f([rings[i][j], rings[i][(j + 1) % seg], rings[i + 1][(j + 1) % seg], rings[i + 1][j]], mat, True)
        if closed:
            t = self._v((0, prof[-1][1], 0)); bt = self._v((0, prof[0][1], 0))
            for j in range(seg): self._f([rings[-1][j], rings[-1][(j + 1) % seg], t], mat, True); self._f([rings[0][(j + 1) % seg], rings[0][j], bt], mat, True)
        self.pop(); return self

    def sweep(self, pts, radii, mat, seg=None, closed_ends=True):
        """Tube along a polyline of (x, y, z) points with per-point radii."""
        seg = seg or (12 if self.hi else 6); P = [Vector(p) for p in pts]; rings = []; prev = None
        for i, p in enumerate(P):
            t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized(); a = prev if prev is not None else (Vector((0, 1, 0)) if abs(t.y) < 0.95 else Vector((1, 0, 0))); u = (a - t * a.dot(t)).normalized(); v = t.cross(u); prev = u
            rings.append([self._v(p + (u * math.cos(TAU * j / seg) + v * math.sin(TAU * j / seg)) * radii[i]) for j in range(seg)])
        for i in range(len(P) - 1):
            for j in range(seg): self._f([rings[i][j], rings[i][(j + 1) % seg], rings[i + 1][(j + 1) % seg], rings[i + 1][j]], mat, True)
        if closed_ends:
            for ring, rev in ((rings[0], True), (rings[-1], False)):
                c = self._v(sum((Vector(v.co) for v in ring), Vector()) / len(ring) if False else (self.fr[-1].inverted() @ (sum((v.co for v in ring), Vector()) / len(ring))))
                for j in range(seg): self._f([ring[(j + 1) % seg], ring[j], c] if rev else [ring[j], ring[(j + 1) % seg], c], mat, True)
        return self

    def prism_poly(self, poly, y0, h, mat, bevel=0.0):
        """Extrude a closed (x, z) polygon (counter-clockwise seen from +y) from y0 up by h."""
        a = [self._v((x, y0, z)) for x, z in poly]; b = [self._v((x, y0 + h, z)) for x, z in poly]; n = len(poly)
        for i in range(n): self._f([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]], mat, False)
        self._f(b, mat, False); self._f(list(reversed(a)), mat, False); return self

    def quad(self, p0, p1, p2, p3, mat, smooth=False): return self._f([self._v(p0), self._v(p1), self._v(p2), self._v(p3)], mat, smooth)

    def sphere(self, cx, cy, cz, r, mat, sx=1.0, sy=1.0, sz=1.0, seg=None):
        seg = seg or (24 if self.hi else 10); rings = max(5, seg // 2); prof = [(math.sin(math.pi * i / rings) * r, -math.cos(math.pi * i / rings) * r * sy) for i in range(rings + 1)]
        return self.lathe(cx, cy, cz, [(max(1e-4, rr), yy) for rr, yy in prof], mat, seg, False, 0.0, sx, sz)

    def finish(self, name, rot_x=True):
        bm = self.bm; bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        if rot_x: me.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
        for m in self.mats.values(): me.materials.append(m)
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob


# ---------------------------------------------------------------- finishing, baking and export
def _select(*obs):
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[-1]


def smooth_weighted(ob, angle=34, bevel=0.0):
    """Weighted normals + auto-smooth by angle (bevel optional); applied so export carries final normals."""
    _select(ob)
    if bevel > 0:
        b = ob.modifiers.new('bevel', 'BEVEL'); b.width = bevel; b.segments = 2; b.limit_method = 'ANGLE'; b.angle_limit = math.radians(40); b.profile = 0.6
    ob.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True
    for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception: ob.data.shade_smooth()


def unwrap(ob, margin=0.004, angle=62):
    _select(ob); me = ob.data
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.6); bpy.ops.uv.average_islands_scale(); bpy.ops.uv.pack_islands(margin=margin); bpy.ops.object.mode_set(mode='OBJECT')


def _new_img(name, size, color, nc):
    im = bpy.data.images.new(name, size, size, alpha=False); im.generated_color = color; im.colorspace_settings.name = 'Non-Color' if nc else 'sRGB'; return im


def _bake(lo, hi, kind, img, **kw):
    mats = list(lo.data.materials); nodes = []
    for m in mats:
        nt = m.node_tree; tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img; nt.nodes.active = tn; tn.select = True; nodes.append((nt, tn))
    _select(hi, lo)
    args = dict(type=kind, margin=12, margin_type='EXTEND', target='IMAGE_TEXTURES', use_clear=True)
    if hi is not lo: args.update(use_selected_to_active=True, cage_extrusion=kw.pop('ext', 0.025), max_ray_distance=kw.pop('ray', 0.12))
    if kind == 'NORMAL': args['normal_space'] = 'TANGENT'
    if kind == 'DIFFUSE': args['pass_filter'] = {'COLOR'}
    bpy.ops.object.bake(**args)
    for nt, tn in nodes: nt.nodes.remove(tn)


def _emit_bake(lo, hi, img, getter):
    """Bake a per-material scalar through emission (roughness or metallic constants on the Principled node)."""
    saved = []
    for ob in {lo, hi}:
        for m in ob.data.materials:
            nt = m.node_tree; bs = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]; out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]; em = nt.nodes.new('ShaderNodeEmission')
            sock = bs.inputs[getter];
            if sock.links: nt.links.new(sock.links[0].from_socket, em.inputs['Color'])
            else: em.inputs['Color'].default_value = (sock.default_value,) * 3 + (1,)
            old = out.inputs['Surface'].links[0].from_socket; nt.links.new(em.outputs[0], out.inputs['Surface']); saved.append((nt, out, old, em))
    _bake(lo, hi, 'EMIT', img)
    for nt, out, old, em in saved: nt.links.new(old, out.inputs['Surface']); nt.nodes.remove(em)


def bake_prop(asset_id, build_fn, size=2048, lods=(1.0, 0.42, 0.14), ao_strength=0.9, extrusion=0.03, normal_noise=True):
    """build_fn(hi: bool) -> list of builder results for one asset; returns (objs, markers). Bakes colour/normal/AO/roughness/metal onto the game mesh."""
    nlib.reset(); setup_cycles(24); sc = bpy.context.scene; sc.cycles.samples = 24
    hi = build_fn(True); lo = build_fn(False); hi.name = asset_id + '_hi'; lo.name = asset_id + '_LOD0'
    smooth_weighted(lo, bevel=0.0)
    unwrap(lo)
    mats = list(lo.data.materials)
    ic = _new_img(asset_id + '_bc', size, (0.5, 0.5, 0.5, 1), False); inn = _new_img(asset_id + '_n', size, (0.5, 0.5, 1, 1), True); iao = _new_img(asset_id + '_ao', size, (1, 1, 1, 1), True)
    ir = _new_img(asset_id + '_r', size, (0.8, 0.8, 0.8, 1), True); im_ = _new_img(asset_id + '_m', size, (0, 0, 0, 1), True)
    _bake(lo, hi, 'DIFFUSE', ic, ext=extrusion); _bake(lo, hi, 'NORMAL', inn, ext=extrusion); sc.cycles.samples = 64; _bake(lo, hi, 'AO', iao, ext=extrusion); sc.cycles.samples = 8
    _emit_bake(lo, hi, ir, 'Roughness'); _emit_bake(lo, hi, im_, 'Metallic')
    def px(i): a = np.empty(size * size * 4, np.float32); i.pixels.foreach_get(a); return a.reshape(size, size, 4)
    base = px(ic); ao = px(iao)[..., :1]; base[..., :3] *= (1 - ao_strength * 0.5) + ao_strength * 0.5 * ao  # AO also lightly multiplied into colour for unlit mips
    orm = np.concatenate([ao, px(ir)[..., :1], px(im_)[..., :1], np.ones((size, size, 1), np.float32)], -1); nrm = px(inn)
    # flip to top-first convention expected by nlib.to_image (Blender rows are bottom-first)
    flip = lambda a: np.flipud(a)
    imgs = dict(bc=nlib.to_image(asset_id + '_pbr_bc', flip(base), alpha=False), n=nlib.to_image(asset_id + '_pbr_n', flip(nrm), nc=True, alpha=False), orm=nlib.to_image(asset_id + '_pbr_orm', flip(orm), nc=True, alpha=False))
    # replace materials on the game mesh by one PBR material (single draw call)
    pm = nlib.pbr_material(asset_id, imgs['bc'], imgs['n'], imgs['orm'], uv_ao='UVMap')
    lo.data.materials.clear(); lo.data.materials.append(pm)
    for p in lo.data.polygons: p.material_index = 0
    # UV1 = copy of the non-overlapping atlas UV: lightmap UV set
    uv0 = lo.data.uv_layers[0]; uv1 = lo.data.uv_layers.new(name='Lightmap')
    for l in lo.data.loops: uv1.data[l.index].uv = uv0.data[l.index].uv
    lo.data.uv_layers.active_index = 0
    bpy.data.objects.remove(hi, do_unlink=True)
    objs = [lo]
    for i, ratio in enumerate(lods[1:], 1):
        c = lo.copy(); c.data = lo.data.copy(); c.name = f'{asset_id}_LOD{i}'; bpy.context.scene.collection.objects.link(c); m = c.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = False; objs.append(c)
    for c in objs[1:]:
        _select(c); bpy.ops.object.modifier_apply(modifier='dec')
    return objs, dict(size=size)
