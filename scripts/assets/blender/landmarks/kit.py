"""Kit pieces, cottage variants, lived-in decor and the xystos for the sanctuary. Same K builder as arch.py (k.hi = high-poly source, else game mesh).
Conventions: footprint centred on the origin, +z front, y up, 1 unit ~ 4 m. Kit pieces run along z and are centred (see src/scene/site/kitpieces.ts)."""
import math
from lib import DIMS, TAU


def _ring(k, n, r, y0, h, rr, mat, seg=10, sz=1.0, cx=0.0, cz=0.0):
    """n small lathe posts on a circle (rail posts, fence stakes)."""
    for i in range(n):
        a = TAU * i / n
        k.lathe(cx + math.sin(a) * r, y0, cz + math.cos(a) * r, [(0.0, 0.0), (rr, 0.0), (rr * 0.8, h), (0.0, h)], seg, mat)


def _plank_deck(k, w, d, y0, th, mat, n=None, gap=0.012):
    n = n or max(2, int(w / 0.14)); pw = w / n
    for i in range(n): k.box(-w / 2 + (i + 0.5) * pw, y0, 0, pw - gap, th, d, mat)


# ---------------------------------------------------------------- kit pieces
def foundation(k):
    k.ashlar(0, -0.25, 0, 4.0, 0.3, 4.0, 'lime', course=0.15, block=0.6)
    k.box(0, 0.05, 0, 3.6, 0.04, 3.6, 'marble')
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box(sx * 1.7, 0.09, sz * 1.7, 0.3, 0.1, 0.3, 'lime')
    if k.hi:
        for i in range(6): k.box(-1.5 + i * 0.6, 0.09, 0.0, 0.025, 0.004, 3.2, 'stone')
        for i in range(6): k.box(0.0, 0.09, -1.5 + i * 0.6, 3.2, 0.004, 0.025, 'stone')


def wall_seg(k):
    k.ashlar(0, -0.25, 0, 0.32, 1.0, 1.3, 'lime', course=0.2, block=0.5)
    k.box(0, 0.75, 0, 0.42, 0.07, 1.3, 'marble')
    for i in range(5): k.box(0, 0.82, -0.52 + i * 0.26, 0.34, 0.07, 0.23, 'lime')  # coping stones
    k.box(0, 0.7, 0, 0.36, 0.03, 1.32, 'lime'); k.box(0, -0.25, 0, 0.4, 0.1, 1.34, 'stone')  # drip course and plinth


def wall_post(k):
    k.ashlar(0, -0.25, 0, 0.4, 1.08, 0.4, 'marble', course=0.18, block=0.4)
    k.box(0, 0.83, 0, 0.5, 0.06, 0.5, 'lime')
    k.lathe(0, 0.89, 0, [(0.0, 0.0), (0.16, 0.0), (0.12, 0.08), (0.0, 0.1)], 16, 'marble')
    k.box(0, -0.25, 0, 0.46, 0.1, 0.46, 'stone')
    for sx in (-1, 1): k.box(sx * 0.2, 0.2, 0, 0.03, 0.4, 0.38, 'lime')


def retain_seg(k):
    # drystone: irregular courses of fieldstone, slightly battered (leaning) face
    k.ashlar(0, -0.5, 0, 0.3, 1.5, 1.3, 'stone', course=0.17, block=0.34)
    k.box(0, 1.0 - 0.02, 0, 0.4, 0.06, 1.3, 'marble')
    for i in range(4): k.box(0, 1.03, -0.45 + i * 0.3, 0.34, 0.05, 0.27, 'lime')
    for i in range(10 if k.hi else 6): k.rock(-0.6 + i * (0.13 if k.hi else 0.22), 0.5 + (i * 7 % 5) * 0.08, 0.17, 0.07, 'stone', seed=i, squash=0.7, sub=2 if k.hi else 1)  # protruding fieldstones also on the game mesh


def bridge(k):
    L = 3.6; w = 1.9
    k.box(0, 0.0, 0, w, 0.12, L + 0.5, 'lime')
    for sd in (-1, 1):
        k.ashlar(sd * (w / 2), 0.12, 0, 0.16, 0.2, L + 0.5, 'marble', course=0.1, block=0.5)
        for i in range(5): k.box(sd * (w / 2), 0.32, -L / 2 - 0.15 + i * (L + 0.3) / 4, 0.2, 0.05, 0.2, 'lime')
    for e in (-1, 1): k.ashlar(0, -0.3, e * (L / 2 + 0.2), w + 0.2, 0.5, 0.34, 'stone', course=0.17, block=0.5)
    with k.frame(0, 0, 0): k.tube_arch(0, -0.62, 0, w - 0.4, 0.62, L + 0.4, 0.09, 'stone', n=14 if k.hi else 10)


