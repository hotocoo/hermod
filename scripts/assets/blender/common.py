"""Shared Blender helpers: deterministic scene setup, PBR materials, UV projection, Cycles baking, glTF export, turntable.
Run only inside Blender: blender -b --factory-startup -P <script> -- <args>"""
import bpy, bmesh, sys, os, math, random, json, mathutils

def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = 'METRIC'; s.unit_settings.scale_length = 1.0
    return s

def setup_cycles(samples=24, gpu=True):
    s = bpy.context.scene; s.render.engine = 'CYCLES'; c = s.cycles
    c.samples = samples; c.use_denoising = False; c.device = 'CPU'
    if gpu:
        try:
            p = bpy.context.preferences.addons['cycles'].preferences
            p.compute_device_type = 'METAL'; p.refresh_devices()
            for d in p.devices: d.use = d.type == 'METAL' or d.type == 'GPU'
            c.device = 'GPU'
        except Exception as e:
            print('GPU unavailable, CPU bake:', e)

def rng(seed):
    return random.Random(seed)

# ---------- PBR materials from the pinned Poly Haven cache ----------
def pbr(name, cache, mat_id, tile_m=None, tint=None, rough=None):
    """Principled material using cached diff/nor/arm jpgs. UV mapping is done by box_uv() in metres so texel density is uniform."""
    lock = json.load(open(os.path.join(cache, 'scripts', 'assets', 'assets.lock.json')))['assets'][mat_id]
    d = os.path.join(cache, 'assets', 'cache', 'material', mat_id, lock['res'])
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(bs.outputs[0], out.inputs[0])
    def img(fn, cs):
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(os.path.join(d, fn)); n.image.colorspace_settings.name = cs; n.interpolation = 'Cubic'; return n
    base = img('diff.jpg', 'sRGB'); col = base.outputs[0]
    if tint:
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = tint; nt.links.new(col, mix.inputs[6]); col = mix.outputs[2]
    nt.links.new(col, bs.inputs['Base Color'])
    nm = img('nor.jpg', 'Non-Color'); nmap = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(nm.outputs[0], nmap.inputs['Color']); nt.links.new(nmap.outputs[0], bs.inputs['Normal'])
    if os.path.exists(os.path.join(d, 'arm.jpg')):
        arm = img('arm.jpg', 'Non-Color'); sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(arm.outputs[0], sep.inputs[0])
        nt.links.new(sep.outputs[1], bs.inputs['Roughness']); nt.links.new(sep.outputs[2], bs.inputs['Metallic'])
    if rough is not None: bs.inputs['Roughness'].default_value = rough
    m['tile_m'] = tile_m or lock.get('tileM', 2.0)
    return m

def plain(name, color, rough=0.5, metal=0.0, emit=None, alpha=None, ior=None):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color; b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit: b.inputs['Emission Color'].default_value = emit[0]; b.inputs['Emission Strength'].default_value = emit[1]
    if alpha is not None: b.inputs['Alpha'].default_value = alpha; m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    if ior: b.inputs['IOR'].default_value = ior
    return m

