"""Figure sculptor for pediment groups and statues: a posed joint skeleton skinned with Blender's Skin modifier and subdivided, so every figure is one
organic closed surface (torso, neck, head, limbs, hands and feet blended at the joints) instead of stacked lathes. Coordinates are unit-figure space: 1.8 tall
(reclining poses: 1.8 long), facing +z, +x to the figure's left. `skin_body(pose, hi)` returns (verts, faces) for K.sculpt; results are cached per (pose, hi)."""
import bpy

# (name, (x, y, z), radius, parent). radius is the half-thickness of the skinned limb at that joint.
_TORSO = [
    ('pelvis', (0.0, 0.98, 0.0), 0.185, None), ('belly', (0.0, 1.17, 0.012), 0.140, 'pelvis'), ('chest', (0.0, 1.38, 0.014), 0.195, 'belly'),
    ('neck', (0.0, 1.55, 0.02), 0.060, 'chest'), ('head', (0.0, 1.665, 0.035), 0.104, 'neck'), ('crown', (0.0, 1.765, 0.03), 0.05, 'head'),
]


def _limb(side, hip, knee, ankle, toe, rh=0.112, rk=0.074, ra=0.048, rt=0.036):
    s = 'L' if side > 0 else 'R'; calf = tuple(k + (a - k) * 0.32 for k, a in zip(knee, ankle))
    return [('hip' + s, hip, rh, 'pelvis'), ('knee' + s, knee, rk, 'hip' + s), ('calf' + s, calf, 0.072, 'knee' + s), ('ankle' + s, ankle, ra, 'calf' + s), ('toe' + s, toe, rt, 'ankle' + s)]


def _arm(side, sh, el, wr, hd, rs=0.074, re=0.05, rw=0.036, rh=0.034, parent='chest'):
    s = 'L' if side > 0 else 'R'
    return [('sh' + s, sh, rs, parent), ('el' + s, el, re, 'sh' + s), ('wr' + s, wr, rw, 'el' + s), ('hd' + s, hd, rh, 'wr' + s)]


def _stand():  # contrapposto: weight on the left leg, right knee eased forward, right hand on the hip, left arm lowered
    return (_TORSO + _limb(1, (0.115, 0.95, 0.0), (0.125, 0.52, 0.02), (0.125, 0.075, 0.0), (0.125, 0.03, 0.15))
            + _limb(-1, (-0.115, 0.95, 0.0), (-0.16, 0.50, 0.09), (-0.21, 0.075, -0.07), (-0.21, 0.03, 0.08))
            + _arm(1, (0.215, 1.50, 0.0), (0.205, 1.22, 0.03), (0.2, 0.97, 0.05), (0.195, 0.89, 0.07))  # lowered arm rests against the body: no sliver gap for the bake rays to cross
            + _arm(-1, (-0.215, 1.50, 0.0), (-0.34, 1.30, 0.0), (-0.20, 1.14, 0.06), (-0.14, 1.12, 0.07)))


def _strider():  # mid-stride toward +x, spear arm cocked back
    return ([('pelvis', (0.0, 0.92, 0.0), 0.185, None), ('belly', (0.04, 1.12, 0.01), 0.14, 'pelvis'), ('chest', (0.10, 1.34, 0.014), 0.195, 'belly'),
             ('neck', (0.15, 1.52, 0.03), 0.06, 'chest'), ('head', (0.19, 1.655, 0.05), 0.104, 'neck'), ('crown', (0.215, 1.75, 0.045), 0.05, 'head')]
            + _limb(1, (0.08, 0.90, 0.07), (0.34, 0.58, 0.09), (0.50, 0.08, 0.08), (0.62, 0.03, 0.08))
            + _limb(-1, (-0.08, 0.90, -0.07), (-0.26, 0.54, -0.07), (-0.52, 0.12, -0.07), (-0.60, 0.03, -0.07))
            + _arm(1, (0.30, 1.46, 0.10), (0.46, 1.52, 0.30), (0.34, 1.72, 0.34), (0.30, 1.82, 0.34))
            + _arm(-1, (-0.04, 1.46, -0.10), (0.04, 1.28, -0.20), (0.22, 1.20, -0.16), (0.30, 1.20, -0.14)))


