"""Authored foliage and bark PBR maps (numpy synthesis inside Blender, seamless where tiled).
leaf_atlas(kind, ...)  -> 2x2 tiles of leaf sprays with alpha (cards are alpha-tested at 0.42 by the pack step).
bark_maps(kind, ...)   -> tileable base, normal, orm."""
import math
import numpy as np
from nlib import cells_f, fbm, hexrgb, normal_from_height, ramp, ridged, vnoise, ao_from_height

# ---------------------------------------------------------------- leaf drawing
def over(canvas, rgb, a, sl):
    """Straight-alpha 'over' of (rgb, a) onto canvas[sl]."""
    dst = canvas[sl]; da = dst[..., 3:4]; sa = a[..., None]; oa = sa + da * (1 - sa)
    dst[..., :3] = np.where(oa > 1e-5, (rgb * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-5), 0); dst[..., 3:4] = oa


def draw_leaf(cv, hv, cx, cy, ang, L, W, col, col2, kind='ellipse', vein=0.5, droop=0.0):
    """Draw one leaf with its base at (cx, cy) pointing along ang (radians, 0 = +x image). Also accumulates a height field hv."""
    H, Wd = cv.shape[:2]; r = int(L * 1.15 + 4); x0, x1, y0, y1 = max(0, int(cx - r)), min(Wd, int(cx + r)), max(0, int(cy - r)), min(H, int(cy + r))
    if x1 <= x0 or y1 <= y0: return
    yy, xx = np.mgrid[y0:y1, x0:x1]; dx, dy = xx - cx, yy - cy; c, s = math.cos(ang), math.sin(ang)
    u = dx * c + dy * s; v = -dx * s + dy * c; t = np.clip(u / L, 0, 1); v = v - droop * L * t * t
    if kind == 'needle': hw = W * (1 - t * 0.6) * (t > 0)
    elif kind == 'scale': hw = W * np.sin(np.pi * np.clip(t, 0, 1) ** 0.8) ** 0.7 * (1 + 0.25 * np.sin(t * 30))
    elif kind == 'lance': hw = W * np.sin(np.pi * t ** 0.85) ** 0.85
    else: hw = W * np.sin(np.pi * t ** 0.62) ** 0.9 * (1 - 0.15 * t)
    inside = (u >= 0) & (u <= L); a = np.clip((hw - np.abs(v)) * 1.2 + 0.5, 0, 1) * inside
    if not a.any(): return
    k = np.clip(1 - np.abs(v) / np.maximum(hw, 1e-3), 0, 1); mid = np.exp(-(v / max(1.0, W * 0.07)) ** 2) * vein
    side = np.clip(np.sin((u * 0.9 + np.abs(v) * 1.6) * (6.0 / max(L, 8) * 8)) , 0, 1) * 0.12 * vein * (np.abs(v) > 1.5)
    shade = np.clip(0.78 + 0.28 * k - mid * 0.35 - side + 0.12 * t, 0, 1.3)
    rgb = (col * (1 - t[..., None]) + col2 * t[..., None]) * shade[..., None]
    over(cv, np.clip(rgb, 0, 1), a, (slice(y0, y1), slice(x0, x1)))
    sub = hv[y0:y1, x0:x1]; hh = np.clip(0.4 + 0.45 * k ** 0.6 - mid * 0.25 - side * 0.5, 0, 1) * a
    np.maximum(sub, hh, out=sub)


def spray(cv, hv, rs, ox, oy, size, kind, p):
    """One foliage spray in a size x size tile at (ox, oy): a main twig from the bottom centre with side twigs; leaves in rows along each."""
    cx0, base_y = ox + size * 0.5, oy + size * 0.97; top_y = oy + size * 0.05; Lm = p['L'] * size / 1024
    col = hexrgb(p['c1']); col2 = hexrgb(p['c2']); tw = hexrgb(p.get('twig', 0x5a4632)); px = size / 1024
    items = []

    def twig(x, y, ang, length, depth):
        n = max(3, int(p['n'] * length / (base_y - top_y) * (1.0 if depth == 0 else 0.9)))
        ex, ey = x + math.cos(ang) * length, y + math.sin(ang) * length
        items.append(('t', x, y, ang, length, 2.4 * px * (2 - depth)))
        for i in range(n):
            t = (i + 0.4 + 0.3 * rs.rand()) / n; bx, by = x + (ex - x) * t, y + (ey - y) * t; sc = (1.0 - 0.45 * t) * (0.8 + 0.3 * rs.rand()) * (0.8 if depth else 1.0)
            for side in ((1, -1) if p.get('pair') else (1 if i % 2 == 0 else -1,)):
                a = ang + side * math.radians(p['spread'] + rs.randn() * 9); items.append(('l', bx, by, a, Lm * sc, sc))
            if depth == 0 and i % 3 == 1 and t < 0.8 and p.get('twigs', True) and kind not in ('needle',):
                twig(bx, by, ang + (1 if i % 2 else -1) * math.radians(48 + rs.randn() * 6), length * (0.34 + 0.12 * rs.rand()), 1)
        items.append(('l', ex, ey, ang, Lm * 0.62, 0.7))
    twig(cx0, base_y, -math.pi / 2, base_y - top_y, 0)
    for it in items:
        if it[0] == 't': draw_leaf(cv, hv, it[1], it[2], it[3], it[4], it[5], tw, tw * 0.8, 'needle', 0)
    for it in items:
        if it[0] == 'l':
            c = np.clip(col * (0.85 + 0.3 * rs.rand()), 0, 1); c2 = np.clip(col2 * (0.85 + 0.3 * rs.rand()), 0, 1)
            draw_leaf(cv, hv, it[1], it[2], it[3], it[4], it[4] * p['w'], c, c2, kind, p.get('vein', 0.5), p.get('droop', 0.0))