def paintable(m, color):
    """Give a plain material a 4x4 image so the glTF exporter keeps TEXCOORD_0; the runtime swaps the map for live content."""
    im = bpy.data.images.new(m.name + '_slot', 4, 4); im.pixels = list(color) * 16
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = im
    m.node_tree.links.new(t.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    return m

# ---------- geometry ----------
def finish(obj, bevel=0.004, weighted=True, mat=None):
    """Bevel + weighted normals + apply: the 'no hard CG edges' finish used on every authored mesh."""
    bpy.context.view_layer.objects.active = obj
    if bevel:
        b = obj.modifiers.new('bevel', 'BEVEL'); b.width = bevel; b.segments = 3; b.limit_method = 'ANGLE'; b.angle_limit = math.radians(35); b.profile = 0.6
    if weighted:
        w = obj.modifiers.new('wn', 'WEIGHTED_NORMAL'); w.keep_sharp = True; w.mode = 'FACE_AREA'
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    if hasattr(obj.data, 'shade_smooth'): obj.data.shade_smooth()
    if mat: obj.data.materials.clear(); obj.data.materials.append(mat)
    return obj

def mesh_obj(name, bm, mat=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob); ob.location = loc
    if mat: ob.data.materials.append(mat)
    return ob

def box(name, size, loc, mat=None, rot=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    ob = mesh_obj(name, bm, mat, loc); ob.rotation_euler = rot; return ob

def cyl(name, r1, r2, h, loc, mat=None, seg=24, rot=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=h)
    ob = mesh_obj(name, bm, mat, loc); ob.rotation_euler = rot; return ob

def lathe(name, profile, loc, mat=None, seg=48):
    """profile: [(radius, z)] bottom to top; quad-topology revolve."""
    bm = bmesh.new(); vs = [bm.verts.new((r, 0, z)) for r, z in profile]
    for a, b in zip(vs, vs[1:]): bm.edges.new((a, b))
    bmesh.ops.spin(bm, geom=list(bm.verts) + list(bm.edges), cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=seg)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, mat, loc)

def join(objs, name):
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); o = bpy.context.active_object; o.name = name; return o

def box_uv(obj, tile_m=None):
    """World-scale box projection (uv = metres / tile_m): uniform texel density across every authored asset."""
    if tile_m is None:
        mats = [m for m in obj.data.materials if m and 'tile_m' in m]; tile_m = mats[0]['tile_m'] if mats else 2.0
    me = obj.data
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    uv = me.uv_layers[0]; M = obj.matrix_world
    for poly in me.polygons:
        n = (M.to_3x3() @ poly.normal); ax = max(range(3), key=lambda i: abs(n[i])); u, v = [(1, 2), (0, 2), (0, 1)][ax]
        mt = mats_tile(obj, poly.material_index, tile_m)
        for li in poly.loop_indices:
            p = M @ me.vertices[me.loops[li].vertex_index].co; uv.data[li].uv = (p[u] / mt, p[v] / mt)

def mats_tile(obj, idx, default):
    ms = obj.data.materials
    return ms[idx]['tile_m'] if idx < len(ms) and ms[idx] and 'tile_m' in ms[idx] else default

def smart_uv(obj, name='Atlas', margin=0.003, angle=66):
    me = obj.data
    layer = me.uv_layers.get(name) or me.uv_layers.new(name=name); me.uv_layers.active = layer
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=margin, rotate=True); bpy.ops.object.mode_set(mode='OBJECT')

# ---------- baking ----------
def new_image(name, px, color=(0.5, 0.5, 1, 1), non_color=True):
    im = bpy.data.images.new(name, px, px, alpha=False); im.generated_color = color; im.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'; return im

def bake_pass(low, high_objs, kind, px, name, extrusion=0.02, ray=0.06, margin=8, selected=True, pass_filter=None, normal_space='TANGENT'):
    """Bake `kind` (NORMAL/DIFFUSE/AO/ROUGHNESS) from highs onto low into a new image; returns the image."""
    im = new_image(name, px, (0.5, 0.5, 1, 1) if kind == 'NORMAL' else (1, 1, 1, 1), non_color=kind != 'DIFFUSE')
    if not low.data.materials: low.data.materials.append(bpy.data.materials.new('bakeTmp'))
    mat = low.data.materials[0]; mat.use_nodes = True; nt = mat.node_tree
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = im; tn.select = True; nt.nodes.active = tn
    for o in bpy.context.selected_objects: o.select_set(False)
    for h in high_objs: h.select_set(True)
    low.select_set(True); bpy.context.view_layer.objects.active = low
    kw = dict(type=kind, use_selected_to_active=selected and bool(high_objs), cage_extrusion=extrusion, max_ray_distance=ray, margin=margin, margin_type='EXTEND', use_clear=True)
    if kind == 'NORMAL': kw['normal_space'] = normal_space
    if kind == 'DIFFUSE': kw['pass_filter'] = pass_filter or {'COLOR'}
    bpy.ops.object.bake(**kw)
    nt.nodes.remove(tn); return im

