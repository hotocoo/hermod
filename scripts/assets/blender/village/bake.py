"""
Bake a V builder into a game-ready glb: bevelled + weighted-normal clean-quad game mesh, UV0 atlas (colour, tangent normal, ORM) and UV1 lightmap
(sky-only Cycles irradiance with ground bounce, stored in the glTF occlusionTexture on TEXCOORD_1), split into modules/parts, LOD0..2, extras.
Node contract (all names prefixed with the asset id `<id>`):
  <id>                     root empty, extras {anchorY, door:{x,y,z,h}, dims, parts, tris, modules}
  <id>_L1 | _L2 | _L3      module empties (L2 is additive over L1, L3 over L1+L2); children are meshes
  <id>_L<n>_LOD<k>         main mesh (material <id>), <id>_L<n>_roof_LOD<k> (material <id>_roof, tintable), <id>_L<n>_win_LOD0 (material <id>_windows, night glow),
                           <id>_L<n>_cloth_LOD<k> (material <id>_cloth, wind), <id>_L<n>_sign_LOD0 (material <id>_sign, emissive)
  <id>_<part>              moving parts with origin at the pivot (doorL, doorR, spool, slide, ...); <id>_door, <id>_smoke, <id>_fire ... are empties
"""
import os, sys, math, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy, bmesh
from mathutils import Matrix, Vector
import vlib
from vlib import V, NAMES, EMISSIVE, METAL, ROUGH
from lib import _img, _bake, tri_count, lin

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
OUT = os.environ.get('VILLAGE_ASSET_OUT', os.path.join(ROOT, 'public', 'assets', 'village'))
LODS = (1.0, 0.45, 0.16)
NOLOD = ('win', 'sign')  # small flat glow parts keep one LOD


def to_b(p):  # world (x up-y, +z front) -> blender coords
    return (p[0], -p[2], p[1])


def _setup_cycles():
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.use_denoising = False; sc.cycles.device = 'CPU'
    try:
        p = bpy.context.preferences.addons['cycles'].preferences; p.compute_device_type = 'METAL'; p.refresh_devices()
        for d in p.devices: d.use = d.type in ('METAL', 'GPU')
        if any(d.use for d in p.devices): sc.cycles.device = 'GPU'
    except Exception as e: print('cpu bake', e)


def _bevel(lo, width=0.006):
    bpy.context.view_layer.objects.active = lo
    b = lo.modifiers.new('bevel', 'BEVEL'); b.width = width; b.segments = 1; b.limit_method = 'ANGLE'; b.angle_limit = math.radians(40); b.profile = 0.55
    w = lo.modifiers.new('wn', 'WEIGHTED_NORMAL'); w.keep_sharp = True; w.mode = 'FACE_AREA'
    for m in list(lo.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    bm = bmesh.new(); bm.from_mesh(lo.data); bmesh.ops.dissolve_degenerate(bm, dist=2e-5, edges=bm.edges[:])
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 2e-7], context='FACES'); bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(lo.data); bm.free()


def _uv(lo, name, margin, island):
    uv = lo.data.uv_layers.get(name) or lo.data.uv_layers.new(name=name); lo.data.uv_layers.active = uv
    bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=island, area_weight=0.7); bpy.ops.uv.average_islands_scale(); bpy.ops.uv.pack_islands(margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def _read(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32); img.pixels.foreach_get(a); return a.reshape(-1, 4)


def _write(img, a): img.pixels.foreach_set(a.ravel()); img.update()


def _material(name, base=None, emit=None, rough=0.9, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    if base is not None: b.inputs['Base Color'].default_value = base
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit: b.inputs['Emission Color'].default_value = emit; b.inputs['Emission Strength'].default_value = 1.0
    return m


def _pbr(aid, imgs, lm):
    """Final PBR material: base colour, tangent normal, ORM (G rough, B metal, R baked cavity AO), lightmap (UV 'Lightmap') as occlusion."""
    m = bpy.data.materials.new(aid); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    def tex(im, cs, uv=None):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = im; t.image.colorspace_settings.name = cs; t.interpolation = 'Cubic'
        if uv: u = nt.nodes.new('ShaderNodeUVMap'); u.uv_map = uv; nt.links.new(u.outputs[0], t.inputs[0])
        return t
    c = tex(imgs['c'], 'sRGB', 'UVMap'); nm = tex(imgs['n'], 'Non-Color', 'UVMap'); o = tex(imgs['orm'], 'Non-Color', 'UVMap'); l = tex(lm, 'Non-Color', 'Lightmap')
    nt.links.new(c.outputs[0], b.inputs['Base Color']); nn = nt.nodes.new('ShaderNodeNormalMap'); nn.uv_map = 'UVMap'; nt.links.new(nm.outputs[0], nn.inputs['Color']); nt.links.new(nn.outputs[0], b.inputs['Normal'])
    sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o.outputs[0], sep.inputs[0]); nt.links.new(sep.outputs[1], b.inputs['Roughness']); nt.links.new(sep.outputs[2], b.inputs['Metallic'])
    g = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    if 'Occlusion' not in [i.name for i in g.interface.items_tree]: g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = g; s2 = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o.outputs[0], s2.inputs[0])  # occlusion = baked cavity AO (R of ORM, UV0); the sky lightmap bake was unusable at these texel densities; nt.links.new(s2.outputs[0], gn.inputs['Occlusion'])
    return m