def leaf_atlas(name, kind, p, size=2048, seed=1):
    """Return (base, normal, orm) arrays for a 2x2 atlas (tile = size/2) of sprays."""
    rs = np.random.RandomState(seed); cv = np.zeros((size, size, 4), np.float32); hv = np.zeros((size, size), np.float32); t = size // 2
    for ty in range(2):
        for tx in range(2):
            spray(cv, hv, rs, tx * t, ty * t, t, kind, p)
    a = cv[..., 3]
    # dilate colour into transparent texels so mips and linear filtering do not fringe dark
    base = cv.copy(); rgb = base[..., :3]; m = (a > 0.02)[..., None]; mean = (rgb * m).sum((0, 1)) / max(m.sum(), 1)
    fill = np.where(m, rgb, mean[None, None, :]); base[..., :3] = fill
    nrm = normal_from_height(hv, 3.0, wrap=False)
    g = np.clip(fbm(size, 6, seed + 3, 3), 0, 1); occ = np.clip(0.55 + 0.45 * hv + 0.1 * g, 0, 1)
    orm = np.stack([occ, np.full_like(occ, p.get('rough', 0.62)), np.zeros_like(occ), np.ones_like(occ)], -1)
    return base, nrm, orm


LEAF = dict(
    oak=dict(kind='ellipse', n=9, L=210, w=0.46, spread=55, c1=0x54772f, c2=0x7a9c40, vein=0.7, pair=False),
    birch=dict(kind='ellipse', n=11, L=150, w=0.5, spread=50, c1=0x6f9a3a, c2=0x93b84a, vein=0.6, pair=False),
    apple=dict(kind='ellipse', n=8, L=190, w=0.42, spread=50, c1=0x4f7a2e, c2=0x6e9b3d, vein=0.7, pair=False),
    willow=dict(kind='lance', n=16, L=260, w=0.11, spread=32, c1=0x7c9a3c, c2=0xa0b856, vein=0.35, pair=True, droop=0.18),
    plane=dict(kind='ellipse', n=6, L=250, w=0.6, spread=60, c1=0x56783a, c2=0x7a9a48, vein=0.8, pair=False),
    olive=dict(kind='lance', n=14, L=190, w=0.1, spread=40, c1=0x7d8f5a, c2=0xb4c19a, vein=0.3, pair=True, rough=0.5),
    pine=dict(kind='needle', n=22, L=230, w=0.03, spread=22, c1=0x2f4a2b, c2=0x486a3a, vein=0.0, pair=True, rough=0.7),
    stonepine=dict(kind='needle', n=24, L=250, w=0.03, spread=18, c1=0x39552f, c2=0x587a42, vein=0.0, pair=True, rough=0.7),
    cypress=dict(kind='scale', n=26, L=150, w=0.17, spread=26, c1=0x2f4a34, c2=0x486a4a, vein=0.0, pair=True, rough=0.75),
    poplar=dict(kind='ellipse', n=12, L=150, w=0.55, spread=45, c1=0x4f7a2e, c2=0x86b04a, vein=0.6, pair=False),
    hedge=dict(kind='ellipse', n=12, L=130, w=0.5, spread=55, c1=0x3d5f2a, c2=0x587e36, vein=0.6, pair=True),
)


