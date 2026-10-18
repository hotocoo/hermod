"""QA stills: blender -b --factory-startup -P preview.py -- <id> <outPrefix> [levels=3] [lod=0]. Renders 6 turntable angles (workbench, textured) of the glb at docs/qa/village."""
import bpy, sys, os, math
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
a = sys.argv[sys.argv.index('--') + 1:]; aid = a[0]; pre = a[1]; level = int(a[2]) if len(a) > 2 else 3; lod = int(a[3]) if len(a) > 3 else 0
ext = os.environ.get('VARIANT', '')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(os.environ.get('VILLAGE_ASSET_OUT', os.path.join(ROOT, 'public', 'assets', 'village')), aid + ext + '.glb'))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
vis = []
for o in meshes:
    n = o.name; ok = True
    if '_LOD' in n:
        k = int(n.split('_LOD')[1][0]); ok = k == lod or (k == 0 and lod > 0 and ('_win' in n or '_sign' in n))
        for m in range(level + 1, 4):
            if f'_L{m}' in n: ok = False
    if ok: vis.append(o)
    else: o.hide_render = True
bb = [o.matrix_world @ Vector(c) for o in vis for c in o.bound_box]
mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb))); mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
c = (mn + mx) / 2; size = (mx - mn).length
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = 900; sc.render.resolution_y = 700
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True; bg = sc.world.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.62, 0.72, 0.86, 1); bg.inputs[1].default_value = 0.55
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 2.6; sun.rotation_euler = (math.radians(50), 0, math.radians(-30)); sc.collection.objects.link(sun)
bpy.ops.mesh.primitive_plane_add(size=60, location=(c.x, c.y, mn.z - 0.01)); g = bpy.context.active_object; gm = bpy.data.materials.new('g'); gm.diffuse_color = (0.30, 0.38, 0.2, 1); g.data.materials.append(gm)
try: sc.view_settings.view_transform = 'Standard'
except Exception: pass
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
for i, azd in enumerate((20, 80, 140, 200, 260, 320)):
    az = math.radians(azd); el = math.radians(float(os.environ.get('EL', '24'))); d = size * 1.45
    cam.location = c + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * d
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = 45
    sc.render.filepath = f'{pre}_{i}.png'; bpy.ops.render.render(write_still=True)
print('PREVIEW', pre, tuple(round(x, 2) for x in (mx - mn)))