def pier_deck(k):
    _plank_deck(k, 1.0, 0.8, -0.04, 0.07, 'wood', n=8 if k.hi else 3)
    for sd in (-1, 1): k.box(sd * 0.45, -0.12, 0, 0.1, 0.1, 0.8, 'wood')
    for i in range(4): k.lathe(-0.36 + i * 0.24, 0.02, 0.36, [(0, 0), (0.014, 0), (0.014, 0.012), (0, 0.012)], 8, 'rope')
    k.box(0, -0.12, 0, 0.9, 0.06, 0.1, 'wood')


def pier_post(k):
    k.lathe(0, 0, 0, [(0.0, 0.0), (0.05, 0.0), (0.055, 2.9), (0.05, 3.2), (0.0, 3.2)], 12 if k.hi else 8, 'wood')
    k.lathe(0, 3.0, 0, [(0.058, 0.0), (0.062, 0.05), (0.058, 0.1)], 16, 'rope')
    k.lathe(0, 3.2, 0, [(0.0, 0.0), (0.05, 0.0), (0.035, 0.05), (0.0, 0.07)], 12, 'wood')
    for i in range(4): k.lathe(0, 0.4 + i * 0.7, 0, [(0.052, 0.0), (0.058, 0.0), (0.058, 0.012), (0.052, 0.012)], 12, 'rope')


def gate_pier(k):
    k.ashlar(0, -0.1, 0, 0.5, 1.2, 0.5, 'marble', course=0.2, block=0.5)
    k.box(0, 1.1, 0, 0.62, 0.1, 0.62, 'lime')
    k.lathe(0, 1.2, 0, [(0.0, 0.0), (0.15, 0.0), (0.12, 0.1), (0.0, 0.12)], 20, 'marble')
    k.box(0, -0.15, 0, 0.58, 0.1, 0.58, 'stone')
    for sx in (-1, 1):
        for sz in (-1, 1): k.box(sx * 0.22, 0.0, sz * 0.22, 0.06, 1.1, 0.06, 'lime')


def stair_seg(k):
    k.ashlar(0, -0.12, 0, 1.4, 0.28, 0.6, 'lime', course=0.14, block=0.7)
    k.box(0, 0.12, -0.02, 1.44, 0.04, 0.66, 'marble')
    for i in range(3): k.box(-0.5 + i * 0.5, 0.16, -0.02, 0.46, 0.02, 0.6, 'lime')
    for sx in (-1, 1): k.box(sx * 0.7, -0.14, 0, 0.06, 0.28, 0.62, 'stone')


def mole_seg(k):
    k.ashlar(0, 0.0, 0, 1.6, 3.0, 1.5, 'stone', course=0.3, block=0.6)
    for i in range(4): k.rock(-0.55 + i * 0.37, 3.0, ((i * 5) % 3 - 1) * 0.3, 0.3, 'rock', seed=i, squash=0.5, sub=2)


# ---------------------------------------------------------------- cottages (footprint ~1.9 x 1.6, front +z)
W, D = 1.9, 1.6


def _door(k, x, z, w=0.3, h=0.55, mat='wood'):
    k.box(x, 0.0, z, w, h, 0.05, 'dark'); k.box(x, h, z, w + 0.14, 0.07, 0.09, mat)
    for sx in (-1, 1): k.box(x + sx * (w / 2 + 0.03), 0.0, z, 0.06, h + 0.06, 0.07, mat)


def _slit(k, x, y, z, w=0.14, h=0.2):
    k.box(x, y, z, w, h, 0.04, 'dark'); k.box(x, y + h, z, w + 0.08, 0.04, 0.07, 'wood'); k.box(x, y - 0.04, z, w + 0.1, 0.04, 0.08, 'lime')


def _bricks(k, cx, cz, w, d, h, yaw=0.0, mat='mud'):
    k.ashlar(cx, 0.0, cz, w, h, d, mat, yaw, course=0.09, block=0.26)


def _awning(k, x, y, z, w, drop, mat='cloth'):
    k.cloth((x - w / 2, y + drop, z + 0.45), (x + w / 2, y + drop, z + 0.45), (x - w / 2, y, z), (x + w / 2, y, z), mat, sag=0.03, nx=7, nz=3)
    for sx in (-1, 1): k.beam((x + sx * w / 2, 0.0, z + 0.45), (x + sx * w / 2, y + drop, z + 0.45), 0.04, 'wood')


def _jar(k, x, z, s=1.0, mat='terra'):
    k.lathe(x, 0, z, [(0.0, 0.0), (0.05 * s, 0.0), (0.1 * s, 0.1 * s), (0.11 * s, 0.17 * s), (0.07 * s, 0.25 * s), (0.05 * s, 0.3 * s), (0.065 * s, 0.33 * s), (0.0, 0.33 * s)], 14 if k.hi else 8, mat)


def _laurel(k, x, y, z):
    k.beam((x - 0.1, y, z), (x + 0.1, y, z), 0.015, 'rope')
    if k.hi:
        for i in range(8): k.box(x - 0.09 + i * 0.026, y - 0.05 - (i % 2) * 0.015, z + 0.01, 0.025, 0.07, 0.01, 'crop')


