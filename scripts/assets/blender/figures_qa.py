"""QA stills of a figure glb in each clip (Workbench, textured). blender -b --factory-startup -P figures_qa.py -- <glb> <outDir> <name>"""
import sys, os, math, bpy, mathutils
sys.path.insert(0, os.path.dirname(__file__))
from common import argv, reset
glb, out, name = argv()[:3]; reset(); s = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=glb)
rig = next(o for o in s.objects if o.type == 'ARMATURE')
for o in list(s.objects):
    if o.type == 'MESH' and '_LOD1_' in o.name: o.hide_render = True
s.render.engine = 'BLENDER_WORKBENCH'; s.display.shading.light = 'STUDIO'; s.display.shading.color_type = 'TEXTURE'
s.render.resolution_x = 480; s.render.resolution_y = 720
cam_d = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cam_d); s.collection.objects.link(cam); s.camera = cam; cam_d.lens = 50
clips = [a for a in bpy.data.actions]
print('CLIPS', [a.name for a in clips])
os.makedirs(out, exist_ok=True)
for a in clips:
    rig.animation_data_create(); rig.animation_data.action = a
    try: rig.animation_data.action_slot = a.slots[0]
    except Exception as e: print('slot', e)
    s.frame_set(int(a.frame_range[0]) + 20)
    for ang, tag in ((0, 'front'), (55, 'side')):
        t = a.name.split('|')[-1]; z = 1.25 if 'sit' in t or 'read' in t or 'write' in t or 'sip' in t else 1.0; d = 4.2
        cam.location = (math.sin(math.radians(ang)) * d, -math.cos(math.radians(ang)) * d, 1.05); cam.rotation_euler = (mathutils.Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        s.render.filepath = os.path.join(out, f'{name}_{t}_{tag}.png'); bpy.ops.render.render(write_still=True)
