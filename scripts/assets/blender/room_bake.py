"""Per-room lightmap: assemble shell + structural furniture proxies, bake sky/sun irradiance with Cycles into a UV2 atlas, export shell glb (UV0 kept, UV1 = lightmap).
blender -b --factory-startup -P room_bake.py -- <room.json> <proxyDir> <out.glb> <out_lm.png> <px>"""
import sys, os, json, math, bpy, bmesh, mathutils
sys.path.insert(0, os.path.dirname(__file__))
from common import argv, reset, setup_cycles
src, proxies, out, lm_out, px = argv()[0], argv()[1], argv()[2], argv()[3], int(argv()[4])
D = json.load(open(src)); W, DD, H = D['w'], D['d'], D['h']
reset(); setup_cycles(96, True); s = bpy.context.scene
B = lambda x, y, z: (x, -z, y)  # three (y up) -> blender (z up)
# shell parts -> one mesh, material slot per part (named by manifest material id so the runtime can rebind PBR sets)
bm = bmesh.new(); uv0 = bm.loops.layers.uv.new('UVMap'); mats = []
for part in D['shell']:
    mi = len(mats); m = bpy.data.materials.new(part['material'] + '::' + part['name']); m.use_nodes = True; mats.append(m)
    P, U = part['positions'], part['uv']
    for t in range(0, len(P) // 9):
        vs = [bm.verts.new(B(*P[(t * 3 + k) * 3:(t * 3 + k) * 3 + 3])) for k in range(3)]
        try: f = bm.faces.new(vs)
        except ValueError: continue
        f.material_index = mi
        for k, l in enumerate(f.loops): l[uv0].uv = (U[(t * 3 + k) * 2], U[(t * 3 + k) * 2 + 1])
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
me = bpy.data.meshes.new('shell')
for m in mats: me.materials.append(m)
bm.to_mesh(me); bm.free()
shell = bpy.data.objects.new('shell', me); s.collection.objects.link(shell)
# structural occluders: furniture proxies (final asset space, bottom-centre pivot)
occ = []
lmkeys = {(p['asset'], tuple(p['pos'])) for p in D.get('lmPieces', [])}
for pl in D['placements']:
    if (pl['asset'], tuple(pl['pos'])) in lmkeys: continue
    f = os.path.join(proxies, pl['asset'] + '.glb')
    if not os.path.exists(f): continue
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=f); new = [o for o in bpy.data.objects if o not in before]
    root = mathutils.Matrix.Translation(B(*pl['pos'])) @ mathutils.Matrix.Rotation(pl['rotY'], 4, 'Z')
    for o in new:
        if o.parent is None: o.matrix_world = root @ o.matrix_world
        if o.type == 'MESH': occ.append(o); o.hide_render = False