def cottage_0(k):
    _bricks(k, 0, 0, W - 0.2, D - 0.2, 0.95); k.box(0, 0.0, 0, W - 0.1, 0.08, D - 0.1, 'stone')
    k.tile_roof(0, 0.95, 0, W - 0.2, D + 0.15, 0.62, over=0.2)
    _door(k, 0.3, D / 2 - 0.1); _slit(k, -0.45, 0.45, D / 2 - 0.1); _slit(k, -0.75, 0.4, 0.0 + D / 2 - 0.1, 0.1, 0.14)
    _slit(k, W / 2 - 0.1 + 0.02, 0.45, 0.1); _jar(k, -0.1, D / 2 + 0.12); _jar(k, 0.78, D / 2 + 0.1, 0.8)
    k.box(0.3, 0.0, D / 2 + 0.12, 0.5, 0.06, 0.2, 'lime'); _awning(k, 0.3, 0.8, D / 2 - 0.1, 0.62, 0.22)
    k.lathe(0.6, 0.95 + 0.35, -0.3, [(0.1, 0.0), (0.09, 0.2), (0.12, 0.26), (0.0, 0.26)], 10, 'mud')


def cottage_1(k):
    _bricks(k, 0, 0, W - 0.15, D - 0.15, 0.85, mat='plaster'); k.box(0, 0.85, 0, W - 0.05, 0.06, D - 0.05, 'lime')
    for sx in (-1, 1): k.box(sx * (W / 2 - 0.06), 0.9, 0, 0.1, 0.12, D - 0.1, 'plaster')
    k.box(0, 0.9, D / 2 - 0.06, W - 0.1, 0.12, 0.1, 'plaster'); k.box(0, 0.9, -D / 2 + 0.06, W - 0.1, 0.12, 0.1, 'plaster')
    for i in range(5): k.beam((-0.6 + i * 0.3, 0.7, D / 2 - 0.04), (-0.6 + i * 0.3, 0.86, D / 2 + 0.2), 0.045, 'wood')
    for i in range(4): k.box(-W / 2 + 0.15 + i * 0.5, 0.0, D / 2 + 0.1, 0.05, 0.5, 0.05, 'wood')
    _door(k, -0.4, D / 2 - 0.075); _slit(k, 0.45, 0.4, D / 2 - 0.075)

    for i in range(5): k.box(W / 2 + 0.15, 0.0, 0.5 - i * 0.2 + 0.0, 0.3, 0.12 + i * 0.14, 0.2, 'lime')
    with k.frame(0, 0, math.pi / 2): k.tile_roof(0, 0.93, 0, D - 0.1, W - 0.1, 0.3, over=0.12)
    k.lathe(-0.5, 0.95, -0.4, [(0.13, 0.0), (0.12, 0.3), (0.0, 0.3)], 10, 'terra'); _laurel(k, -0.4, 0.62, D / 2 + 0.0)
    k.box(0.5, 0.95, -0.3, 0.5, 0.1, 0.3, 'wood'); _jar(k, 0.55, -0.3, 0.9)


def cottage_2(k):  # courtyard house: L-shaped range behind a low wall with a gate, garden in the yard
    _bricks(k, -0.2, -0.3, 1.4, 1.0, 0.9, mat='mud'); _bricks(k, 0.55, 0.0, 0.7, 1.6 - 0.1, 0.9, mat='mud')
    k.tile_roof(-0.2, 0.9, -0.3, 1.4, 1.1, 0.5, over=0.15)
    with k.frame(0.55, 0.0, 0.0): k.tile_roof(0, 0.9, 0, 0.7, 1.5, 0.42, over=0.14)
    _door(k, -0.1, 0.2 - 0.0 + 0.0, 0.3, 0.55); _slit(k, 0.55 + 0.34, 0.45, 0.25); _slit(k, -0.7, 0.45, 0.22)
    k.ashlar(-0.4, 0.0, 0.76, 1.1, 0.34, 0.12, 'lime', course=0.17); k.ashlar(0.3, 0.0, 0.76, 0.2, 0.34, 0.12, 'lime', course=0.17)
    k.box(-0.95, 0.0, 0.5, 0.12, 0.34, 0.5, 'lime'); k.box(-0.95, 0.0, 0.05, 0.12, 0.34, 0.45, 'lime')
    for i in range(3): k.box(-0.65 + i * 0.28, 0.0, 0.45, 0.2, 0.05, 0.4, 'soil')
    if k.hi:
        for i in range(3):
            for j in range(3): k.rock(-0.72 + i * 0.28 + (j % 2) * 0.03, 0.04, 0.3 + j * 0.12, 0.05, 'crop', seed=i * 3 + j, squash=0.9, sub=2)
    k.lathe(-0.05, 0.0, 0.62, [(0.0, 0.0), (0.12, 0.0), (0.1, 0.16), (0.0, 0.16)], 14 if k.hi else 8, 'stone'); _jar(k, 0.45, 0.62, 0.8)


