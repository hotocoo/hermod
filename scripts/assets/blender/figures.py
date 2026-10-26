"""Realistic rigged figures from MPFB2 (MakeHuman, CC0 asset packs) with baked idle clips.
blender -b --factory-startup -P figures.py -- <id> <out.glb> <repoRoot> <texPx>
Needs MPFB installed into BLENDER_USER_RESOURCES (run.mjs does this). Everything is data from figures/figures.json."""
import sys, os, json, math, bpy, mathutils
sys.path.insert(0, os.path.dirname(__file__))
from common import argv, reset
ID, OUT, ROOT = argv()[0], argv()[1], argv()[2]
cfg = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'figures', 'figures.json')))
spec = next(f for f in cfg['figures'] if f['id'] == ID)
MH = os.path.join(ROOT, 'assets/cache/mh-assets')
reset()
bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService


macros = TargetService.get_default_macro_info_dict(); macros.update(spec['macros'])
base = HumanService.create_human(mask_helpers=False, detailed_helpers=False, extra_vertex_groups=False, feet_on_ground=False, macro_detail_dict=macros)
HumanService.add_builtin_rig(base, cfg['rig'], import_weights=True)
rig = base.parent
LIFT = -min((base.matrix_world @ v.co).z for v in base.data.vertices)  # feet to y=0 on export, rig and mesh move together
TYPES = {'clothes': 'Clothes', 'hair': 'Hair', 'eyebrows': 'Eyebrows', 'eyelashes': 'Eyelashes', 'eyes': 'Eyes'}
def asset(kind, name, mhclo=None):
    o = HumanService.add_mhclo_asset(os.path.join(MH, kind, name, mhclo or name + '.mhclo'), base, asset_type=TYPES[kind], subdiv_levels=0, material_type='MAKESKIN', set_up_rigging=True, interpolate_weights=True, import_weights=True)
    return o
parts = [(base, os.path.join(MH, 'skins', spec['skin'], spec['skin'] + '.mhmat'))]
for c in spec['clothes']: parts.append((asset('clothes', c), os.path.join(MH, 'clothes', c, c + '.mhmat')))
for kind, key in (('hair', 'hair'), ('eyebrows', 'eyebrows'), ('eyelashes', 'eyelashes')): parts.append((asset(kind, spec[key]), os.path.join(MH, kind, spec[key], spec[key] + '.mhmat')))
parts.append((asset('eyes', 'low-poly'), os.path.join(MH, 'eyes', 'materials', spec['eyes'] + '.mhmat')))
parts = [(o, m) for o, m in parts if o]

import glob
def find_mat(path):
    if os.path.exists(path): return path
    c = sorted(glob.glob(os.path.join(os.path.dirname(path), '*.mhmat'))); return c[0]
def parse_mhmat(path):
    d = {}
    for ln in open(path):
        ln = ln.strip()
        if not ln or ln.startswith('#') or ln.startswith('//'): continue
        k, _, v = ln.partition(' '); d[k] = v.strip()
    return d

def principled(obj, mhmat, hair):
    mhmat = find_mat(mhmat); m = parse_mhmat(mhmat); dr = os.path.dirname(mhmat)
    mat = bpy.data.materials.new(obj.name); mat.use_nodes = True; nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    def img(key, cs):
        f = m.get(key) or ({'bumpTexture': m.get('bumpmapTexture')}.get(key))
        if not f: return None
        p = os.path.join(dr, f); p = p if os.path.exists(p) else os.path.join(dr, os.path.basename(f))
        if not os.path.exists(p): return None
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(p); t.image.colorspace_settings.name = cs; return t
    d = img('diffuseTexture', 'sRGB')
    if d: nt.links.new(d.outputs['Color'], b.inputs['Base Color'])
    n = img('normalmapTexture', 'Non-Color')
    if n:
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.78 if not hair else 0.55
    b.inputs['Specular IOR Level'].default_value = 0.25
    if hair and d:
        r = nt.nodes.new('ShaderNodeMath'); r.operation = 'ROUND'; nt.links.new(d.outputs['Alpha'], r.inputs[0]); nt.links.new(r.outputs[0], b.inputs['Alpha'])
        mat.use_backface_culling = False
    elif m.get('transparent', 'False').lower() == 'true' and d:
        r = nt.nodes.new('ShaderNodeMath'); r.operation = 'ROUND'; nt.links.new(d.outputs['Alpha'], r.inputs[0]); nt.links.new(r.outputs[0], b.inputs['Alpha'])
    obj.data.materials.clear(); obj.data.materials.append(mat)