def save_img(im, path, fmt='PNG'):
    im.filepath_raw = path; im.file_format = fmt; im.save(); return path

def lowpoly_material(name, base=None, normal=None, ao_uv=None, ao=None, rough=0.6, metal=0.0, vcol=False):
    """Principled with baked maps; AO goes to glTF occlusion via the 'glTF Material Output' group (exporter convention)."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); nt.links.new(bs.outputs[0], out.inputs[0])
    bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal
    def tex(im, cs, uvname=None):
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = im; im.colorspace_settings.name = cs
        if uvname:
            u = nt.nodes.new('ShaderNodeUVMap'); u.uv_map = uvname; nt.links.new(u.outputs[0], n.inputs[0])
        return n
    if base: nt.links.new(tex(base, 'sRGB').outputs[0], bs.inputs['Base Color'])
    if normal:
        nmap = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tex(normal, 'Non-Color').outputs[0], nmap.inputs['Color']); nt.links.new(nmap.outputs[0], bs.inputs['Normal'])
    if ao:
        g = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        if 'Occlusion' not in [i.name for i in g.interface.items_tree]: g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = g; sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(tex(ao, 'Non-Color', ao_uv).outputs[0], sep.inputs[0]); nt.links.new(sep.outputs[0], gn.inputs['Occlusion'])
    return m

# ---------- export / preview ----------
def export_glb(path, objs=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in (objs or [o for o in bpy.context.scene.objects if o.type == 'MESH']): o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials='EXPORT', export_image_format='AUTO', export_vertex_color='ACTIVE',
        export_cameras=False, export_lights=False, export_animations=False, export_draco_mesh_compression_enable=False)

def turntable(glb, out_dir, name, frames=(0, 120, 240), px=512):
    """Render PNG turntable stills of a glb with a fixed 3-point rig (QA only)."""
    reset(); setup_cycles(32, True); s = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=glb)
    objs = [o for o in s.objects if o.type == 'MESH']
    mn = mathutils.Vector((1e9,) * 3); mx = mathutils.Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    ctr = (mn + mx) / 2; r = (mx - mn).length / 2
    world = bpy.data.worlds.new('w'); s.world = world; world.use_nodes = True; world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.57, 0.6, 1); world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    bpy.ops.mesh.primitive_plane_add(size=r * 8, location=(ctr.x, ctr.y, mn.z)); f = bpy.context.active_object; f.data.materials.append(plain('floor', (0.5, 0.5, 0.5, 1), 0.9))
    for loc, e in [((r * 2, -r * 2, r * 2.4), 900), ((-r * 2.5, -r, r), 300)]:
        bpy.ops.object.light_add(type='AREA', location=(ctr.x + loc[0], ctr.y + loc[1], ctr.z + loc[2])); L = bpy.context.active_object; L.data.energy = e * r * r; L.data.size = r * 2
        d = ctr - L.location; L.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.camera_add(); cam = bpy.context.active_object; s.camera = cam; cam.data.lens = 60
    s.render.resolution_x = s.render.resolution_y = px; s.render.image_settings.file_format = 'PNG'; s.cycles.samples = 48; s.cycles.use_denoising = True
    for fr in frames:
        a = math.radians(fr); dist = r * 3.4
        cam.location = (ctr.x + math.sin(a) * dist, ctr.y - math.cos(a) * dist, ctr.z + r * 0.9); cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
        s.render.filepath = os.path.join(out_dir, f'{name}_{fr:03d}.png'); bpy.ops.render.render(write_still=True)