def cottage_3(k):  # small tower house
    _bricks(k, 0, -0.05, 1.3, 1.2, 1.55, mat='plaster'); k.box(0, 0.72, 0, 1.38, 0.05, 1.28, 'wood')
    k.tile_roof(0, 1.55, -0.05, 1.3, 1.3, 0.55, over=0.14)
    _door(k, 0.0, 0.55); _slit(k, -0.35, 1.0, 0.55, 0.14, 0.2); _slit(k, 0.35, 1.0, 0.55, 0.14, 0.2); _slit(k, 0.69, 0.4, 0.0, 0.1, 0.2)
    k.box(0, 1.2, 0.68, 1.0, 0.05, 0.16, 'wood')
    for sx in (-1, 1): k.box(sx * 0.48, 1.2, 0.68, 0.04, 0.2, 0.04, 'wood')
    _awning(k, 0.0, 0.78, 0.55, 0.62, 0.2, 'cloth2'); _jar(k, -0.55, 0.7); _jar(k, 0.62, 0.7, 0.8)
    k.lathe(0.35, 1.55 + 0.42, -0.35, [(0.1, 0.0), (0.09, 0.2), (0.12, 0.26), (0.0, 0.26)], 10, 'mud')


def cottage_4(k):  # stone base, plastered upper, timber balcony
    k.ashlar(0, 0.0, 0.0, W - 0.1, 0.5, D - 0.1, 'lime', course=0.125, block=0.34)
    _bricks(k, 0, 0, W - 0.2, D - 0.2, 0.5, mat='plaster'); k.box(0, 0.5, 0, W - 0.2, 0.45, D - 0.2, 'plaster')
    k.tile_roof(0, 0.95, 0, W - 0.25, D + 0.2, 0.55, over=0.22)
    _door(k, -0.4, D / 2 - 0.1, 0.3, 0.45); _slit(k, 0.4, 0.28, D / 2 - 0.1, 0.16, 0.14); _slit(k, 0.4, 0.62, D / 2 - 0.1)
    k.box(-0.1, 0.52, D / 2 + 0.2, 1.4, 0.05, 0.4, 'wood')
    for i in range(7): k.box(-0.75 + i * 0.22, 0.57, D / 2 + 0.38, 0.03, 0.2, 0.03, 'wood')
    for sx in (-1, 1): k.beam((sx * 0.7 - 0.1, 0.0, D / 2 + 0.38), (sx * 0.7 - 0.1, 0.52, D / 2 + 0.38), 0.06, 'wood')
    _laurel(k, 0.2, 0.9, D / 2 - 0.05); _jar(k, -0.82, D / 2 + 0.1)
    for i in range(3): k.box(0.1 + i * 0.22, 0.82, D / 2 + 0.28, 0.13, 0.12, 0.13, 'terra')


def cottage_5(k):  # round hut with a conical tile roof
    R = 0.74; sg = 32 if k.hi else 18
    k.lathe(0, 0, 0, [(R + 0.06, 0.0), (R + 0.06, 0.1), (R, 0.1), (R, 0.85)], sg, 'mud')
    k.lathe(0, 0.85, 0, [(R + 0.18, 0.0), (R + 0.16, 0.06), (R * 0.2, 0.62), (0.0, 0.66)], sg, 'terra')
    if k.hi:
        for c in range(7): k.lathe(0, 0.85 + c * 0.075, 0, [((R + 0.18) * (1 - c / 9.5), 0.0), ((R + 0.19) * (1 - c / 9.5), 0.02), ((R + 0.18) * (1 - (c + 1) / 9.5), 0.06)], sg, 'terraD')
    k.lathe(0, 1.51, 0, [(0.0, 0.0), (0.05, 0.0), (0.03, 0.12), (0.0, 0.16)], 10, 'bronze')
    k.box(0, 0.0, R - 0.04, 0.3, 0.55, 0.06, 'dark'); k.box(0, 0.55, R - 0.03, 0.44, 0.07, 0.09, 'wood')
    for sx in (-1, 1): k.box(sx * 0.2, 0.0, R - 0.03, 0.06, 0.6, 0.07, 'wood')
    for a in (-1.0, 1.1, 2.2): k.box(math.sin(a) * (R - 0.03), 0.4, math.cos(a) * (R - 0.03), 0.12, 0.18, 0.05, 'dark', yaw=a)
    _jar(k, 0.5, R + 0.1); _jar(k, -0.4, R + 0.05, 0.8); k.box(0.15, 0.0, R + 0.12, 0.45, 0.06, 0.2, 'lime')


