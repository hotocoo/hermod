"""
Verification for the village assets (ARCHITECTURE section 14): run `blender -b --factory-startup -P check.py -- [id ...]` (no ids = every glb in public/assets/village).
Per asset: node contract (heroes L1..L3, everything else L1; prop band 60..8000 tris), LOD0 triangle band, LOD ratios, UV0 inside 0..1 (UV1 too when present), UV0/UV1 island overlap (rasterised), texel density band,
degenerate faces (world and UV), edges shared by more than two faces (reported, tolerated for merged solids), image sizes. Exit code 1 on any failure. Run it on UNPACKED float glbs (village-pack.mjs does, before packing): meshopt quantisation collapses tiny UV triangles and fakes degenerate faces.
"""
import sys, os, json, struct, glob
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
DIR = os.environ.get('VILLAGE_ASSET_OUT', os.path.join(ROOT, 'public', 'assets', 'village'))
BANDS = {'hero': (12000, 90000), 'cottage': (4000, 16000), 'signpost': (1500, 9000), 'prop': (60, 8000)}  # LOD0 triangles for the whole asset (all modules)
HEROES = ('hearth', 'chat', 'feed', 'board', 'skein', 'desk', 'arcade')  # interiors: three modules, L1..L3; every other id is a prop or a small building with one module
DENSITY = (60.0, 2600.0)   # texels per world unit (1 unit ~ 4 m) at the authored size
OVERLAP_MAX = 0.004
PX = json.load(open(os.path.join(DIR, 'px.json'))) if os.path.exists(os.path.join(DIR, 'px.json')) else {}


def load(fn):
    b = open(fn, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); off = 20 + n + 8
    return j, b[off:]


def acc(j, bin_, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; ct = {5126: 'f4', 5125: 'u4', 5123: 'u2', 5121: 'u1'}[a['componentType']]; nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dt = np.dtype(ct); stride = bv.get('byteStride') or dt.itemsize * nc; o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.ndarray(shape=(a['count'], nc), dtype=dt, buffer=bin_, offset=o, strides=(stride, dt.itemsize)).copy()


def raster_overlap(uv, tris, res=768):
    cnt = np.zeros((res, res), dtype=np.uint8)
    for t in tris:
        p = uv[t] * res; x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int); x0 = max(x0, 0); y0 = max(y0, 0); x1 = min(x1, res - 1); y1 = min(y1, res - 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5); a, b, c = p
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9: continue
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d; w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d; w2 = 1 - w0 - w1
        inside = (w0 > 0.02) & (w1 > 0.02) & (w2 > 0.02)
        cnt[y0:y1 + 1, x0:x1 + 1] += inside.astype(np.uint8)
    covered = (cnt > 0).sum(); return float((cnt > 1).sum()) / max(1, covered)


def kind(aid): return 'cottage' if aid.startswith('cottage') else ('signpost' if aid == 'signpost' else 'hero' if aid in HEROES else 'prop')