def _sub(lo, keep):
    """Copy of lo with only faces for which keep(part_name_index, mod) is true."""
    ob = lo.copy(); ob.data = lo.data.copy(); bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new(); bm.from_mesh(ob.data); lp = bm.faces.layers.int.get('part'); lm = bm.faces.layers.int.get('mod')
    dead = [f for f in bm.faces if not keep(f[lp], f[lm])]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(ob.data); bm.free(); return ob


def _bake_module(aid, tag, lo, hi, size, lm_size, ao_strength, dbg):
    """UV0 atlas + UV1 lightmap + PBR bake for one module object `lo` against the whole high-poly `hi`. Returns (main material, roof material, cloth material)."""
    sc = bpy.context.scene
    lo.data.materials.clear(); _uv(lo, 'UVMap', 0.003, 0.003); _uv(lo, 'Lightmap', 0.006, 0.01); lo.data.uv_layers.active = lo.data.uv_layers['UVMap']
    for p in lo.data.polygons: p.material_index = 0
    # drop zero-area faces (3D or UV) so assets pass the degenerate-face check
    bm = bmesh.new(); bm.from_mesh(lo.data); u0 = bm.loops.layers.uv['UVMap']; u1 = bm.loops.layers.uv['Lightmap']
    def uva(f, u): c = [l[u].uv for l in f.loops]; return abs(sum(c[i].x * c[(i + 1) % len(c)].y - c[(i + 1) % len(c)].x * c[i].y for i in range(len(c)))) / 2
    dead = [f for f in bm.faces if f.calc_area() < 3e-8 or uva(f, u0) < 1e-10 or uva(f, u1) < 1e-10]
    if dead: bmesh.ops.delete(bm, geom=dead, context='FACES'); bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(lo.data)
    bm.free()
    mat = bpy.data.materials.new(tag + '_bake'); mat.use_nodes = True; nt = mat.node_tree; lo.data.materials.append(mat)
    imgs = {'c': _img(tag + '_c', size, (0.8, 0.78, 0.72, 1)), 'n': _img(tag + '_n', size, (0.5, 0.5, 1.0, 1), True), 'ao': _img(tag + '_ao', size, (1, 1, 1, 1), True),
            'r': _img(tag + '_r', size, (0.9, 0.9, 0.9, 1), True), 'm': _img(tag + '_m', size, (0, 0, 0, 1), True)}
    node = nt.nodes.new('ShaderNodeTexImage')
    def bk(kind, key, **kw):
        node.image = imgs[key]; kw.setdefault('ext', 0.16); kw.setdefault('ray', 0.6); _bake(lo, hi, kind, imgs[key], node, **kw)  # wide cage: shingles and masonry relief sit well off the game mesh, short rays leave unbaked (white) holes
    sc.cycles.samples = 32
    bk('DIFFUSE', 'c', pass_filter={'COLOR'}); bk('NORMAL', 'n', normal_space='TANGENT'); bk('AO', 'ao'); bk('ROUGHNESS', 'r')
    saved = list(hi.data.materials)
    for i, m in enumerate(saved):
        mm = bpy.data.materials.new('mt_' + m.name); mm.use_nodes = True; t = mm.node_tree; b = t.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0, 0, 0, 1)
        v = METAL[NAMES[i]]; b.inputs['Emission Color'].default_value = (v, v, v, 1); b.inputs['Emission Strength'].default_value = 1.0; hi.data.materials[i] = mm
    bk('EMIT', 'm')
    for i, m in enumerate(saved): hi.data.materials[i] = m
    c = _read(imgs['c']); ao = _read(imgs['ao'])[:, :1]; c[:, :3] *= (1 - ao_strength) + ao_strength * ao; _write(imgs['c'], c)
    orm = _img(tag + '_orm', size, (1, 1, 1, 1), True); o = np.ones((size * size, 4), dtype=np.float32); o[:, 0] = ao[:, 0]; o[:, 1] = _read(imgs['r'])[:, 0]; o[:, 2] = _read(imgs['m'])[:, 0]; _write(orm, o); imgs['orm'] = orm
    lmi = _img(tag + '_lm', lm_size, (1, 1, 1, 1), True); lo.data.uv_layers.active = lo.data.uv_layers['Lightmap']
    old_world = sc.world; w = bpy.data.worlds.new('sky'); sc.world = w; w.use_nodes = True; bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.8, 0.88, 1.0, 1); bg.inputs[1].default_value = 1.0
    wm = _material(tag + '_wm', (0.8, 0.8, 0.8, 1)); lo.data.materials.clear(); lo.data.materials.append(wm); t = wm.node_tree.nodes.new('ShaderNodeTexImage'); t.image = lmi; wm.node_tree.nodes.active = t
    bb = [Vector(c) for c in lo.bound_box]; R = max(max(abs(v.x) for v in bb), max(abs(v.y) for v in bb)) + 6
    bpy.ops.mesh.primitive_plane_add(size=R * 3, location=(0, 0, -0.002)); gr = bpy.context.active_object; gr.data.materials.append(_material('gr', (0.35, 0.4, 0.22, 1)))
    bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
    sc.cycles.samples = 96
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=8, margin_type='EXTEND', use_clear=True, target='IMAGE_TEXTURES')
    bpy.data.objects.remove(gr, do_unlink=True)
    a = _read(lmi); lum = a[:, :3].mean(axis=1, keepdims=True); a[:, :3] = np.clip(lum * 1.15, 0, 1); _write(lmi, a)
    if dbg:
        os.makedirs(dbg, exist_ok=True)
        for k, im in list(imgs.items()) + [('lm', lmi)]: im.filepath_raw = os.path.join(dbg, f'{tag}_{k}.png'); im.file_format = 'PNG'; im.save()
    lo.data.uv_layers.active = lo.data.uv_layers['UVMap']; lo.data.materials.clear()
    # generated images lose their baked pixels on export: round-trip through PNG files and pack the file-backed copies
    import tempfile
    tmp = tempfile.mkdtemp(prefix='vbake_')
    def solid(im, nm):
        fp = os.path.join(tmp, nm + '.png'); im.filepath_raw = fp; im.file_format = 'PNG'; im.save()
        ld = bpy.data.images.load(fp); ld.name = im.name + '_f'; ld.colorspace_settings.name = im.colorspace_settings.name; ld.pack(); return ld
    imgs = {k: solid(imgs[k], tag + '_' + k) for k in ('c', 'n', 'orm')}
    lmi = solid(lmi, tag + '_lm')
    return _pbr(tag, imgs, lmi), _pbr(tag + '_roof', imgs, lmi), _pbr(tag + '_cloth', imgs, lmi)