# freeze macro targets, drop MPFB helper geometry from the basemesh, then build plain PBR materials
for o, mh in parts:
    bpy.context.view_layer.objects.active = o
    if o.data.shape_keys: bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
bpy.context.view_layer.objects.active = base; bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.select_all(action='DESELECT')
g = base.vertex_groups['body'] if 'body' in base.vertex_groups else None
bpy.ops.object.mode_set(mode='OBJECT')
if g:
    keep = {v.index for v in base.data.vertices if any(vg.group == g.index and vg.weight > 0.0 for vg in v.groups)}
    import bmesh
    bm = bmesh.new(); bm.from_mesh(base.data); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context='VERTS'); bm.to_mesh(base.data); bm.free()
for o in list(base.modifiers):
    if o.type == 'MASK': base.modifiers.remove(o)
for o, mh in parts:
    principled(o, mh, o.name.split('.')[-1] in (spec['hair'], spec['eyebrows'], spec['eyelashes']))
    bpy.context.view_layer.objects.active = o; bpy.ops.object.shade_smooth()
    o.name = ID + '_' + o.name.split('.')[-1]

# skin-transfer: clothes take the body's weights from the nearest surface (MPFB interpolation leaves under-weighted sleeves that tear when arms move)
def transfer(o):
    for g in list(o.vertex_groups): o.vertex_groups.remove(g)
    m = o.modifiers.new('wt', 'DATA_TRANSFER'); m.object = base; m.use_vert_data = True; m.data_types_verts = {'VGROUP_WEIGHTS'}; m.vert_mapping = 'POLYINTERP_NEAREST'; m.mix_mode = 'REPLACE'
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.datalayout_transfer(modifier=m.name)
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')  # weight smoothing across the seams where the transfer picks different bones
    try: bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=3, expand=0.0)
    except Exception as e: print('smooth skipped', e)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4); bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
for o, _ in parts[1:1 + len(spec['clothes'])]: transfer(o)
# clothing sits 4 mm proud of the skin so the body never z-fights through it
for o, _ in parts[1:1 + len(spec['clothes'])]:
    for v in o.data.vertices: v.co += v.normal * 0.006
# hide body skin that clothing covers (no skin poking through seams when the pose deforms): outward ray from each body vertex hits a garment within 6 cm -> vertex dropped
from mathutils.bvhtree import BVHTree
def cover_body():
    verts, polys = [], []
    for o, _ in parts[1:1 + len(spec['clothes'])]:
        off = len(verts); verts += [o.matrix_world @ v.co for v in o.data.vertices]; polys += [tuple(off + i for i in p.vertices) for p in o.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys); import bmesh as bm2
    b = bm2.new(); b.from_mesh(base.data); b.verts.ensure_lookup_table(); b.normal_update(); kill = []
    head_z = max(v.co.z for v in b.verts) - 0.30
    for v in b.verts:
        if v.co.z > head_z: continue  # head, face and neck stay
        n = v.normal.normalized(); hit = tree.ray_cast(v.co + n * 0.001, n, 0.06)
        if hit[0] is not None:
            # skip hands and feet pieces: only drop where the garment actually surrounds the vertex (hit on the outward side, normal agrees)
            kill.append(v)
    bm2.ops.delete(b, geom=[v for v in kill if all(f for f in v.link_faces)], context='VERTS'); b.to_mesh(base.data); b.free()
