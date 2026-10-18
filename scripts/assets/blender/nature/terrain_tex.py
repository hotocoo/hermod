"""Terrain PBR sets, two palettes (village warm green, sanctuary dry Mediterranean). Seamless 4096 maps: bc (sRGB), n (OpenGL normal), orm, h (height).
Run: blender -b --factory-startup -P terrain_tex.py -- [village|sanctuary] [kind ...]
Maps land in .cache/nature/maps/<palette>/<kind>_{bc,n,orm,h}.png; pack.mjs encodes them to KTX2 (high 2048, ultra 4096)."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import bpy
import nlib
from nlib import cells_f, fbm, ridged, vnoise, normal_from_height, ao_from_height, ramp, hexrgb, ROOT

MAPS = os.path.join(ROOT, '.cache', 'nature', 'maps')
SIZE = int(os.environ.get('TERRAIN_PX', 4096))
# tile world size in metres (1 world unit ~ 4 m); texel density = SIZE / tileM px per metre
TILE_M = dict(grass=6.0, meadow=6.0, path=3.0, dirt=3.0, cobble=3.0, flagstone=4.0, sand=4.0, cliff=6.0, mud=3.0)
PAL = dict(
    village=dict(
        grass=[(0, 0x25461a), (0.35, 0x3f6a26), (0.7, 0x62903a), (1, 0x9ab84a)], dry=0x9a8f4a, clover=0x3f7a3a, dirt=[(0, 0x4a3524), (0.5, 0x7a5b3c), (1, 0xa88660)], stone=[(0, 0x6e6a60), (0.5, 0x9a9486), (1, 0xc2bcac)],
        sand=[(0, 0xb8a47a), (1, 0xe2d2a4)], cliff=[(0, 0x4c463e), (0.5, 0x7d7466), (1, 0xa59b88)], mud=[(0, 0x2d2118), (1, 0x5a4330)], flower=0xe8d04a),
    sanctuary=dict(
        grass=[(0, 0x4f5a2a), (0.4, 0x7a8440), (0.75, 0xa6a35c), (1, 0xc9bf80)], dry=0xb59f5a, clover=0x6a8a40, dirt=[(0, 0x7d6544), (0.5, 0xb59a6c), (1, 0xd9c394)], stone=[(0, 0xa89f88), (0.5, 0xd2c8ae), (1, 0xf0e8d2)],
        sand=[(0, 0xd2bd86), (1, 0xf0e2b6)], cliff=[(0, 0x8c7f66), (0.5, 0xc2b394), (1, 0xe6dcc0)], mud=[(0, 0x4a3b2a), (1, 0x7a634a)], flower=0xe8e4d0),
)


def grain(n, seed, f=180, amp=1.0): return (vnoise(n, f, seed) - 0.5) * amp


def make(kind, pal, n, seed):
    P = PAL[pal]; s = seed
    if kind in ('grass', 'meadow'):
        blotch = fbm(n, 5, s, 5); blades = fbm(n, 60, s + 1, 3, 0.55, (1, 0.35)); fine = vnoise(n, 400, s + 2)
        h = np.clip(0.35 + 0.45 * blades + 0.2 * fine, 0, 1)
        big = fbm(n, 2, s + 21, 4); mid = fbm(n, 9, s + 22, 4)  # large-scale yellow-green to deep green variation
        col = ramp(np.clip(0.28 * blotch + 0.3 * blades + 0.12 * fine + 0.55 * big - 0.12 + 0.2 * (mid - 0.5), 0, 1), P['grass'])
        dry = np.clip((fbm(n, 3, s + 23, 4) - 0.6) * 5, 0, 1)[..., None]; col = col * (1 - dry * 0.7) + hexrgb(P['dry'])[None, None, :] * (0.8 + 0.4 * blades[..., None]) * dry * 0.7
        f1c, f2c, idc = cells_f(n, 60, s + 24, 1.0); clv = ((f1c < 0.3) & (idc > 0.6) & (fbm(n, 5, s + 25, 3) > 0.5))[..., None]; col = np.where(clv, hexrgb(P['clover'])[None, None, :] * (0.8 + 0.5 * idc[..., None]), col)
        if kind == 'meadow':
            dirt = np.clip((fbm(n, 4, s + 7, 4) - 0.55) * 4, 0, 1)[..., None]; col = col * (1 - dirt) + ramp(fbm(n, 30, s + 8, 3), P['dirt']) * dirt
            f1, f2, cid = cells_f(n, 90, s + 9, 1.0); bloom = (f1 < 0.22) & (cid > 0.9) & (fbm(n, 6, s + 11, 3) > 0.52); col = np.where(bloom[..., None], hexrgb(P['flower'])[None, None, :] * (0.8 + 0.4 * cid[..., None]), col); h = np.where(bloom, h + 0.1, h)
        rough = np.full((n, n), 0.9, np.float32) - 0.1 * blades; mat = 0.0
    elif kind == 'path':
        g = fbm(n, 20, s, 5); f1, f2, pid = cells_f(n, 150, s + 3, 0.95); peb = np.clip(1 - f1 * 6, 0, 1) * (pid > 0.7)
        ruts = np.exp(-((np.arange(n)[None, :] / n - 0.28) / 0.06) ** 2) + np.exp(-((np.arange(n)[None, :] / n - 0.72) / 0.06) ** 2)  # wheel/foot lines along v, tileable
        ruts = ruts * (0.6 + 0.4 * fbm(n, 8, s + 4, 3, 0.5, (1, 0.2)))
        wear = np.clip(0.5 + 0.4 * (vnoise(n, 7, s + 6) - 0.5) * 2 - 0.35 * ruts, 0, 1)
        h = np.clip(0.55 * g + 0.3 * peb + 0.25 * wear - 0.28 * ruts + grain(n, s + 5, 300, 0.2), 0, 1)
        col = ramp(np.clip(g * 0.7 + 0.35 * wear - 0.2 * ruts, 0, 1), P['dirt']) * (0.9 + 0.25 * peb[..., None] * pid[..., None]) * (1 - 0.18 * ruts[..., None]); rough = np.full((n, n), 0.9, np.float32) - 0.12 * wear; mat = 0.0
    elif kind == 'dirt':
        g = fbm(n, 24, s, 5); peb_f1, peb_f2, pid = cells_f(n, 140, s + 3, 0.95); peb = np.clip(1 - peb_f1 * 5.5, 0, 1) * (pid > 0.55)
        crack = np.clip((cells_f(n, 14, s + 4, 0.9)[1] - cells_f(n, 14, s + 4, 0.9)[0]) * 14, 0, 1)
        h = np.clip(0.45 * g + 0.35 * peb + 0.2 * crack + grain(n, s + 5, 300, 0.25), 0, 1); col = ramp(np.clip(g * 0.8 + 0.2 * crack, 0, 1), P['dirt']) * (0.85 + 0.3 * peb[..., None] * pid[..., None]); rough = np.full((n, n), 0.93, np.float32); mat = 0.0
    elif kind == 'cobble':
        f1, f2, cid = cells_f(n, 22, s, 0.55); gap = np.clip((f2 - f1) * 9, 0, 1); dome = np.clip(1 - f1 * 2.2, 0, 1) ** 0.7
        h = gap * (0.55 + 0.4 * dome) * (0.9 + 0.1 * cid) + grain(n, s + 2, 260, 0.1); h = np.clip(h, 0, 1)
        col = ramp(np.clip(cid * 0.8 + 0.2 * fbm(n, 40, s + 3, 3), 0, 1), P['stone']) * (0.55 + 0.45 * gap[..., None]); col = col * (1 - (1 - gap)[..., None] * 0.45) + ramp(fbm(n, 60, s + 5, 3), P['dirt']) * (1 - gap)[..., None] * 0.45
        rough = np.clip(0.9 - 0.18 * gap, 0, 1).astype(np.float32); mat = 0.0
    elif kind == 'flagstone':
        f1, f2, cid = cells_f(n, 7, s, 0.8); gap = np.clip((f2 - f1) * 14, 0, 1)
        h = np.clip(gap * (0.6 + 0.2 * fbm(n, 10, s + 1, 3)) + grain(n, s + 2, 300, 0.1), 0, 1); veins = np.clip(ridged(n, 7, s + 6, 4, (1, 0.6)) - 0.7, 0, 1) * 1.8
        col = ramp(np.clip(cid * 0.7 + 0.3 * fbm(n, 12, s + 3, 4), 0, 1), P['stone']) * (0.82 + 0.18 * gap[..., None]) * (1 - veins[..., None] * 0.15); rough = np.clip(0.85 - 0.2 * gap, 0, 1).astype(np.float32); mat = 0.0
    elif kind == 'sand':
        rip = np.sin((vnoise(n, 6, s, (1, 3)) * 14 + np.arange(n)[None, :] * 0.0) * 1.0) * 0.5 + 0.5; g = fbm(n, 14, s + 2, 4)
        h = np.clip(0.4 + 0.25 * rip * g + 0.35 * vnoise(n, 500, s + 3), 0, 1); col = ramp(np.clip(g * 0.7 + 0.3 * vnoise(n, 380, s + 4), 0, 1), P['sand']); rough = np.full((n, n), 0.97, np.float32); mat = 0.0
    elif kind == 'cliff':
        # fractured rock: domain-warped blocks with a crack network and a few irregular (never periodic) ledges. No sine strata: those read as corduroy at any viewing distance.
        yy, xx = np.mgrid[0:n, 0:n]
        def warp(a, wx, wy, amp):
            return a[(yy + (wy - 0.5) * amp * n).astype(int) % n, (xx + (wx - 0.5) * amp * n).astype(int) % n]
        w1, w2 = fbm(n, 3, s + 31, 4), fbm(n, 3, s + 32, 4)
        blocks = warp(ridged(n, 5, s + 1, 7), w1, w2, 0.2)
        crack = np.clip((warp(ridged(n, 8, s + 12, 5), w2, w1, 0.12) - 0.9) * 10, 0, 1)   # thin irregular fractures along the crest lines of a second warped ridge field
        ledge = vnoise(n, 7, s + 6, (0.12, 1)); ledge = np.clip((ledge - 0.5) * 3.0 + 0.5, 0, 1)   # 1 lattice column wide: bands vary in height, not in a fixed period
        streak = vnoise(n, 18, s + 7, (1, 0.07)) * 0.6 + vnoise(n, 41, s + 8, (1, 0.07)) * 0.4   # vertical rain staining: a fixed-height lattice row, so it can never read as horizontal bands
        h = np.clip(0.7 * blocks + 0.15 * fbm(n, 12, s + 9, 5) + 0.08 * ledge - 0.25 * crack + grain(n, s + 3, 260, 0.06), 0, 1)
        tone = np.clip(0.35 * blocks + 0.3 * fbm(n, 3, s + 4, 5) + 0.25 * streak + 0.1 * ledge, 0, 1); tone = np.clip((tone - 0.5) * 1.25 + 0.5, 0, 1); edge = 1 - crack
        col = ramp(tone, P['cliff']) * (0.7 + 0.3 * edge[..., None]); rough = np.full((n, n), 0.92, np.float32); mat = 0.0
    elif kind == 'mud':
        g = fbm(n, 9, s, 5); wet = np.clip((fbm(n, 5, s + 2, 4) - 0.5) * 5, 0, 1); h = np.clip(0.5 * g + 0.2 * vnoise(n, 300, s + 3) + 0.3 * (1 - wet), 0, 1); col = ramp(g, P['mud']) * (1 - 0.35 * wet[..., None]); rough = (0.95 - 0.7 * wet).astype(np.float32); mat = 0.0
    else: raise ValueError(kind)
    nrm = normal_from_height(h, {'path': 3.2, 'cobble': 5.0, 'flagstone': 4.0, 'cliff': 3.2, 'grass': 2.2, 'meadow': 2.2, 'dirt': 3.0, 'sand': 1.8, 'mud': 2.4}[kind]); occ = ao_from_height(h, 10, 1.0)
    base = np.concatenate([np.clip(col * (0.78 + 0.22 * occ[..., None]), 0, 1), np.ones((n, n, 1))], -1)
    orm = np.stack([occ, rough, np.full((n, n), mat, np.float32), np.ones((n, n), np.float32)], -1); hh = np.stack([h, h, h, np.ones_like(h)], -1)
    return base, nrm, orm, hh


def make_water(n, seed):
    """Tileable water normal (two crossed ripple fields), flow vectors (curl of a noise potential, RG) and a foam mask (B in the flow map)."""
    a = fbm(n, 12, seed, 5, 0.5, (1, 1)); b = fbm(n, 21, seed + 4, 4, 0.55, (1.3, 0.7)); h = np.clip(a * 0.6 + b * 0.4, 0, 1)
    nrm = normal_from_height(h, 2.6); pot = fbm(n, 4, seed + 9, 4)
    gy, gx = (np.roll(pot, -1, 0) - np.roll(pot, 1, 0)) * 0.5 * n / 8, (np.roll(pot, -1, 1) - np.roll(pot, 1, 1)) * 0.5 * n / 8
    vx, vy = gy, -gx; m = np.maximum(np.sqrt(vx * vx + vy * vy), 1e-4) * 0 + 1.0; foam = np.clip((ridged(n, 16, seed + 12, 4) - 0.78) * 5, 0, 1)
    flow = np.stack([np.clip(vx * 0.5 + 0.5, 0, 1), np.clip(vy * 0.5 + 0.5, 0, 1), foam, np.ones_like(h)], -1)
    return nrm, flow


def save(arr, path, nc):
    """Write a numpy map (top row first) as an 8-bit PNG via bpy (no generated-image colour-space pitfalls)."""
    os.makedirs(os.path.dirname(path), exist_ok=True); h, w = arr.shape[:2]; a = np.asarray(arr, np.float32)
    im = bpy.data.images.new('t', w, h, alpha=True); im.colorspace_settings.name = 'Non-Color' if nc else 'sRGB'; im.pixels.foreach_set(np.flipud(a).ravel())
    im.filepath_raw = path; im.file_format = 'PNG'; im.save(); bpy.data.images.remove(im)


def build(pal, kinds):
    seed0 = 101 if pal == 'village' else 202; stats = []
    for k in kinds:
        if k == 'water':
            nrm, flow = make_water(SIZE, seed0 + 77); d = os.path.join(MAPS, pal)
            save(nrm, os.path.join(d, 'water_n.png'), True); save(flow, os.path.join(d, 'water_flow.png'), True); stats.append(dict(id=f'{pal}_water', px=SIZE, tileM=12.0, kind='water')); print('MAP', pal, k, flush=True); continue
        i = list(TILE_M).index(k); base, nrm, orm, hh = make(k, pal, SIZE, seed0 + i * 13); d = os.path.join(MAPS, pal)
        save(base, os.path.join(d, k + '_bc.png'), False); save(nrm, os.path.join(d, k + '_n.png'), True); save(orm, os.path.join(d, k + '_orm.png'), True); save(hh, os.path.join(d, k + '_h.png'), True)
        stats.append(dict(id=f'{pal}_{k}', px=SIZE, tileM=TILE_M[k], texelsPerM=round(SIZE / TILE_M[k], 1), kind=k)); print('MAP', pal, k, flush=True)
    os.makedirs(MAPS, exist_ok=True); lp = os.path.join(MAPS, pal + '.json'); old = json.load(open(lp)) if os.path.exists(lp) else []
    byid = {s['id']: s for s in old}; byid.update({s['id']: s for s in stats}); json.dump(list(byid.values()), open(lp, 'w'), indent=1)


if __name__ == '__main__':
    a = nlib.args(); pals = [x for x in a if x in PAL] or list(PAL); kinds = [x for x in a if x not in PAL] or list(TILE_M) + ['water']
    for p in pals: build(p, kinds)