# ---------------------------------------------------------------- decor
def amphora(k):
    k.lathe(0, 0, 0, [(0.0, 0.0), (0.04, 0.0), (0.07, 0.04), (0.14, 0.14), (0.16, 0.24), (0.12, 0.34), (0.06, 0.42), (0.05, 0.47), (0.08, 0.5), (0.0, 0.5)], 20 if k.hi else 12, 'terra')
    for sx in (-1, 1): k.beam((sx * 0.06, 0.46, 0), (sx * 0.15, 0.34, 0), 0.025, 'terraD')
    if k.hi: k.lathe(0, 0.24, 0, [(0.162, 0.0), (0.162, 0.03), (0.158, 0.06)], 20, 'ochre')


def amphora_stack(k):
    pts = [(-0.18, 0.0, -0.1, 0.2), (0.14, 0.0, -0.12, -0.15), (0.0, 0.0, 0.16, 0.0)]
    for x, y, z, t in pts:
        with k.frame(x, z, 0.0, 0.0): k.lathe(0, 0, 0, [(0.0, 0.0), (0.04, 0.0), (0.1, 0.07), (0.13, 0.2), (0.1, 0.3), (0.05, 0.36), (0.07, 0.4), (0.0, 0.4)], 16 if k.hi else 10, 'terra')
    for x, z in ((-0.08, 0.0), (0.1, 0.03)):
        with k.frame(x, z, 0.0, 0.0): k.lathe(0, 0.3, 0, [(0.0, 0.0), (0.08, 0.04), (0.1, 0.14), (0.07, 0.24), (0.04, 0.3), (0.0, 0.3)], 14 if k.hi else 8, 'terraD')
    k.box(0, 0.0, 0, 0.7, 0.04, 0.6, 'wood')


def well(k):
    R = 0.42; sg = 28 if k.hi else 16
    k.lathe(0, 0, 0, [(R + 0.06, 0.0), (R + 0.06, 0.12), (R, 0.12), (R, 0.36), (R + 0.04, 0.36), (R + 0.04, 0.42), (R - 0.14, 0.42), (R - 0.14, 0.36)], sg, 'lime')
    if k.hi:
        for i in range(18): a = TAU * i / 18; k.box(math.sin(a) * (R + 0.01), 0.14, math.cos(a) * (R + 0.01), 0.12, 0.015, 0.05, 'stone', yaw=a)
    for sx in (-1, 1): k.box(sx * R, 0.4, 0, 0.07, 0.62, 0.07, 'wood')
    k.beam((-R, 1.0, 0), (R, 1.0, 0), 0.06, 'wood');
    k.beam((0, 0.96, 0), (0, 0.5, 0), 0.012, 'rope'); k.lathe(0, 0.44, 0, [(0.0, 0.0), (0.07, 0.0), (0.075, 0.1), (0.0, 0.1)], 12, 'wood')


def cistern(k):
    k.ashlar(0, 0.0, 0, 1.5, 0.28, 1.0, 'lime', course=0.14, block=0.4)
    k.box(0, 0.26, 0, 1.2, 0.03, 0.7, 'water');
    for sx in (-1, 1): k.box(sx * 0.68, 0.26, 0, 0.14, 0.05, 1.0, 'marble')
    for sz in (-1, 1): k.box(0, 0.26, sz * 0.43, 1.5, 0.05, 0.14, 'marble')
    k.lathe(0.0, 0.0, 0.62, [(0.0, 0.0), (0.04, 0.0), (0.04, 0.2), (0.07, 0.24), (0.0, 0.24)], 10, 'bronze')


def basin(k):
    k.lathe(0, 0, 0, [(0.0, 0.0), (0.12, 0.0), (0.09, 0.08), (0.08, 0.5), (0.2, 0.55), (0.28, 0.6), (0.3, 0.64), (0.26, 0.64), (0.18, 0.58), (0.0, 0.56)], 24 if k.hi else 14, 'marble')


def kline(k):  # dining couch
    k.box(0, 0.16, 0, 0.5, 0.06, 1.1, 'wood')
    for sx in (-1, 1):
        for sz in (-1, 1): k.lathe(sx * 0.2, 0.0, sz * 0.48, [(0.0, 0.0), (0.035, 0.0), (0.028, 0.16), (0.04, 0.2), (0.0, 0.2)], 10, 'wood')
    k.box(0, 0.22, 0.0, 0.48, 0.08, 1.06, 'cloth'); k.box(0.0, 0.3, -0.42, 0.4, 0.07, 0.22, 'cloth2'); k.box(0.2, 0.22, 0.0, 0.1, 0.22, 1.06, 'wood')
    with k.frame(0.45, 0.0, 0.0, 0.0): k.box(0, 0.0, 0, 0.3, 0.22, 0.34, 'wood')