def check(fn):
    aid = os.path.basename(fn).split('.')[0]; ultra = '.ultra' in fn; j, bin_ = load(fn); errs = []; warn = []; info = {}
    names = {n['name'] for n in j['nodes']}
    need = [aid, f'{aid}_L1', f'{aid}_L1_LOD0', f'{aid}_L1_LOD1', f'{aid}_L1_LOD2']
    if kind(aid) == 'hero': need += [f'{aid}_L2', f'{aid}_L3']
    for n in need:
        if n not in names: errs.append(f'missing node {n}')
    # door, smoke and fire empties are pruned from the shipped glb (village-pack); the door position lives in the root extras
    root = next((n for n in j['nodes'] if n['name'] == aid), {})
    if kind(aid) in ('hero', 'cottage') and 'door' not in (root.get('extras') or {}): errs.append('root extras: no door')
    lod_tris = [0, 0, 0]; tex = j.get('images', []); tsz = None
    dens = []; ov0 = []; ov1 = []; degen = 0; nonman = 0
    for nd in j['nodes']:
        if 'mesh' not in nd: continue
        nm = nd['name']; lod = None
        for k in range(3):
            if f'_LOD{k}' in nm: lod = k
        prim = j['meshes'][nd['mesh']]['primitives'][0]; at = prim['attributes']
        pos = acc(j, bin_, at['POSITION']).astype(np.float64); idx = acc(j, bin_, prim['indices']).reshape(-1, 3).astype(np.int64)
        if lod is not None and not ('_win' in nm or '_sign' in nm): lod_tris[lod] += len(idx)
        elif lod == 0: lod_tris[0] += len(idx)
        if lod not in (0, None) or 'TEXCOORD_0' not in at: continue
        if '_win' in nm or '_sign' in nm: continue
        uv0 = acc(j, bin_, at['TEXCOORD_0']).astype(np.float64); uv0[:, 1] = 1 - uv0[:, 1]
        # bake.py ships UV0 only (occlusion is the cavity AO in the ORM red channel; the UV1 sky lightmap was dropped): UV1 is checked only when a file still carries it
        uv1 = None
        if 'TEXCOORD_1' in at: uv1 = acc(j, bin_, at['TEXCOORD_1']).astype(np.float64); uv1[:, 1] = 1 - uv1[:, 1]
        for u, nme in ((uv0, 'UV0'), (uv1, 'UV1')):
            if u is None: continue
            if u.min() < -0.002 or u.max() > 1.002: errs.append(f'{nm}: {nme} outside 0..1')
        pa = pos[idx]; wa = np.linalg.norm(np.cross(pa[:, 1] - pa[:, 0], pa[:, 2] - pa[:, 0]), axis=1) / 2
        ua = uv0[idx]; uar = np.abs((ua[:, 1, 0] - ua[:, 0, 0]) * (ua[:, 2, 1] - ua[:, 0, 1]) - (ua[:, 2, 0] - ua[:, 0, 0]) * (ua[:, 1, 1] - ua[:, 0, 1])) / 2
        degen += int(((wa < 1e-9) | (uar < 1e-12)).sum()); ok = (wa > 1e-6) & (uar > 1e-10)
        size = PX.get(os.path.basename(fn), (4096 if ultra else 2048) if kind(aid) == 'hero' else (2048 if ultra else 1024))  # atlas size: px.json from village-pack, else the bake default (build.py: heroes 2048 / ultra 4096, others 1024 / 2048)
        dens.append(np.sqrt(uar[ok] * size * size / wa[ok]))
        ov0.append(raster_overlap(uv0, idx[ok][::max(1, len(idx) // 6000)]))
        if uv1 is not None: ov1.append(raster_overlap(uv1, idx[ok][::max(1, len(idx) // 6000)]))
        e = np.sort(np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]]), axis=1); _, c = np.unique(e, axis=0, return_counts=True); nonman += int((c > 2).sum())
    lo, hi = BANDS[kind(aid)]
    if not (lo <= lod_tris[0] <= hi * (1.0)): errs.append(f'LOD0 tris {lod_tris[0]} outside {lo}..{hi}')
    if not (lod_tris[1] < lod_tris[0] * 0.7 and lod_tris[2] < lod_tris[1] * 0.7): errs.append(f'LOD ratios off {lod_tris}')
    d = np.concatenate(dens) if dens else np.array([0.0]); info.update(tris=lod_tris, texel_per_unit=dict(p5=round(float(np.percentile(d, 5)), 1), median=round(float(np.median(d)), 1), p95=round(float(np.percentile(d, 95)), 1)),
                                                                       overlap_uv0=round(max(ov0 or [0]), 5), overlap_uv1=round(max(ov1 or [0]), 5), degenerate=degen, edges_gt2=nonman, images=len(tex), bytes=os.path.getsize(fn))
    if np.percentile(d, 5) < DENSITY[0] * (1.0 if not ultra else 2.0) * 0.5: warn.append(f'texel density p5 {np.percentile(d, 5):.0f} px/unit is low')
    if np.median(d) < DENSITY[0] or np.median(d) > DENSITY[1]: errs.append(f'median texel density {np.median(d):.0f} outside {DENSITY}')
    if max(ov0 or [0]) > OVERLAP_MAX: errs.append(f'UV0 overlap {max(ov0):.4f}')
    if max(ov1 or [0]) > OVERLAP_MAX: errs.append(f'UV1 overlap {max(ov1):.4f}')
    if degen: errs.append(f'{degen} degenerate faces')
    return aid, errs, warn, info


if __name__ == '__main__':
    ids = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    files = [os.path.join(DIR, i if i.endswith('.glb') else i + '.glb') for i in ids] or sorted(glob.glob(os.path.join(DIR, '*.glb')))
    bad = 0; report = {}
    for fn in files:
        aid, errs, warn, info = check(fn); report[os.path.basename(fn)] = dict(errors=errs, warnings=warn, **info); bad += bool(errs)
        print(('FAIL ' if errs else 'PASS ') + os.path.basename(fn), json.dumps(info), *errs, *warn, sep=' | ')
    json.dump(report, open(os.path.join(DIR, 'check-report.json'), 'w'), indent=1)
    sys.exit(1 if bad else 0)