def bake_asset(aid, build, size=2048, lm_size=1024, out=OUT, meta=None, bevel=0.005, ao_strength=0.35, ultra=False):
    lm_size = min(lm_size, size // 2)  # equal sizes make the glTF exporter merge occlusion (UV1) with metal-rough (UV0) into one image
    bpy.ops.wm.read_factory_settings(use_empty=True); _setup_cycles(); sc = bpy.context.scene
    kh = V(True); build(kh); hi = kh.finish(aid + '_hi')
    kl = V(False); build(kl); lo = kl.finish(aid + '_LOD0'); parts = kl.parts
    tris_hi = tri_count(hi); _bevel(lo, bevel); tris_lo = tri_count(lo)
    dbg = os.environ.get('VILLAGE_DEBUG')
    win = _material(aid + '_windows', (0.02, 0.025, 0.035, 1), (1.0, 0.72, 0.38, 1), 0.08); sign = _material(aid + '_sign', (0.9, 0.7, 0.4, 1), (1.0, 0.7, 0.28, 1), 0.6)
    root = bpy.data.objects.new(aid, None); sc.collection.objects.link(root)
    mods = sorted({int(p.value) for p in lo.data.attributes['mod'].data})
    objs = []
    for mi in mods:
        tag = aid if mi == 0 else f'{aid}_L{mi + 1}'; msz = size if mi == 0 else max(512, size // 2); mlm = lm_size if mi == 0 else max(256, lm_size // 2)
        lm_obj = _sub(lo, lambda p, m, mi=mi: m == mi); lm_obj.name = tag + '_bakeobj'
        pbr, rf, cl = _bake_module(aid, tag, lm_obj, hi, msz, mlm, ao_strength, dbg)
        pmat = {'main': pbr, 'roof': rf, 'cloth': cl, 'win': win, 'sign': sign}
        e = bpy.data.objects.new(f'{aid}_L{mi + 1}', None); sc.collection.objects.link(e); e.parent = root
        for pi, pn in enumerate(parts):
            ob = _sub(lm_obj, lambda p, m, pi=pi: p == pi)
            if not len(ob.data.polygons): bpy.data.objects.remove(ob, do_unlink=True); continue
            # final clean-up per part: merge by distance, dissolve degenerate, triangulate (beauty), then drop slivers in 3D and in both UV sets
            bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5); bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges[:])
            bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
            def uva2(f, name): u = bm.loops.layers.uv.get(name); c = [l[u].uv for l in f.loops] if u else None; return 1.0 if c is None else abs((c[1].x - c[0].x) * (c[2].y - c[0].y) - (c[2].x - c[0].x) * (c[1].y - c[0].y)) / 2
            dead = [f for f in bm.faces if f.calc_area() < 2e-8 or uva2(f, 'UVMap') < 2e-9 or uva2(f, 'Lightmap') < 2e-9]
            if dead: bmesh.ops.delete(bm, geom=dead, context='FACES')
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(ob.data); bm.free()
            if not len(ob.data.polygons): bpy.data.objects.remove(ob, do_unlink=True); continue
            moving = pn in kl.origins; kind = pn if pn in pmat else 'main'
            ob.data.materials.clear(); ob.data.materials.append(pmat[kind])
            base = f'{aid}_L{mi + 1}' + ('' if pn == 'main' else '_' + pn)
            if moving:
                o = Vector(to_b(kl.origins[pn])); ob.data.transform(Matrix.Translation(-o)); ob.location = o; ob.name = f'{aid}_{pn}' + (f'_L{mi + 1}' if mi else ''); ob.parent = root; objs.append(ob); continue
            ob.name = base + '_LOD0'; lods = [ob]
            if pn not in NOLOD:
                for k, ratio in enumerate(LODS[1:], 1):
                    c = ob.copy(); c.data = ob.data.copy(); sc.collection.objects.link(c); c.name = f'{base}_LOD{k}'
                    m = c.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True; lods.append(c)
            for c in lods: c.parent = e; objs.append(c)
        bpy.data.objects.remove(lm_obj, do_unlink=True)
    for n, p in kl.empties.items():
        e = bpy.data.objects.new(f'{aid}_{n}', None); sc.collection.objects.link(e); e.location = Vector(to_b(p)); e.parent = root
    bpy.data.objects.remove(lo, do_unlink=True); bpy.data.objects.remove(hi, do_unlink=True)
    meta = dict(meta or {}); meta.update(kl.meta); meta['parts'] = list(parts); meta['modules'] = [f'L{m + 1}' for m in mods]
    for k, v in meta.items(): root[k] = v if not isinstance(v, (dict, list)) else json.dumps(v)
    dg = bpy.context.evaluated_depsgraph_get(); lod_tris = {}
    for o in objs:
        if o.type != 'MESH': continue
        ev = o.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles(); lod_tris[o.name] = len(me.loop_triangles); ev.to_mesh_clear()
    os.makedirs(out, exist_ok=True); fn = os.path.join(out, aid + ('.ultra' if ultra else '') + '.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=fn, export_format='GLB', use_selection=False, export_apply=True, export_image_format='WEBP', export_yup=True, export_extras=True, export_cameras=False, export_lights=False)
    st = dict(id=aid, tris_hi=tris_hi, tris_lod0=tris_lo, tex=size, lm=lm_size, bytes=os.path.getsize(fn), nodes=lod_tris)
    st['lod_totals'] = [sum(v for k, v in lod_tris.items() if k.endswith(f'_LOD{i}')) for i in range(3)]
    print('ASSET', json.dumps({k: v for k, v in st.items() if k != 'nodes'})); json.dump(st, open(os.path.join(out, aid + '.stats.json'), 'w'))
    return st