def loom(k):  # upright warp-weighted loom
    for sx in (-1, 1): k.beam((sx * 0.3, 0.0, 0.1), (sx * 0.3, 0.9, -0.04), 0.045, 'wood')
    k.beam((-0.3, 0.9, -0.04), (0.3, 0.9, -0.04), 0.05, 'wood'); k.beam((-0.3, 0.55, 0.0), (0.3, 0.55, 0.0), 0.03, 'wood')
    n = 22 if k.hi else 8
    for i in range(n): x = -0.27 + 0.54 * i / (n - 1); k.beam((x, 0.88, -0.04), (x, 0.28 - (i % 3) * 0.02, 0.05), 0.006, 'sail')
    for i in range(0, n, 2):
        x = -0.27 + 0.54 * i / (n - 1); k.lathe(x, 0.2 - (i % 3) * 0.02, 0.05, [(0.0, 0.0), (0.025, 0.0), (0.02, 0.07), (0.0, 0.07)], 8, 'stone')
    k.cloth((-0.26, 0.86, -0.02), (0.26, 0.86, -0.02), (-0.26, 0.62, 0.0), (0.26, 0.62, 0.0), 'cloth', sag=0.0, nx=10, nz=2)
    k.box(0.0, 0.0, -0.35, 0.3, 0.2, 0.3, 'wood')


def kiln(k):  # beehive pottery kiln with stoke hole and vent
    sg = 28 if k.hi else 16
    k.lathe(0, 0, 0, [(0.52, 0.0), (0.5, 0.1), (0.48, 0.5), (0.4, 0.72), (0.25, 0.9), (0.1, 1.0), (0.1, 1.04), (0.0, 1.04)], sg, 'mud')
    k.box(0, 0.0, 0.46, 0.3, 0.26, 0.2, 'dark'); k.box(0, 0.26, 0.5, 0.42, 0.06, 0.2, 'lime')
    if k.hi:
        for i in range(5): k.lathe(0, 0.12 + i * 0.16, 0, [(0.5 - i * 0.02 + 0.005, 0.0), (0.51 - i * 0.02, 0.012), (0.5 - i * 0.02 + 0.005, 0.024)], sg, 'stone')
    for i in range(4): _jar(k, 0.62 + (i % 2) * 0.22, -0.2 + i * 0.22, 0.7, 'terra')
    k.box(-0.7, 0.0, 0.1, 0.4, 0.3, 0.3, 'wood')


def tripod(k):
    for i in range(3):
        a = TAU * i / 3; k.beam((math.sin(a) * 0.22, 0.0, math.cos(a) * 0.22), (math.sin(a) * 0.04, 0.62, math.cos(a) * 0.04), 0.03, 'bronze')
    k.lathe(0, 0.6, 0, [(0.0, 0.0), (0.2, 0.0), (0.22, 0.05), (0.2, 0.06), (0.0, 0.03)], 20 if k.hi else 10, 'bronze')
    k.lathe(0, 0.2, 0, [(0.18, 0.0), (0.2, 0.02), (0.18, 0.04)], 14, 'bronze')


def offering_table(k):
    k.box(0, 0.38, 0, 0.7, 0.06, 0.45, 'marble')
    for sx in (-1, 1):
        for sz in (-1, 1): k.lathe(sx * 0.28, 0.0, sz * 0.17, [(0.0, 0.0), (0.04, 0.0), (0.035, 0.38), (0.0, 0.38)], 10, 'marble')
    for i in range(3): k.lathe(-0.2 + i * 0.2, 0.44, 0.0, [(0.0, 0.0), (0.05, 0.0), (0.06, 0.04), (0.0, 0.05)] if i != 1 else [(0.0, 0.0), (0.04, 0.0), (0.07, 0.07), (0.05, 0.1), (0.0, 0.1)], 12, 'bronze' if i == 1 else 'terra')


def stall(k):  # market stall: timber frame, cloth awning, counter and goods
    for sx in (-1, 1):
        for sz in (-1, 1): k.beam((sx * 0.55, 0.0, sz * 0.35), (sx * 0.55, 0.85 if sz < 0 else 0.7, sz * 0.35), 0.05, 'wood')
    k.cloth((-0.62, 0.85, -0.38), (0.62, 0.85, -0.38), (-0.62, 0.7, 0.42), (0.62, 0.7, 0.42), 'cloth', sag=0.02, nx=12, nz=3)
    if k.hi:
        for i in range(6): k.cloth((-0.62 + i * 0.207, 0.85, -0.38), (-0.62 + (i + 1) * 0.207, 0.85, -0.38), (-0.62 + i * 0.207, 0.7, 0.42), (-0.62 + (i + 1) * 0.207, 0.7, 0.42), 'sail' if i % 2 else 'cloth', sag=0.0, nx=1, nz=1)
    k.box(0, 0.36, 0.28, 1.1, 0.05, 0.3, 'wood'); k.box(0, 0.0, 0.28, 1.0, 0.36, 0.26, 'wood')
    for i in range(5): _jar(k, -0.4 + i * 0.2, 0.26, 0.5, 'terra' if i % 2 else 'terraD')
    for i in range(4):
        for j in range(2): k.rock(-0.3 + i * 0.2, 0.42, 0.34 + j * 0.0, 0.045, 'crop', seed=i + j * 5, squash=0.9, sub=2)
    k.box(0.0, 0.18, -0.2, 0.9, 0.05, 0.28, 'wood')