cover_body()
# ---- idle clips (FK, rest-axis rotations; loops are integer-cycle so they close seamlessly)
N = 192; bpy.context.scene.render.fps = 24
pb = rig.pose.bones
for b in pb: b.rotation_mode = 'QUATERNION'
def depth(b): return 0 if b.parent is None else 1 + depth(b.parent)
ORDER = sorted(pb, key=depth); LEVELS = {}
for b in ORDER: LEVELS.setdefault(depth(b), []).append(b)
REST = {b.name: b.bone.matrix_local.copy() for b in pb}
AIM_TOL_DEG = 12.0       # build fails when an aimed limb ends further than this from its authored target (covers the oscillation amplitudes)
SYNC_TOL = 1e-3          # bookkeeping matrix vs evaluated pose-bone matrix, armature units (m)
ELBOW_MIDLINE_MIN = 0.04 # an elbow must stay at least this far on its own side of the body midline (m)
KNEE_FORWARD_MIN = 0.12  # seated: the knee must lie at least this far in front of the hip (m)
FLOOR_TOL = 0.025        # seated: lowest vertex of the deformed figure may sit this far off the floor (m)
LIMB_END = {'upperarm01': 'lowerarm01', 'lowerarm01': 'wrist', 'upperleg01': 'lowerleg01', 'lowerleg01': 'foot'}  # joint -> next limb joint (the *01 bones' own Y axes do not run along the limb in this rig)
def limb_end(name): base, _, sd = name.rpartition('.'); return LIMB_END[base] + '.' + sd
def limb_vec(m, name):
    """Posed limb direction of bone `name`: its head to the next limb joint's head, carried by the bone's current matrix (intermediate *02 bones are never posed, so they follow rigidly)."""
    end = m @ (REST[name].inverted() @ REST[limb_end(name)]).translation
    return (end - m.translation).normalized(), end
AIMED = {}  # bone -> (target, actual direction, head, end) of the last pose_frame
def pose_frame(acc, root):
    """Absolute pose per bone from the rest chain (own bookkeeping, no reliance on pose-bone matrix setters), then converted to local quaternions."""
    M = {}; AIMED.clear()
    for d in sorted(LEVELS):
        for b in LEVELS[d]:
            base_m = REST[b.name].copy() if b.parent is None else M[b.parent.name] @ (REST[b.parent.name].inverted() @ REST[b.name])
            m = base_m; head = m.translation.copy(); target = None
            for ax, deg in acc.get(b.name, []):
                if ax == 'aim':  # swing the LIMB vector (this joint to the next) onto a target direction given in armature axes
                    target = mathutils.Vector(deg).normalized(); cur, _ = limb_vec(m, b.name); R = cur.rotation_difference(target).to_matrix().to_4x4()
                else: R = mathutils.Matrix.Rotation(math.radians(deg), 4, ax)
                m = mathutils.Matrix.Translation(head) @ R @ mathutils.Matrix.Translation(-head) @ m
            if b.name == 'root': m = mathutils.Matrix.Translation(root) @ m
            M[b.name] = m
            if target is not None: act, end = limb_vec(m, b.name); AIMED[b.name] = (target, act, m.translation.copy(), end)
            rest_rel = REST[b.name] if b.parent is None else REST[b.parent.name].inverted() @ REST[b.name]
            parent_m = mathutils.Matrix.Identity(4) if b.parent is None else M[b.parent.name]
            local = (parent_m @ rest_rel).inverted() @ m if b.parent else REST[b.name].inverted() @ m
            b.rotation_quaternion = local.to_quaternion(); b.location = local.translation if b.parent is None else (0, 0, 0)
    return M
def lowest_z():
    """Lowest vertex (armature-space z, before the export lift) of the deformed figure at the current pose."""
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get(); lo = 1e9
    for o, _ in parts:
        oe = o.evaluated_get(dg); me = oe.to_mesh()
        lo = min(lo, min((oe.matrix_world @ v.co).z for v in me.vertices)); oe.to_mesh_clear()
    return lo