def _kneel():  # kneeling on the right knee, left foot planted forward, both arms reaching out
    return ([('pelvis', (0.0, 0.64, 0.0), 0.185, None), ('belly', (0.0, 0.84, 0.03), 0.14, 'pelvis'), ('chest', (0.0, 1.04, 0.07), 0.195, 'belly'),
             ('neck', (0.0, 1.21, 0.12), 0.06, 'chest'), ('head', (0.0, 1.345, 0.16), 0.104, 'neck'), ('crown', (0.0, 1.44, 0.15), 0.05, 'head')]
            + _limb(1, (0.095, 0.64, 0.05), (0.14, 0.60, 0.40), (0.14, 0.075, 0.42), (0.14, 0.03, 0.56))
            + _limb(-1, (-0.095, 0.62, -0.02), (-0.12, 0.08, 0.16), (-0.14, 0.075, -0.30), (-0.14, 0.04, -0.42))
            + _arm(1, (0.21, 1.14, 0.08), (0.28, 0.98, 0.26), (0.20, 0.86, 0.48), (0.18, 0.84, 0.56))
            + _arm(-1, (-0.21, 1.14, 0.08), (-0.28, 0.96, 0.22), (-0.16, 0.74, 0.30), (-0.12, 0.68, 0.34)))


def _recline():  # river-god corner figure: legs along -x, torso propped low on the left elbow, head toward +x
    return ([('pelvis', (0.0, 0.17, 0.0), 0.185, None), ('belly', (0.20, 0.22, 0.0), 0.14, 'pelvis'), ('chest', (0.42, 0.28, 0.0), 0.195, 'belly'),
             ('neck', (0.62, 0.36, 0.02), 0.06, 'chest'), ('head', (0.74, 0.405, 0.05), 0.104, 'neck'), ('crown', (0.82, 0.45, 0.045), 0.05, 'head')]
            + _limb(1, (-0.04, 0.17, 0.09), (-0.46, 0.20, 0.11), (-0.86, 0.09, 0.09), (-0.98, 0.05, 0.09))
            + _limb(-1, (-0.04, 0.17, -0.09), (-0.34, 0.31, -0.12), (-0.62, 0.10, -0.12), (-0.76, 0.05, -0.12))
            + _arm(1, (0.46, 0.30, 0.16), (0.40, 0.08, 0.26), (0.60, 0.06, 0.32), (0.70, 0.05, 0.34))
            + _arm(-1, (0.44, 0.30, -0.16), (0.60, 0.22, -0.28), (0.40, 0.22, -0.36), (0.20, 0.26, -0.30)))


POSES = {'stand': _stand, 'stride': _strider, 'kneel': _kneel, 'recline': _recline}
_CACHE = {}
LIMB = 1.2  # limbs a touch heavier than the joint table so they read at pediment distance
RX, RZ = 1.0, 0.72  # skin cross-section: wide across the body, shallow front to back


def skin_body(pose, hi, hero=False):
    key = (pose, hi, hero)
    if key in _CACHE: return _CACHE[key]
    J = POSES[pose]()
    hx, hy, hz = next(j[1] for j in J if j[0] == 'head')  # face: hair mass with a bun, nose bridge and chin, all blended into the head by the skin
    J = J + [('hair', (hx, hy + 0.022, hz - 0.03), 0.088, 'head'), ('bun', (hx, hy - 0.02, hz - 0.105), 0.05, 'hair'), ('nose', (hx, hy - 0.006, hz + 0.096), 0.02, 'head'), ('chin', (hx, hy - 0.078, hz + 0.05), 0.034, 'head')]
    idx = {j[0]: i for i, j in enumerate(J)}
    me = bpy.data.meshes.new('sk'); ob = bpy.data.objects.new('sk', me); bpy.context.scene.collection.objects.link(ob)
    me.from_pydata([j[1] for j in J], [(idx[j[3]], i) for i, j in enumerate(J) if j[3]], [])
    sk = ob.modifiers.new('sk', 'SKIN'); sk.use_smooth_shade = True; sk.branch_smoothing = 0.9
    for i, j in enumerate(J):
        d = me.skin_vertices[0].data[i]; d.radius = (j[2] * RX * (1.0 if j[0] in ('pelvis', 'belly', 'chest', 'neck', 'head', 'crown', 'hair', 'bun', 'nose', 'chin') else LIMB), j[2] * RZ * (1.0 if j[0] in ('pelvis', 'belly', 'chest', 'neck', 'head', 'crown', 'hair', 'bun', 'nose', 'chin') else LIMB)); d.use_root = j[3] is None
    sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = sub.render_levels = 2 if (hi or hero) else 1  # hero figures (statues) keep a finer game mesh than pediment figures
    if not hi and hero: dec = ob.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.3
    elif not hi: dec = ob.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.4; dec.use_collapse_triangulate = False
    em = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    out = ([tuple(v.co) for v in em.vertices], [tuple(p.vertices) for p in em.polygons])
    ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear(); bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    _CACHE[key] = out; return out