def garden_bed(k):
    k.ashlar(0, 0.0, 0, 1.4, 0.12, 0.9, 'stone', course=0.12, block=0.4)
    k.box(0, 0.06, 0, 1.2, 0.07, 0.7, 'soil')
    if k.hi:
        for i in range(5):
            for j in range(3): k.rock(-0.5 + i * 0.25, 0.1, -0.25 + j * 0.25, 0.07 + ((i + j) % 2) * 0.02, 'crop', seed=i * 3 + j, squash=0.8, sub=2)
        for i in range(5): k.beam((-0.5 + i * 0.25, 0.12, -0.3), (-0.5 + i * 0.25, 0.5, -0.3), 0.012, 'wood')
    else:
        for i in range(5): k.box(-0.5 + i * 0.25, 0.1, 0.0, 0.14, 0.1, 0.5, 'crop')


def rock_a(k): k.rock(0, 0, 0, 0.34, 'rock', seed=1, squash=0.6)
def rock_b(k): k.rock(0, 0, 0, 0.44, 'stone', seed=2, squash=0.5); k.rock(0.38, 0, 0.1, 0.2, 'rock', seed=3, squash=0.7)
def rock_c(k): k.rock(0, 0, 0, 0.26, 'rock', seed=4, squash=0.75); k.rock(-0.22, 0, 0.1, 0.15, 'stone', seed=5, squash=0.8)
def step_stone(k): k.rock(0, -0.02, 0, 0.17, 'stone', seed=6, squash=0.45)


def boat_a(k):  # fishing caique with mast and furled sail
    k.hull(0, 0.0, 0, 1.7, 0.62, 0.22, 'hull', 'wood'); k.beam((0, 0.05, 0.05), (0, 1.25, 0.05), 0.035, 'wood')
    k.beam((-0.04, 1.0, 0.05), (0.04, 1.0, 0.7), 0.03, 'wood'); k.cloth((0.0, 1.1, 0.07), (0.0, 1.1, 0.68), (0.0, 0.62, 0.07), (0.0, 0.62, 0.55), 'sail', sag=0.0, nx=6, nz=3)
    k.lathe(0, 0.16, -0.6, [(0.0, 0.0), (0.1, 0.0), (0.11, 0.12), (0.0, 0.12)], 10, 'rope')


def boat_b(k):  # small rowboat, oars shipped
    k.hull(0, 0.0, 0, 1.3, 0.5, 0.2, 'hull', 'wood'); k.beam((-0.4, 0.3, 0.0), (0.42, 0.28, 0.45), 0.02, 'wood'); k.beam((0.4, 0.3, 0.0), (-0.42, 0.28, 0.45), 0.02, 'wood')


def hut(k):  # fisherman's hut: mudbrick, thatched roof, nets
    _bricks(k, 0, 0, 1.5, 1.2, 0.8, mat='mud'); k.box(0, 0.0, 0, 1.6, 0.08, 1.3, 'stone')
    k.tile_roof(0, 0.8, 0, 1.5, 1.3, 0.5, 'thatch', over=0.22)
    if k.hi:
        for i in range(14): k.box(-0.74 + i * 0.113, 1.0 + 0.0, 0.0, 0.02, 0.01, 1.32, 'rope')
    _door(k, 0.2, 0.6 - 0.05, 0.32, 0.55); _slit(k, -0.45, 0.4, 0.55)

    k.box(-0.78, 0.0, 0.7, 0.04, 0.8, 0.04, 'wood'); k.box(-0.3, 0.0, 0.7, 0.04, 0.8, 0.04, 'wood')
    k.cloth((-0.78, 0.8, 0.7), (-0.3, 0.8, 0.7), (-0.78, 0.4, 0.7), (-0.3, 0.4, 0.7), 'rope', sag=0.04, nx=8, nz=4)
    _jar(k, 0.7, 0.8, 1.0); _jar(k, 0.9, 0.7, 0.8);


def net_rack(k):
    for sx in (-1, 1): k.beam((sx * 0.4, 0.0, 0), (sx * 0.36, 0.95, 0), 0.04, 'wood')
    k.beam((-0.4, 0.9, 0), (0.4, 0.9, 0), 0.03, 'wood')
    k.cloth((-0.38, 0.9, 0.02), (0.38, 0.9, 0.02), (-0.34, 0.2, 0.05), (0.34, 0.2, 0.05), 'rope', sag=0.05, nx=14, nz=6)
    for i in range(5): k.lathe(-0.3 + i * 0.15, 0.1, 0.07, [(0.0, 0.0), (0.02, 0.0), (0.018, 0.06), (0.0, 0.06)], 6, 'stone')


def woodpile(k):
    n = 5 if k.hi else 3
    for r in range(n):
        for i in range(n - r): k.box(-0.28 + (i + r * 0.5) * 0.12, 0.0 + r * 0.1, 0.0, 0.1, 0.1, 0.55, 'wood')


