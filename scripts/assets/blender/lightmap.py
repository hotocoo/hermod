"""Static-furniture lightmap: import a pinned glTF, merge to one mesh, unwrap a second UV set ('Lightmap'), bake AO (+ contact shadow from a
ground plane) with Cycles, export a glb carrying TEXCOORD_1 + occlusionTexture.
blender -b --factory-startup -P lightmap.py -- <in.gltf|glb> <out.glb> <px> <repoRoot>"""
import sys, os, bpy, bmesh
sys.path.insert(0, os.path.dirname(__file__))
from common import *

src, out, px = argv()[0], argv()[1], int(argv()[2])
flags = (argv()[4] if len(argv()) > 4 else 'lm').split(',')
reset(); setup_cycles(64)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:  # bake world transform so the joined mesh is in asset space
    for s in bpy.context.selected_objects: s.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    if o.parent: bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
obj = join(meshes, 'LOD0')
for m in obj.data.materials:
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED' and 'Alpha' in n.inputs and n.inputs['Alpha'].default_value < 1: pass
if 'refine' in flags:  # low-poly source: bevel + weighted normals give supporting loops and a real silhouette highlight
    w = min(0.012, max(0.002, 0.004 * max(obj.dimensions)))
    b = obj.modifiers.new('bevel', 'BEVEL'); b.width = w; b.segments = 2; b.limit_method = 'ANGLE'; b.angle_limit = math.radians(30); b.harden_normals = True
    wn = obj.modifiers.new('wn', 'WEIGHTED_NORMAL'); wn.keep_sharp = True
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    obj.data.shade_smooth()
if 'lm' not in flags:
    export_glb(out, [obj]); print('REFINED', src); sys.exit(0)
bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
zmin = min(v.z for v in bb)
# ground plane (receiver for contact occlusion; not exported)
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, zmin - 0.0005)); ground = bpy.context.active_object
bm_ = bmesh.new(); bm_.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm_, verts=bm_.verts, dist=1e-5)
bmesh.ops.dissolve_degenerate(bm_, edges=bm_.edges, dist=1e-6)
dup = {}; kill = []
for f in bm_.faces:  # coincident duplicate faces (same vertex set) overlap by construction
    k = tuple(sorted(v.index for v in f.verts))
    if k in dup: kill.append(f)
    else: dup[k] = f
bmesh.ops.delete(bm_, geom=kill, context='FACES'); bm_.to_mesh(obj.data); bm_.free()
smart_uv(obj, 'Lightmap', margin=0.012, angle=(30 if os.path.basename(src).startswith(('dining_table', 'WoodenTable_03')) else 66))
im = new_image('lm', px, (1, 1, 1, 1), True)
# bake target must live in the material tree of each slot
for m in obj.data.materials:
    nt = m.node_tree; tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = im; nt.nodes.active = tn; tn.select = True
bpy.context.scene.cycles.samples = 96
for o in bpy.context.selected_objects: o.select_set(False)
obj.select_set(True); bpy.context.view_layer.objects.active = obj
bpy.ops.object.bake(type='AO', use_selected_to_active=False, margin=6, margin_type='EXTEND', use_clear=True)
for m in obj.data.materials:
    nt = m.node_tree; tn = nt.nodes.active
    if tn and tn.type == 'TEX_IMAGE': nt.nodes.remove(tn)
# occlusion via glTF Material Output group, second UV set
g = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
if 'Occlusion' not in [i.name for i in g.interface.items_tree]: g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
im.pack()
for m in obj.data.materials:
    nt = m.node_tree; gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = g; sep = nt.nodes.new('ShaderNodeSeparateColor')
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = im; u = nt.nodes.new('ShaderNodeUVMap'); u.uv_map = 'Lightmap'
    nt.links.new(u.outputs[0], t.inputs[0]); nt.links.new(t.outputs[0], sep.inputs[0]); nt.links.new(sep.outputs[0], gn.inputs['Occlusion'])
bpy.data.objects.remove(ground, do_unlink=True)
export_glb(out, [obj]); print('LIGHTMAPPED', src)
