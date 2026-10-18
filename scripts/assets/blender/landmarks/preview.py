"""Render a quick preview of an exported glb: blender -b --factory-startup -P preview.py -- <id> [out.png]"""
import bpy, sys, os, math
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
args = sys.argv[sys.argv.index('--') + 1:]; aid = args[0]; out = args[1] if len(args) > 1 else f'/tmp/{aid}.png'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(os.environ.get('SITE_ASSET_OUT', os.path.join(ROOT, 'assets', 'cache', 'site-src')), aid + '.glb'))
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in objs:
    if not o.name.startswith(aid + '_LOD0'): o.hide_render = True
lo = [o for o in objs if o.name.startswith(aid + '_LOD0')][0]
bb = [lo.matrix_world @ Vector(c) for c in lo.bound_box]; mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb))); mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
c = (mn + mx) / 2; size = (mx - mn).length
sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sc.render.resolution_x = 1100; sc.render.resolution_y = 700
sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'; sc.display.shading.show_shadows = True; sc.display.shading.show_cavity = False
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.75, 0.82, 0.88)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
# Blender axes: front (+z world) is -y
az = math.radians(float(os.environ.get('AZ', '35'))); el = math.radians(float(os.environ.get('EL', '28')))
d = size * 1.15
cam.location = c + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * d
cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = 40
sc.render.filepath = out; bpy.ops.render.render(write_still=True); print('PREVIEW', out, 'size', tuple(round(x, 2) for x in (mx - mn)))