# ---------------------------------------------------------------- bark
def bark_maps(kind, size=1024, seed=3):
    """Tileable bark: u across (x), v along the trunk (y). Returns (base, normal, orm)."""
    n = size
    if kind == 'oak':
        h = ridged(n, 9, seed, 4, (1, 0.28)) * 0.75 + fbm(n, 5, seed + 4, 3) * 0.25; h = np.clip((h - 0.35) * 1.6, 0, 1)
        col = ramp(h, [(0, 0x1d1712), (0.4, 0x3a2e24), (0.8, 0x5a4b3c), (1, 0x7a6a57)]); rough = 0.95
    elif kind == 'birch':
        f1, f2, cid = cells_f(n, 7, seed, 0.7); h0 = fbm(n, 4, seed, 4, 0.5, (1, 0.4))
        marks = np.clip((vnoise(n, 3, seed + 6, (4, 18)) - 0.58) * 6, 0, 1) * np.clip(vnoise(n, 20, seed + 8, (1, 1)) * 1.6 - 0.1, 0, 1)
        h = np.clip(0.55 + 0.25 * h0 - 0.35 * marks, 0, 1); col = ramp(np.clip(h0, 0, 1), [(0, 0xd8d4c8), (1, 0xf0ede4)]) * (1 - marks[..., None] * 0.88) + hexrgb(0x2a2420) * marks[..., None] * 0.88
        rough = 0.7
    elif kind in ('pine', 'stonepine'):
        f1, f2, cid = cells_f(n, 10, seed, 0.8); crack = np.clip((f2 - f1) * 7, 0, 1); h = np.clip(crack * 0.7 + fbm(n, 12, seed + 2, 3, 0.5, (1, 0.35)) * 0.4, 0, 1)
        col = ramp(h, [(0, 0x241a14), (0.45, 0x5a3a28), (0.85, 0x8a5a3a), (1, 0xa06a46)]) * (0.9 + 0.2 * cid[..., None]); rough = 0.9
    elif kind == 'plane':
        f1, f2, cid = cells_f(n, 4, seed, 0.9); blotch = fbm(n, 3, seed + 1, 4); h = np.clip(0.5 + 0.3 * (f2 - f1) * 3 + 0.2 * fbm(n, 14, seed + 5, 3), 0, 1)
        col = ramp(np.clip(blotch + (cid - 0.5) * 0.5, 0, 1), [(0, 0x6b6a58), (0.4, 0x9a9a84), (0.7, 0xc6c4ae), (1, 0xd8d2b8)]); rough = 0.88
    elif kind == 'olive':
        h = ridged(n, 6, seed, 4, (1, 0.5)) * 0.6 + fbm(n, 9, seed + 7, 4) * 0.4; col = ramp(np.clip(h, 0, 1), [(0, 0x3a3630), (0.5, 0x6b665a), (1, 0xa09a88)]); rough = 0.92
    elif kind == 'cypress':
        h = fbm(n, 14, seed, 4, 0.55, (1, 0.12)); col = ramp(h, [(0, 0x3a2418), (0.5, 0x6a4430), (1, 0x8c6040)]); rough = 0.95
    elif kind == 'willow':
        h = ridged(n, 7, seed, 4, (1, 0.35)) * 0.7 + fbm(n, 12, seed + 4, 3) * 0.3; col = ramp(np.clip(h, 0, 1), [(0, 0x28231c), (0.5, 0x4e463a), (1, 0x7d725f)]); rough = 0.93
    else:  # apple and generic
        h = ridged(n, 12, seed, 4, (1, 0.4)) * 0.6 + fbm(n, 16, seed + 2, 3) * 0.4; col = ramp(np.clip(h, 0, 1), [(0, 0x2e261f), (0.5, 0x5a4e42), (1, 0x877864)]); rough = 0.9
    nrm = normal_from_height(h, 3.2 if kind != 'birch' else 1.6); occ = ao_from_height(h, 8, 1.2)
    orm = np.stack([occ, np.full_like(h, rough), np.zeros_like(h), np.ones_like(h)], -1); base = np.concatenate([np.clip(col * (0.7 + 0.3 * occ[..., None]), 0, 1), np.ones((n, n, 1))], -1)
    return base, nrm, orm


def grass_atlas(size=2048, seed=9, palette='village'):
    """2x2 tiles, each a clump of 14-22 curved blades fanning from the bottom centre (alpha-tested card atlas)."""
    rs = np.random.RandomState(seed); cv = np.zeros((size, size, 4), np.float32); hv = np.zeros((size, size), np.float32); t = size // 2
    c1, c2 = (0x4a7a2a, 0x9cc24e) if palette == 'village' else (0x7a8a45, 0xcbc47a)
    for ty in range(2):
        for tx in range(2):
            n = 14 + rs.randint(0, 9); ox, oy = tx * t, ty * t
            for i in range(n):
                a = -math.pi / 2 + rs.randn() * 0.32; L = t * (0.55 + 0.4 * rs.rand()); w = t * (0.012 + 0.012 * rs.rand()); droop = rs.randn() * 0.35
                col = hexrgb(c1) * (0.8 + 0.4 * rs.rand()); col2 = hexrgb(c2) * (0.8 + 0.4 * rs.rand())
                draw_leaf(cv, hv, ox + t * (0.5 + rs.randn() * 0.06), oy + t * 0.98, a, L, w * 1.0, np.clip(col, 0, 1), np.clip(col2, 0, 1), 'lance', 0.4, droop)
    base = cv.copy(); m = (cv[..., 3] > 0.02)[..., None]; mean = (cv[..., :3] * m).sum((0, 1)) / max(m.sum(), 1); base[..., :3] = np.where(m, cv[..., :3], mean[None, None, :])
    nrm = normal_from_height(hv, 2.0, wrap=False); occ = np.clip(0.4 + 0.6 * (1 - np.linspace(0, 1, size)[:, None] % 0.5 * 2) , 0, 1) * np.ones((size, size))
    orm = np.stack([np.clip(0.55 + 0.45 * hv, 0, 1), np.full((size, size), 0.6, np.float32), np.zeros((size, size), np.float32), np.ones((size, size), np.float32)], -1)
    return base, nrm, orm