def bollard(k):
    k.lathe(0, 0, 0, [(0.0, 0.0), (0.1, 0.0), (0.085, 0.3), (0.11, 0.34), (0.0, 0.36)], 14 if k.hi else 8, 'stone')
    k.lathe(0, 0.25, 0, [(0.09, 0.0), (0.1, 0.02), (0.09, 0.04)], 20, 'rope')
    k.lathe(0, 0.0, 0, [(0.0, 0.0), (0.14, 0.0), (0.13, 0.03), (0.0, 0.03)], 16, 'stone'); k.lathe(0, 0.34, 0, [(0.0, 0.0), (0.09, 0.0), (0.06, 0.03), (0.0, 0.04)], 14, 'stone')


def banner_pole(k):
    k.lathe(0, 0, 0, [(0.0, 0.0), (0.045, 0.0), (0.035, 1.3), (0.0, 1.3)], 10, 'wood')
    k.lathe(0, 1.3, 0, [(0.0, 0.0), (0.05, 0.0), (0.03, 0.08), (0.0, 0.12)], 10, 'gold'); k.beam((0, 1.2, 0), (0.4, 1.2, 0), 0.025, 'wood')
    k.cloth((0.02, 1.2, 0.0), (0.4, 1.2, 0.0), (0.02, 0.62, 0.0), (0.4, 0.66, 0.0), 'cloth', sag=0.0, nx=8, nz=6)
    k.box(0.2, 0.84, 0.002, 0.14, 0.14, 0.004, 'gold')
    k.box(0, 0.0, 0, 0.22, 0.1, 0.22, 'lime')


# ---------------------------------------------------------------- xystos: covered running track (stoa-like portico around a sand track)
def xystos(k):
    D_ = DIMS['xystos']; w, d = D_['w'], D_['d']
    y = k.steps(0, 0, 0, w - 0.2, d - 0.2, 1, 0.12, 0.1)
    k.box(0, y - 0.01, 0, w - 0.6, 0.02, d - 0.9, 'sand')
    n = max(6, round(w / 0.7)); fz = d / 2 - 0.2
    for i in range(n):
        x = -w / 2 + 0.35 + (w - 0.7) * i / (n - 1)
        k.column(x, fz, y, 1.0, 0.075, 0.062, 'doric')
        k.column(x, -fz, y, 1.0, 0.075, 0.062, 'doric')
    k.ashlar(0, y + 1.0 + 0.14, fz, w - 0.1, 0.22, 0.2, 'lime', course=0.11, block=0.5); k.ashlar(0, y + 1.0 + 0.14, -fz, w - 0.1, 0.22, 0.2, 'lime', course=0.11, block=0.5)
    ry = y + 1.36

    with k.frame(0, 0, math.pi / 2): k.tile_roof(0, ry, 0, d - 0.1, w - 0.1, 0.4, over=0.08)
    for sx in (-1, 1): k.ashlar(sx * (w / 2 - 0.15), y, 0, 0.2, 1.1, d - 0.3, 'lime', course=0.11, block=0.4)

    for i in range(7): k.box(-w / 2 + 1.0 + i * (w - 2.0) / 6, y, 0.0, 0.04, 0.012, d - 0.9, 'dark') if k.hi else None


ASSETS = {
    'foundation': (foundation, 512), 'wall_seg': (wall_seg, 512), 'wall_post': (wall_post, 256), 'retain_seg': (retain_seg, 512), 'bridge': (bridge, 1024),
    'pier_deck': (pier_deck, 512), 'pier_post': (pier_post, 256), 'gate_pier': (gate_pier, 256), 'stair_seg': (stair_seg, 256), 'mole_seg': (mole_seg, 512),
    'cottage_0': (cottage_0, 1024), 'cottage_1': (cottage_1, 1024), 'cottage_2': (cottage_2, 1024), 'cottage_3': (cottage_3, 1024), 'cottage_4': (cottage_4, 1024), 'cottage_5': (cottage_5, 1024),
    'amphora': (amphora, 256), 'amphora_stack': (amphora_stack, 512), 'well': (well, 512), 'cistern': (cistern, 512), 'basin': (basin, 256), 'kline': (kline, 512), 'loom': (loom, 512),
    'kiln': (kiln, 512), 'tripod': (tripod, 256), 'offering_table': (offering_table, 256), 'stall': (stall, 1024), 'garden_bed': (garden_bed, 512),
    'rock_a': (rock_a, 512), 'rock_b': (rock_b, 512), 'rock_c': (rock_c, 512), 'step_stone': (step_stone, 256), 'boat_a': (boat_a, 1024), 'boat_b': (boat_b, 512),
    'hut': (hut, 1024), 'net_rack': (net_rack, 512), 'woodpile': (woodpile, 256), 'bollard': (bollard, 256), 'banner_pole': (banner_pole, 512), 'xystos': (xystos, 1024),
}
