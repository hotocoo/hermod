"""
Nature kit shared library (run headless: blender -b --factory-startup -P build.py -- <group> [ids...]).

World convention: authored in Blender Z-up, glTF export converts to Y-up (blender -y = glTF +z = asset front). Origin at the
footprint centre on the ground. 1 world unit ~ 4 m. Every exported asset carries:
  <id>_LOD0.._LODn   meshes (clean quads/tris, UV0 = PBR atlas or tiling, UV1 = non-overlapping lightmap UV)
  COLOR_0.r          wind bend weight 0 (rooted) .. 1 (free tip); COLOR_0.g = leaf flutter weight; COLOR_0.b = branch phase (random 0..1)
  <id>_light empties named for lights, <id>_flame for flame origins (exported as nodes with extras {"kind": ...})
"""
import bpy, bmesh, math, os, sys, json, random
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
RAW = os.environ.get('NATURE_RAW', os.path.join(ROOT, '.cache', 'nature', 'raw'))
QA = os.environ.get('NATURE_QA', os.path.join(ROOT, 'docs', 'qa', 'nature'))
TAU = math.tau


def args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def lin(h):
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(((h >> 16) & 255) / 255), f(((h >> 8) & 255) / 255), f((h & 255) / 255), 1.0)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene; s.unit_settings.system = 'METRIC'; s.unit_settings.scale_length = 1.0


def setup_cycles(samples=32):
    s = bpy.context.scene; s.render.engine = 'CYCLES'; c = s.cycles; c.samples = samples; c.use_denoising = True; c.transparent_max_bounces = 96
    try:
        p = bpy.context.preferences.addons['cycles'].preferences; p.compute_device_type = 'METAL'; p.refresh_devices()
        for d in p.devices: d.use = d.type in ('METAL', 'GPU')
        c.device = 'GPU'
    except Exception:
        c.device = 'CPU'


# ---------------------------------------------------------------- numpy texture synthesis (seamless)
def _grid(n):
    y, x = np.mgrid[0:n, 0:n]; return x / n, y / n


def vnoise(n, freq, seed, stretch=(1.0, 1.0)):
    """Seamless value noise on an n x n tile (smoothstep-interpolated lattice with wrap), 0..1."""
    r = np.random.RandomState(seed); fx, fy = max(1, int(freq * stretch[0])), max(1, int(freq * stretch[1]))
    lat = r.rand(fy, fx); x, y = _grid(n); gx, gy = x * fx, y * fy
    x0, y0 = np.floor(gx).astype(int) % fx, np.floor(gy).astype(int) % fy; x1, y1 = (x0 + 1) % fx, (y0 + 1) % fy
    tx, ty = gx - np.floor(gx), gy - np.floor(gy); tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a, b = lat[y0, x0] * (1 - tx) + lat[y0, x1] * tx, lat[y1, x0] * (1 - tx) + lat[y1, x1] * tx
    return a * (1 - ty) + b * ty


def fbm(n, freq, seed, octs=5, gain=0.5, stretch=(1.0, 1.0)):
    t = np.zeros((n, n)); a = 1.0; tot = 0.0
    for o in range(octs):
        t += a * vnoise(n, freq * 2 ** o, seed + o * 17, stretch); tot += a; a *= gain
    return t / tot


def ridged(n, freq, seed, octs=4, stretch=(1.0, 1.0)):
    return 1.0 - np.abs(fbm(n, freq, seed, octs, 0.5, stretch) * 2 - 1)


def cells_f(n, cells, seed, jitter=0.9):
    """Seamless Worley F1,F2 + id via per-pixel search of the 3x3 neighbourhood of lattice cells."""
    r = np.random.RandomState(seed); jp = (r.rand(cells, cells, 2) - 0.5) * jitter; ids = r.rand(cells, cells)
    x, y = _grid(n); gx, gy = x * cells, y * cells; ci, cj = np.floor(gx).astype(int), np.floor(gy).astype(int)
    f1 = np.full((n, n), 9.0); f2 = np.full((n, n), 9.0); cid = np.zeros((n, n))
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            ii, jj = (ci + ox) % cells, (cj + oy) % cells
            px = ci + ox + 0.5 + jp[jj, ii, 0]; py = cj + oy + 0.5 + jp[jj, ii, 1]
            d = np.hypot(gx - px, gy - py); m = d < f1
            f2 = np.where(m, f1, np.minimum(f2, d)); cid = np.where(m, ids[jj, ii], cid); f1 = np.where(m, d, f1)
    return f1, f2, cid