def verify(name, M, seated, slack):
    """Build-time anatomy check at a sampled frame: raises (fails the build) instead of shipping a broken pose."""
    bpy.context.view_layer.update()
    for b in pb:
        err = max(abs(x) for r in (b.matrix - M[b.name]) for x in r)
        if err > SYNC_TOL: raise RuntimeError(f'{name}: pose-bone {b.name} matrix differs from the bookkeeping by {err:.4f} (constraint or inherit mismatch)')
    for bone, (tgt, act, _, _) in AIMED.items():
        ang = math.degrees(tgt.angle(act))
        if ang > AIM_TOL_DEG + slack.get(bone, 0): raise RuntimeError(f'{name}: {bone} limb points {ang:.1f} deg off its target {tuple(round(c, 2) for c in tgt)}')
    for sd in 'LR':
        ex = M['lowerarm01.' + sd].translation.x * side(sd)
        if ex < ELBOW_MIDLINE_MIN: raise RuntimeError(f'{name}: elbow {sd} at {ex:.3f} m crosses the body midline')
        if seated:
            fwd = M['upperleg01.' + sd].translation.y - M['lowerleg01.' + sd].translation.y
            if fwd < KNEE_FORWARD_MIN: raise RuntimeError(f'{name}: knee {sd} only {fwd:.3f} m in front of the hip')
    if seated:
        lo = lowest_z() + LIFT
        if abs(lo) > FLOOR_TOL: raise RuntimeError(f'{name}: lowest vertex {lo:.3f} m off the floor (below it or floating)')
