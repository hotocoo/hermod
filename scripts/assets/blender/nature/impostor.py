"""Far-distance octahedral impostors baked from the real LOD0 mesh (never used near).
Hemi-octahedral layout: grid x grid views, cell (i, j) holds the view from hemiOctDecode((i+.5)/grid*2-1, (j+.5)/grid*2-1) (Y up).
Output <id>_imp.glb: one quad <id>_IMP with base colour atlas (rgba), object-space normal atlas (normalTexture) and ORM; extras carry grid and sphere."""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from mathutils import Vector
import nlib
from nlib import setup_cycles, to_image, pbr_material, export


def hemi_oct_decode(ex, ey):
    tx, tz = (ex + ey) * 0.5, (ex - ey) * 0.5; y = 1.0 - abs(tx) - abs(tz); v = Vector((tx, y, tz)); return v.normalized()


def _emit_copy(mat, mode):
    """Emission-only copy: 'albedo' shows base colour with texture alpha, 'normal' shows the object-space geometry normal."""
    m = bpy.data.materials.new(mat.name + '_imp_' + mode); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission'); tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mix = nt.nodes.new('ShaderNodeMixShader')
    bs = [n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'][0]; src = bs.inputs['Base Color'].links[0].from_node; al = bs.inputs['Alpha'].links
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = src.image
    if mode == 'albedo': nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    else:
        g = nt.nodes.new('ShaderNodeNewGeometry'); vm = nt.nodes.new('ShaderNodeVectorMath'); vm.operation = 'MULTIPLY_ADD'; vm.inputs[1].default_value = (0.5, 0.5, 0.5); vm.inputs[2].default_value = (0.5, 0.5, 0.5)
        flip = nt.nodes.new('ShaderNodeVectorMath'); flip.operation = 'SCALE'  # face the camera side: two-sided cards use the incoming-facing normal
        nt.links.new(g.outputs['Normal'], vm.inputs[0]); nt.links.new(vm.outputs[0], em.inputs['Color'])
    if al and mat.get('alpha'): nt.links.new(tex.outputs['Alpha'], mix.inputs[0])
    else: mix.inputs[0].default_value = 1.0
    nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2]); nt.links.new(mix.outputs[0], out.inputs[0]); return m


def a_mean(p):
    im = bpy.data.images.load(p); a = np.array(im.pixels[:], np.float32).reshape(-1, 4); bpy.data.images.remove(im); m = a[:, 3] > 0.5; return a[m, :3].mean(0).tolist() if m.any() else None


def bake_impostor(asset_id, lod0_objs, grid=8, cell=256):
    lod0_objs = [o for o in lod0_objs if o.name.endswith('_LOD0')]
    sc = bpy.context.scene; setup_cycles(6); sc.cycles.use_denoising = False; sc.cycles.transparent_max_bounces = 96; sc.cycles.filter_width = 1.0
    mn, mx = nlib.bounds(lod0_objs); ctr = (mn + mx) / 2
    rad = max(((o.matrix_world @ v.co) - ctr).length for o in lod0_objs for v in o.data.vertices) * 1.02
    for o in bpy.context.scene.objects:
        if o.type == 'MESH': o.hide_render = o not in lod0_objs
    sc.render.film_transparent = True; sc.render.resolution_x = sc.render.resolution_y = cell; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'; sc.render.filter_size = 0.8
    cam = bpy.data.objects.new('imp_cam', bpy.data.cameras.new('imp_cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'; cam.data.ortho_scale = rad * 2.0; cam.data.clip_end = rad * 8
    sc.world = bpy.data.worlds.new('imp'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
    atlas = {}
    for mode in ('albedo', 'normal'):
        saved = {}
        for o in lod0_objs:
            saved[o] = list(o.data.materials)
            for i, m in enumerate(saved[o]): o.data.materials[i] = _emit_copy(m, mode)  # in place: clear() would reset the polygon material indices
        A = np.zeros((grid * cell, grid * cell, 4), np.float32)
        for j in range(grid):
            for i in range(grid):
                d = hemi_oct_decode((i + 0.5) / grid * 2 - 1, (j + 0.5) / grid * 2 - 1); b = Vector((d.x, -d.z, d.y))  # glTF Y up -> Blender Z up
                cam.location = ctr + b * rad * 3; cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Z' if abs(b.z) < 0.999 else 'Y').to_euler()
                p = f'/tmp/imp_{asset_id}.png'; sc.render.filepath = p; bpy.ops.render.render(write_still=True)
                im = bpy.data.images.load(p); a = np.array(im.pixels[:], np.float32).reshape(cell, cell, 4); bpy.data.images.remove(im)
                A[(grid - 1 - j) * cell:(grid - j) * cell, i * cell:(i + 1) * cell] = a  # image rows: top first, v up (grid row j counted from the bottom)
        atlas[mode] = A
        for o in lod0_objs:
            for i, m in enumerate(saved[o]): o.data.materials[i] = m
    base = atlas['albedo']; nrm = atlas['normal']; nrm[..., 3] = 1.0
    # flip rows to the glTF (top-first) convention used by to_image: A rows already top-first
    # dilate rgb under the alpha so mips do not darken the edge
    m = base[..., 3:4] > 0.02; mean = (base[..., :3] * m).sum((0, 1)) / max(m.sum(), 1); base[..., :3] = np.where(m, base[..., :3], mean[None, None, :])
    # the albedo render is linear emission written as sRGB-less PNG; convert to sRGB for the colour slot
    base[..., :3] = nlib.srgb_enc(base[..., :3])
    orm = np.stack([np.ones(base.shape[:2], np.float32), np.full(base.shape[:2], 0.8, np.float32), np.zeros(base.shape[:2], np.float32), np.ones(base.shape[:2], np.float32)], -1)
    nlib.reset()
    mat = pbr_material(asset_id + '_imp', to_image(asset_id + '_imp_bc', base), to_image(asset_id + '_imp_n', nrm, nc=True), to_image(asset_id + '_imp_orm', orm, nc=True), alpha=True)
    mat['doubleSided'] = True
    me = bpy.data.meshes.new(asset_id + '_IMP'); q = rad * 1.0
    me.from_pydata([(-q, 0, -q), (q, 0, -q), (q, 0, q), (-q, 0, q)], [], [(0, 1, 2, 3)]); me.update(); uv = me.uv_layers.new(name='UVMap')
    for l, c in zip(me.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]): uv.data[l.index].uv = c
    ob = bpy.data.objects.new(asset_id + '_IMP', me); bpy.context.scene.collection.objects.link(ob); me.materials.append(mat)
    ob['octahedral'] = True; ob['grid'] = grid; ob['cell'] = cell; ob['radius'] = rad; ob['centerY'] = ctr.z; ob['hemi'] = True
    return export(asset_id + '_imp', [ob], dict(kind='impostor', grid=grid, cell=cell, radius=rad, centerY=ctr.z, hemi=True)) if True else None