def normal_from_height(h, strength=2.0, wrap=True):
    """Tangent-space normal map (OpenGL, +Y up as glTF expects) from a height field (0..1)."""
    if wrap:
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5; dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    else:
        dy, dx = np.gradient(h)
    n = h.shape[0]; nx, ny, nz = -dx * strength * n / 64, dy * strength * n / 64, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz); return np.stack([nx / l * 0.5 + 0.5, ny / l * 0.5 + 0.5, nz / l * 0.5 + 0.5, np.ones_like(h)], -1)


def ao_from_height(h, radius_px=6, strength=1.0):
    """Cheap cavity AO: height minus its blurred (wrapped) version."""
    k = np.zeros_like(h); b = h.copy()
    for s in (1, 2, 4):
        b = (b + np.roll(b, s * radius_px // 3 or 1, 0) + np.roll(b, -s * radius_px // 3 or 1, 0) + np.roll(b, s * radius_px // 3 or 1, 1) + np.roll(b, -s * radius_px // 3 or 1, 1)) / 5
    return np.clip(1.0 - np.clip(b - h, 0, 1) * 6 * strength, 0, 1)


def to_image(name, arr, nc=False, alpha=True, depth=8):
    """numpy (h, w, 4 or 3) float 0..1 (row 0 = TOP, glTF convention) -> packed bpy image (Blender row 0 = bottom, so flip).
    Generated images lose pixels when the colour space changes and cannot be packed, so the pixels go through a PNG file."""
    a = np.asarray(arr, dtype=np.float32)
    if a.shape[-1] == 3: a = np.concatenate([a, np.ones(a.shape[:2] + (1,), np.float32)], -1)
    h, w = a.shape[:2]; tmp = bpy.data.images.new(name + '_gen', w, h, alpha=True); tmp.colorspace_settings.name = 'Non-Color' if nc else 'sRGB'
    tmp.pixels.foreach_set(np.flipud(a).ravel()); d = os.path.join(RAW, '..', 'tex'); os.makedirs(d, exist_ok=True); p = os.path.abspath(os.path.join(d, name + '.png'))
    tmp.filepath_raw = p; tmp.file_format = 'PNG'; tmp.save_render(p) if False else tmp.save(); bpy.data.images.remove(tmp)
    im = bpy.data.images.load(p); im.name = name; im.colorspace_settings.name = 'Non-Color' if nc else 'sRGB'; im.alpha_mode = 'STRAIGHT' if alpha else 'NONE'
    im.pack(); return im


def srgb_enc(a):
    a = np.clip(a, 0, 1); return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)


def hexrgb(h): return np.array([((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255])


def ramp(t, stops):
    """Colour ramp: t array 0..1, stops [(pos, hex)] -> (..., 3) in sRGB 0..1 (hex values are sRGB, blended in sRGB for authoring ease)."""
    ps = [p for p, _ in stops]; cs = np.stack([hexrgb(c) for _, c in stops]); out = np.zeros(t.shape + (3,))
    for k in range(3): out[..., k] = np.interp(t, ps, cs[:, k])
    return out


# ---------------------------------------------------------------- materials
def _node_group_output():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g: return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat'); g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    g.nodes.new('NodeGroupInput'); return g


def pbr_material(name, base, normal, orm, uv_ao=None, alpha=False, normal_strength=1.0, tile=None, uv_name=None, emissive=None):
    """Principled material from bpy images: base (sRGB, alpha when alpha=True), normal (non-colour), orm (R occlusion, G roughness, B metal).
    uv_ao: second UV map name -> occlusion reads UV1 (lightmap UV); otherwise ORM shares UV0 with the other maps."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(bs.outputs[0], out.inputs[0])
    def tex(img, loc, uv=None):
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = img; n.location = loc; n.interpolation = 'Linear'
        if uv:
            u = nt.nodes.new('ShaderNodeUVMap'); u.uv_map = uv; nt.links.new(u.outputs[0], n.inputs[0])
        return n
    tb = tex(base, (-600, 300), uv_name); nt.links.new(tb.outputs['Color'], bs.inputs['Base Color'])
    if alpha: nt.links.new(tb.outputs['Alpha'], bs.inputs['Alpha'])
    tn = tex(normal, (-600, 0), uv_name); nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = normal_strength
    nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    to = tex(orm, (-600, -300), uv_name); sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(to.outputs['Color'], sep.inputs[0])
    nt.links.new(sep.outputs[1], bs.inputs['Roughness']); nt.links.new(sep.outputs[2], bs.inputs['Metallic'])
    if uv_ao:
        ta = tex(orm, (-600, -600), uv_ao); sa = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(ta.outputs['Color'], sa.inputs[0]); occ = sa.outputs[0]
    else: occ = sep.outputs[0]
    grp = nt.nodes.new('ShaderNodeGroup'); grp.node_tree = _node_group_output(); grp.label = 'glTF Material Output'; nt.links.new(occ, grp.inputs['Occlusion'])
    if emissive:
        bs.inputs['Emission Color'].default_value = lin(emissive[0]); bs.inputs['Emission Strength'].default_value = emissive[1]
    m['alpha'] = bool(alpha)
    return m


# ---------------------------------------------------------------- mesh helpers
class Mesh:
    """bmesh accumulator with per-vertex wind attributes (colour layer 'wind')."""

    def __init__(self):
        self.alpha_wind = False; self.bm = bmesh.new(); self.col = self.bm.loops.layers.color.new('wind'); self.uv = self.bm.loops.layers.uv.new('UVMap')

    def vert(self, p): return self.bm.verts.new(p)

    def face(self, vs, uvs, wind, mat=0, smooth=True):
        try: f = self.bm.faces.new(vs)
        except ValueError: return None
        f.material_index = mat; f.smooth = smooth
        for l, uv, w in zip(f.loops, uvs, wind): l[self.uv].uv = uv; l[self.col] = (w[0], w[1], w[2], w[0] if self.alpha_wind else 1.0)
        return f

    def finish(self, name, uv1=True):
        bm = self.bm; bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob


def tube(M, pts, radii, seg, vspan, wind_fn, uv_u0=0.0, uv_tile=1.0, mat=0, cap=False):
    """Tapered tube along polyline pts (list of Vector) with per-point radii; ring seg verts; uv v runs along length (metres->tile), u around."""
    rings = []; prev_n = None; L = 0.0; ls = [0.0]
    for i in range(1, len(pts)): L += (pts[i] - pts[i - 1]).length; ls.append(L)
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = prev_n if prev_n is not None else (Vector((0, 0, 1)) if abs(t.z) < 0.95 else Vector((1, 0, 0)))
        u = (a - t * a.dot(t)).normalized(); v = t.cross(u); prev_n = u
        rings.append([(p + (u * math.cos(TAU * j / seg) + v * math.sin(TAU * j / seg)) * radii[i]) for j in range(seg)])
    vs = [[M.vert(q) for q in r] for r in rings]
    for i in range(len(pts) - 1):
        for j in range(seg):
            j2 = (j + 1) % seg; v0, v1 = ls[i] / uv_tile, ls[i + 1] / uv_tile
            M.face([vs[i][j], vs[i][j2], vs[i + 1][j2], vs[i + 1][j]], [(uv_u0 + j / seg, v0), (uv_u0 + (j + 1) / seg, v0), (uv_u0 + (j + 1) / seg, v1), (uv_u0 + j / seg, v1)],
                   [wind_fn(pts[i]), wind_fn(pts[i]), wind_fn(pts[i + 1]), wind_fn(pts[i + 1])], mat)
    if cap:
        c = M.vert(pts[-1]); w = wind_fn(pts[-1])
        for j in range(seg): M.face([vs[-1][j], vs[-1][(j + 1) % seg], c], [(0, 0), (0, 0), (0, 0)], [w, w, w], mat)


# ---------------------------------------------------------------- LOD, UV1, AO, export
def smart_uv(ob, name, margin=0.003, angle=66):
    me = ob.data; layer = me.uv_layers.get(name) or me.uv_layers.new(name=name); me.uv_layers.active = layer
    for o in bpy.context.selected_objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin); bpy.ops.uv.pack_islands(margin=margin); bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers[0]


def tri_count(ob):
    dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); me = e.to_mesh(); me.calc_loop_triangles(); n = len(me.loop_triangles); e.to_mesh_clear(); return n


def bounds(obs):
    pts = [o.matrix_world @ Vector(c) for o in obs for c in o.bound_box]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


def add_marker(name, loc, kind, **extra):
    e = bpy.data.objects.new(name, None); e.empty_display_type = 'PLAIN_AXES'; e.empty_display_size = 0.05; e.location = loc
    e['kind'] = kind
    for k, v in extra.items(): e[k] = v
    bpy.context.scene.collection.objects.link(e); return e


def export(asset_id, objs, extra_info=None):
    """Export the given objects (LOD meshes + markers) to RAW/<id>.glb and print an ASSET json line."""
    os.makedirs(RAW, exist_ok=True)
    for o in bpy.context.scene.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    glb = os.path.join(RAW, asset_id + '.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_image_format='WEBP', export_image_quality=95, export_vertex_color='ACTIVE',
                              export_active_vertex_color_when_no_material=True, export_extras=True, export_yup=True, export_apply=False, export_texcoords=True,
                              export_attributes=True, export_unused_images=False)
    meshes = [o for o in objs if o.type == 'MESH']; lo = ([o for o in meshes if o.name.endswith('_LOD0')] or meshes)[0]
    mn, mx = bounds([lo]); info = dict(id=asset_id, tris=[tri_count(o) for o in sorted(meshes, key=lambda o: o.name)], bounds_blender=[list(mn), list(mx)], bytes=os.path.getsize(glb))
    info.update(extra_info or {}); print('ASSET', json.dumps(info), flush=True); return info


# ---------------------------------------------------------------- QA turntable (4 views contact sheet)
def turntable(asset_id, objs, size=480, dist_k=1.9, el=22, hide_others=True):
    sc = bpy.context.scene; setup_cycles(24); sc.cycles.use_denoising = True
    mn, mx = bounds([o for o in objs if o.type == 'MESH' and o.name.endswith('_LOD0')]); c = (mn + mx) / 2; r = (mx - mn).length / 2
    for o in objs:
        if o.type == 'MESH': o.hide_render = not o.name.endswith('_LOD0')
    bpy.ops.mesh.primitive_plane_add(size=max(8, r * 6), location=(c.x, c.y, mn.z - 0.002)); pl = bpy.context.active_object; pl.name = 'qa_ground'
    gm = bpy.data.materials.new('qa_g'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.36, 0.22, 1); gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    pl.data.materials.append(gm)
    w = bpy.data.worlds.new('qa'); w.use_nodes = True; bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.62, 0.74, 0.9, 1); bg.inputs['Strength'].default_value = 1.0; sc.world = w
    sun = bpy.data.objects.new('qa_sun', bpy.data.lights.new('qa_sun', 'SUN')); sun.data.energy = 4.0; sun.rotation_euler = (math.radians(50), 0, math.radians(35)); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('qa_cam', bpy.data.cameras.new('qa_cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 50
    sc.render.resolution_x = size; sc.render.resolution_y = size; sc.render.image_settings.file_format = 'PNG'; sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    shots = []; d = max(r * dist_k, 0.5) * (50 / 36) * 1.1
    for k in range(4):
        az = math.radians(k * 90 + 30); cam.location = c + Vector((math.sin(az) * math.cos(math.radians(el)), -math.cos(az) * math.cos(math.radians(el)), math.sin(math.radians(el)))) * d
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler(); p = os.path.join('/tmp', f'tt_{asset_id}_{k}.png'); sc.render.filepath = p; bpy.ops.render.render(write_still=True); shots.append(p)
    ims = [bpy.data.images.load(p) for p in shots]; arrs = [np.array(i.pixels[:], dtype=np.float32).reshape(size, size, 4) for i in ims]
    sheet = np.concatenate([np.concatenate(arrs[:2], 1), np.concatenate(arrs[2:], 1)], 0); out = bpy.data.images.new('sheet', size * 2, size * 2); out.pixels.foreach_set(sheet.ravel())
    os.makedirs(QA, exist_ok=True); out.filepath_raw = os.path.join(QA, asset_id + '.png'); out.file_format = 'PNG'; out.save()
    for p in shots: os.remove(p)
    pl.hide_render = True; sun.hide_render = True
    return out.filepath_raw


def rnd(seed): return random.Random(seed)