# furniture lightmap pieces: each hero piece keeps its own UV2 (from its asset) remapped into a tile of a shared atlas
pieces = []; n_p = len(D.get('lmPieces', [])); g = max(1, math.ceil(math.sqrt(max(1, n_p))))
fm_mat = bpy.data.materials.new('fmWhite'); fm_mat.use_nodes = True; fm_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
fim = bpy.data.images.new('fm', px, px, alpha=False, float_buffer=True); fim.colorspace_settings.name = 'Non-Color'
fn = fm_mat.node_tree.nodes.new('ShaderNodeTexImage'); fn.image = fim; fm_mat.node_tree.nodes.active = fn
tiles = []
for i, pl in enumerate(D.get('lmPieces', [])):
    f = os.path.join(proxies, pl['asset'] + '.glb')
    if not os.path.exists(f): tiles.append(None); continue
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=f); new = [o for o in bpy.data.objects if o not in before]
    root = mathutils.Matrix.Translation(B(*pl['pos'])) @ mathutils.Matrix.Rotation(pl['rotY'], 4, 'Z')
    meshes = [o for o in new if o.type == 'MESH']; ok = False
    u0, v0 = (i % g) / g, (i // g) / g
    for o in new:
        if o.parent is None: o.matrix_world = root @ o.matrix_world
    for o in meshes:
        if len(o.data.uv_layers) < 2: continue
        lay = o.data.uv_layers[1]; ok = True
        for d in lay.data:
            ug, vg = d.uv[0], 1.0 - d.uv[1]
            d.uv = (u0 + (0.02 + 0.96 * ug) / g, 1.0 - (v0 + (0.02 + 0.96 * vg) / g))
        o.data.uv_layers.active = lay; o.data.materials.clear(); o.data.materials.append(fm_mat); pieces.append(o)
    tiles.append({'key': pl['key'], 'tile': [u0, v0, 1.0 / g]} if ok else None)
# lightmap UV2: smart project (planar shell faces -> big islands), packed in one atlas
bpy.context.view_layer.objects.active = shell
for o in bpy.context.selected_objects: o.select_set(False)
shell.select_set(True)
lay = me.uv_layers.new(name='Lightmap'); me.uv_layers.active = lay
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.pack_islands(margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
# lights: sun through the window wall, soft sky fill
world = bpy.data.worlds.new('w'); s.world = world; world.use_nodes = True; bg = world.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.62, 0.72, 0.9, 1); bg.inputs[1].default_value = 2.4
wl = D['windows']; wall = wl[0]['wall'] if wl else 'n'
dirs = {'n': (0, 1, 0), 's': (0, -1, 0), 'e': (-1, 0, 0), 'w': (1, 0, 0)}  # three (x, z) direction light travels into the room, mapped to blender (x, -z)
dx, dz = {'n': (0, 1), 's': (0, -1), 'e': (-1, 0), 'w': (1, 0)}[wall]
bpy.ops.object.light_add(type='SUN'); sun = bpy.context.active_object; sun.data.energy = 4.0; sun.data.color = (1.0, 0.9, 0.74); sun.data.angle = math.radians(16)
v = mathutils.Vector((dx, -dz, -0.62)).normalized(); sun.rotation_euler = v.to_track_quat('-Z', 'Y').to_euler()
# bake target
im = bpy.data.images.new('lm', px, px, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'
white = bpy.data.materials.new('bakeWhite'); white.use_nodes = True; white.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
for m in mats:
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = im; nt.nodes.active = tn; tn.select = True
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'Lightmap'; nt.links.new(uvn.outputs[0], tn.inputs[0])
for o in occ:  # occluders keep plain grey so bounce light reads right
    o.data.materials.clear(); o.data.materials.append(white)
for o in list(s.objects): o.select_set(False)
shell.select_set(True); bpy.context.view_layer.objects.active = shell
s.cycles.max_bounces = 6; s.cycles.diffuse_bounces = 5; s.cycles.samples = 192; s.cycles.use_denoising = True
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=8, margin_type='EXTEND', use_clear=True)
if pieces:
    for o in list(s.objects): o.select_set(False)
    for o in pieces: o.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=8, margin_type='EXTEND', use_clear=True)
    fp = list(fim.pixels); fim8 = bpy.data.images.new('fm8', px, px, alpha=False); fim8.colorspace_settings.name = 'Non-Color'
    fim8.pixels = [min(1.0, v * 0.25) if i % 4 != 3 else 1.0 for i, v in enumerate(fp)]
    fim8.filepath_raw = lm_out.replace('_lm4k.png', '_fm4k.png'); fim8.file_format = 'PNG'; fim8.save()
json.dump({'grid': g, 'tiles': tiles}, open(lm_out.replace('_lm4k.png', '_fm.json'), 'w'))
# restore shell as the active export selection
for o in list(s.objects): o.select_set(False)
shell.select_set(True); bpy.context.view_layer.objects.active = shell
# 8-bit: irradiance / 4 so values up to 4 survive; runtime multiplies back
px_arr = list(im.pixels); im8 = bpy.data.images.new('lm8', px, px, alpha=False); im8.colorspace_settings.name = 'Non-Color'
im8.pixels = [min(1.0, v * 0.25) if i % 4 != 3 else 1.0 for i, v in enumerate(px_arr)]
im8.filepath_raw = lm_out; im8.file_format = 'PNG'; im8.save()
# export shell only; restore material names for the runtime (manifest id before '::')
for m in mats: m.name = m.name.split('::')[1] + '@' + m.name.split('::')[0]  # unique 'part@materialId'
os.makedirs(os.path.dirname(out), exist_ok=True)
for o in list(s.objects): o.select_set(False)
shell.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='NONE', export_animations=False, export_cameras=False, export_lights=False)
print('ROOMBAKE', D['section'], len(occ), 'occluders', px)