def clip(name, base_pose, osc=(), root=(0, 0, 0), seated=False):
    slack = {}  # an authored oscillation legitimately moves its bone off the target by up to its amplitude
    for bone, ax, amp, cyc, ph in osc: slack[bone] = slack.get(bone, 0) + abs(amp)
    act = bpy.data.actions.new(name); rig.animation_data_create(); rig.animation_data.action = act
    for f in range(0, N + 1, 6):
        t = f / N * 2 * math.pi; acc = {}
        for bone, ax, deg in base_pose: acc.setdefault(bone, []).append((ax, deg))
        for bone, ax, amp, cyc, ph in osc: acc.setdefault(bone, []).append((ax, amp * math.sin(cyc * t + ph)))
        M = pose_frame(acc, root)
        if f in (0, N // 2): verify(f'{name}@{f}', M, seated, slack)
        for b in pb: b.keyframe_insert('rotation_quaternion', frame=f); b.keyframe_insert('location', frame=f)
    act.use_fake_user = True; return act
def settle(base_pose):
    """Root drop that puts the lowest vertex of the seated pose on the floor (feet flat), measured on the deformed mesh."""
    acc = {}
    for bone, ax, deg in base_pose: acc.setdefault(bone, []).append((ax, deg))
    pose_frame(acc, (0, 0, 0)); return -LIFT - lowest_z()
def side(s): return 1 if s == 'L' else -1
DOWN = (0, 0, -1)
def arms(up, fore, k=0.1): return [x for sd in 'LR' for x in ((f'upperarm01.{sd}', 'aim', (side(sd) * up[0], up[1], up[2])), (f'lowerarm01.{sd}', 'aim', (side(sd) * fore[0], fore[1], fore[2])))]
ARMS = arms((0.12, 0.0, -1), (0.08, -0.12, -1))
import random
RS = random.Random(ID)
def secondary(amp=1.0):
    ph = lambda: RS.random() * 6.283
    return [('spine03', 'X', 0.9 * amp, 2, ph()), ('spine05', 'X', 0.6 * amp, 2, ph()), ('spine03', 'Z', 0.7 * amp, 1, ph()), ('head', 'X', 0.8 * amp, 2, ph()),
            ('head', 'Z', 2.2 * amp, 1, ph()), ('head', 'Y', 1.2 * amp, 3, ph()), ('neck02', 'Z', 1.0 * amp, 1, ph()), ('clavicle.L', 'Z', 0.6 * amp, 2, ph()), ('clavicle.R', 'Z', 0.6 * amp, 2, ph()),
            ('upperarm01.L', 'X', 0.8 * amp, 3, ph()), ('upperarm01.R', 'X', 0.8 * amp, 3, ph()), ('lowerarm01.L', 'X', 1.1 * amp, 3, ph()), ('lowerarm01.R', 'X', 1.1 * amp, 3, ph()), ('wrist.L', 'X', 1.5 * amp, 4, ph()), ('wrist.R', 'X', 1.5 * amp, 4, ph())]
BREATH = secondary()
SIT = [x for sd in 'LR' for x in ((f'upperleg01.{sd}', 'aim', (side(sd) * 0.08, -1, -0.03)), (f'lowerleg01.{sd}', 'aim', (side(sd) * 0.02, -0.03, -1)))]
HEIGHT = max((base.matrix_world @ v.co).z for v in base.data.vertices) + LIFT; hip = HEIGHT * 0.5
SITARMS = arms((0.12, -0.3, -1), (0.05, -1, -0.45)); DROP = settle(SIT + SITARMS)
ALL = {}
ALL['idle_stand'] = clip('idle_stand', ARMS, BREATH + [('pelvis.L', 'Z', 1.6, 1, 0.0), ('spine01', 'Z', -1.2, 1, 0.0), ('head', 'Y', 6, 1, 1.0)])
ALL['idle_sit'] = clip('idle_sit', SIT + SITARMS, BREATH, (0, 0, DROP), True)
READ = arms((0.12, -0.5, -0.85), (-0.05, -0.75, 0.55)) + [('head', 'X', 24)]
ALL['idle_read'] = clip('idle_read', SIT + READ, BREATH + [('upperarm01.R', 'X', 1.5, 1, 1.0), ('head', 'X', 2.0, 2, 0.3)], (0, 0, DROP), True)
WR = arms((0.12, -0.45, -0.9), (-0.1, -1, -0.35)) + [('head', 'X', 30), ('spine03', 'X', 6)]
ALL['idle_write'] = clip('idle_write', SIT + WR, BREATH + [('wrist.R', 'Y', 9, 6, 0), ('wrist.R', 'X', 4, 3, 0.5), ('head', 'Y', 3, 2, 0.2), ('lowerarm01.R', 'X', 2.5, 3, 0)], (0, 0, DROP), True)
WARM = arms((0.1, -0.55, -0.85), (-0.05, -1, 0.1)) + [('spine03', 'X', 4), ('head', 'X', 5)]
ALL['idle_warm'] = clip('idle_warm', WARM, BREATH + [('wrist.L', 'Y', 10, 4, 0), ('wrist.R', 'Y', -10, 4, 0)])
SIP = arms((0.12, -0.3, -1), (0.05, -1, -0.45))
SIP = [(b, a, d) for b, a, d in SIP if b != 'upperarm01.R' and b != 'lowerarm01.R'] + [('upperarm01.R', 'aim', (-0.12, -0.6, -0.8)), ('lowerarm01.R', 'aim', (0.1, -1, 0.1))]
ALL['idle_sip'] = clip('idle_sip', SIT + SIP, BREATH + [('lowerarm01.R', 'X', -30, 1, -math.pi / 2), ('head', 'X', -6, 1, -math.pi / 2)], (0, 0, DROP), True)
for tr in list(rig.animation_data.nla_tracks): rig.animation_data.nla_tracks.remove(tr)
rig.animation_data.action = ALL['idle_stand']

# ---- LOD1: decimated copies sharing the armature (skinning kept)
meshes = [o for o, _ in parts]
def lod(ratio, tag):
    out = []
    for o in meshes:
        c = o.copy(); c.data = o.data.copy(); bpy.context.collection.objects.link(c); c.name = o.name.replace(ID + '_', f'{ID}_{tag}_')
        bpy.context.view_layer.objects.active = c
        m = c.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = False
        for md in list(c.modifiers):
            if md.type == 'ARMATURE': continue
            bpy.ops.object.modifier_apply(modifier=md.name)
        out.append(c)
    return out
lod1 = lod(0.35, 'LOD1')
for o in meshes: o.name = o.name.replace(ID + '_', ID + '_LOD0_', 1)
rig.location.z += LIFT
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for o in meshes + lod1 + [rig]: o.select_set(True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=False, export_yup=True, export_texcoords=True, export_normals=True,
    export_materials='EXPORT', export_image_format='AUTO', export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_skins=True, export_def_bones=True, export_optimize_animation_size=True,
    export_cameras=False, export_lights=False)
print('FIGURE', ID, 'tris', sum(len(o.data.polygons) for o in meshes), 'hip', hip, 'drop', DROP, 'clips', list(ALL))
