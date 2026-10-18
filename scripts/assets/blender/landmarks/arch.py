"""Builders for every landmark (one function per asset; k.hi switches high-poly source / game mesh). Footprints come from dims.json."""
import math
from lib import DIMS, TAU


def _row(k, n, x0, x1, z, y0, h, r0, r1, order='doric', cap=True):
    top = y0
    for i in range(n):
        x = x0 + (x1 - x0) * i / max(1, n - 1); top = k.column(x, z, y0, h, r0, r1, order, cap=cap)
    return top


def _col_run(k, axis, n, a0, a1, c, y0, h, r0, r1, order='doric'):
    top = y0
    for i in range(n):
        t = a0 + (a1 - a0) * i / max(1, n - 1)
        top = k.column(t, c, y0, h, r0, r1, order) if axis == 'x' else k.column(c, t, y0, h, r0, r1, order)
    return top


def temple(k):
    D = DIMS['temple']; w, d = D['w'], D['d']; nx, nz = D['cols']
    y = k.steps(0, 0, 0, w - 0.5, d - 0.5, D['steps'], D['stepH'], 0.25)  # top step is exactly the stylobate (w x d)
    h = 1.85; r0, r1 = 0.155, 0.115; ix, iz = w / 2 - 0.2, d / 2 - 0.2
    top = _col_run(k, 'x', nx, -ix, ix, iz, y, h, r0, r1); _col_run(k, 'x', nx, -ix, ix, -iz, y, h, r0, r1)
    dz = 2 * iz / (nz - 1)  # long sides share their end columns with the front and back rows
    _col_run(k, 'z', nz - 2, -iz + dz, iz - dz, ix, y, h, r0, r1); _col_run(k, 'z', nz - 2, -iz + dz, iz - dz, -ix, y, h, r0, r1)
    k.ashlar(0, y, 0, w - 1.15, h + 0.35, d - 1.5, 'lime', course=0.24)  # cella walls
    for zz in (iz - 0.55, -iz + 0.55):  # pronaos / opisthodomos: two columns in antis
        for sx in (-1, 1): k.column(sx * 0.38, zz, y, h, 0.13, 0.1, 'doric')
    k.box(0, y, iz - 0.84, 0.62, 1.1, 0.05, 'dark')  # door
    k.box(0, y + 1.1, iz - 0.84, 0.76, 0.07, 0.07, 'marble')
    ey = top
    k.triglyph_frieze(0, ey, iz, w - 0.1, 0.4, 0.46, 'z'); k.triglyph_frieze(0, ey, -iz, w - 0.1, 0.4, 0.46, 'z')
    for sx in (-1, 1): k.triglyph_frieze(sx * ix, ey, 0, 0.4, d - 0.1, 0.46, 'x')
    cy = ey + 0.46; k.cornice(0, cy, 0, w - 0.05, d - 0.05); ry = cy + 0.07
    k.tile_roof(0, ry, 0, w - 0.25, d - 0.2, 0.52, over=0.12)
    for sz in (-1, 1):
        k.pediment(0, ry, sz * (d / 2 - 0.04), w - 0.02, 0.08, 0.52, 'marble', face=sz)
        k.acroterion(0, ry + 0.52, sz * (d / 2 - 0.04), 1.5)
        for sx in (-1, 1): k.acroterion(sx * (w / 2 - 0.05), ry, sz * (d / 2 - 0.04), 1.0)


def _stoa(k, key):
    D = DIMS[key]; w, d = D['w'], D['d']
    y = k.steps(0, 0, 0, w - 0.24, d - 0.24, 2, 0.12, 0.12)
    n = max(5, round(w / 0.66)); ix = w / 2 - 0.22; fz = d / 2 - 0.2; h = 1.28
    top = _col_run(k, 'x', n, -ix, ix, fz, y, h, 0.085, 0.07)
    _col_run(k, 'x', n // 2 + 1, -ix, ix, -0.02, y, h + 0.35, 0.075, 0.065, 'ionic')
    k.ashlar(0, y, -d / 2 + 0.13, w - 0.16, h + 0.5, 0.2, 'lime', course=0.2)
    if k.hi:  # painted band and niches on the back wall
        k.box(0, y + 0.95, -d / 2 + 0.235, w - 0.3, 0.2, 0.012, 'blue')
        for i in range(n // 2): k.box(-ix + 0.3 + i * (2 * ix - 0.6) / max(1, n // 2 - 1), y + 0.2, -d / 2 + 0.235, 0.28, 0.6, 0.02, 'dark')
    k.triglyph_frieze(0, top, fz, w - 0.1, 0.22, 0.3, 'z'); k.box(0, top, -0.02, w - 0.1, 0.28, 0.2, 'lime')
    ry = top + 0.3; k.cornice(0, ry, fz, w - 0.1, 0.1)
    with k.frame(0, 0, math.pi / 2): k.tile_roof(0, ry + 0.02, -0.02, d + 0.1, w - 0.04, 0.3, over=0.1)


def stoa(k): _stoa(k, 'stoa')
def stoa_short(k): _stoa(k, 'stoa_short')


def tholos(k):
    D = DIMS['tholos']; R = D['w'] / 2; sg = 72
    k.lathe(0, 0, 0, [(R, 0.0), (R, 0.14), (R - 0.14, 0.14), (R - 0.14, 0.28), (R - 0.28, 0.28), (R - 0.28, 0.42)], sg, 'marble')
    y = 0.42; rc = R - 0.5; n = 18
    for i in range(n): a = TAU * i / n; k.column(math.sin(a) * rc, math.cos(a) * rc, y, 1.55, 0.105, 0.085, 'ionic')
    rb = 1.0  # seat wall with a gap toward the front (+z); the hearth is open to the room
    for i in range(14):
        a = math.pi * 0.28 + (TAU - math.pi * 0.56) * i / 13
        k.ashlar(math.sin(a) * rb, y, math.cos(a) * rb, 0.5, 0.3, 0.2, 'lime', yaw=a, course=0.15, block=0.25)
    k.lathe(0, y, 0, [(0.0, 0.0), (0.3, 0.0), (0.34, 0.04), (0.28, 0.12), (0.0, 0.1)], 24 if k.hi else 10, 'bronze')  # brazier
    ty = y + 1.55 + 0.14
    prof = [(rc + 0.28, 0.0), (rc + 0.28, 0.14), (rc + 0.2, 0.14), (rc + 0.2, 0.5)]
    k.lathe(0, ty, 0, [(r, yy) for r, yy in prof], sg, 'lime')
    ry = ty + 0.5; roof = [(rc + 0.38, 0.0)]
    courses = 12 if k.hi else 8
    for c in range(courses):
        t = (c + 1) / courses; r = (rc + 0.38) * (1 - t * 0.93); roof += [(r + 0.05 * (1 - t), (c + 0.5) / courses * 1.05), (r, (c + 1) / courses * 1.05)] if k.hi else [(r, t * 1.05)]
    k.lathe(0, ry, 0, roof, sg, 'terra')
    if k.hi:  # radial cover-tile ribs down the cone, one per pan row
        rb0 = rc + 0.38
        for i in range(48):
            a = TAU * i / 48; ca, sa = math.sin(a), math.cos(a)
            k.beam((ca * rb0, ry + 0.01, sa * rb0), (ca * rb0 * 0.07, ry + 1.04, sa * rb0 * 0.07), 0.026, 'terraD')
    k.lathe(0, ry + 1.05, 0, [(0.0, 0.0), (0.08, 0.0), (0.05, 0.1), (0.07, 0.2), (0.0, 0.26)], 10, 'gold')


def _doric_hall(k, w, d, colh, r0, r1, ncol, hall_d, y_steps=2):
    """Temple in antis: stepped podium, closed hall at the back, porch with ncol columns between antae at the front."""
    y = k.steps(0, 0, 0, w - 0.3, d - 0.3, y_steps, 0.12, 0.15)
    k.ashlar(0, y, -d / 2 + hall_d / 2 + 0.05, w - 0.35, colh + 0.3, hall_d, 'lime', course=0.2)
    px = w / 2 - 0.35
    for i in range(ncol): k.column(-px + 2 * px * i / max(1, ncol - 1), d / 2 - 0.25, y, colh, r0, r1, 'doric')
    k.box(0, y, -d / 2 + hall_d + 0.1, 0.5, min(colh * 0.7, 1.0), 0.05, 'dark')
    top = y + colh + 0.14
    k.triglyph_frieze(0, top, d / 2 - 0.25, w - 0.3, 0.3, 0.3, 'z')
    k.box(0, top, -0.1, w - 0.35, 0.3, d - 0.55, 'lime')
    ry = top + 0.3; k.cornice(0, ry, 0, w - 0.4, d - 0.4); ry += 0.07
    k.tile_roof(0, ry, 0, w - 0.45, d - 0.45, 0.36 + w * 0.05, over=0.1)
    k.pediment(0, ry, d / 2 - 0.2, w - 0.35, 0.07, 0.36 + w * 0.05, 'marble')
    k.acroterion(0, ry + 0.36 + w * 0.05, d / 2 - 0.2, 1.0)
    return ry


def treasury(k):
    D = DIMS['treasury']; _doric_hall(k, D['w'], D['d'], 1.25, 0.1, 0.078, 4, 2.0)
    for sx in (-1, 1):  # flanking banner posts (Gallery wings)
        k.ashlar(sx * (D['w'] / 2 - 0.12), 0.0, -0.2, 0.16, 1.1, 0.16, 'marble', course=0.2, block=0.2)


def treasury_small(k):
    D = DIMS['treasury_small']; _doric_hall(k, D['w'], D['d'], 0.78, 0.062, 0.05, 2, 0.8, y_steps=1)


def workshop(k):
    D = DIMS['workshop']; w, d = D['w'], D['d']
    k.ashlar(0, 0, 0, w, 0.8, d, 'lime', course=0.2)
    k.box(0, 0.8, 0, w - 0.04, 0.55, d - 0.04, 'plaster')  # lime-plastered upper wall
    k.box(0, 0.78, 0, w + 0.04, 0.05, d + 0.04, 'marble')  # string course hides the plaster step
    if k.hi:
        for i in range(12): k.box(-w / 2 + 0.2 + i * 0.34, 0.82, d / 2 - 0.014, 0.05, 0.5, 0.012, 'ochre')
    k.box(0, 0.0, d / 2 + 0.02, 1.3, 1.15, 0.05, 'wood'); k.box(0, 1.15, d / 2 + 0.03, 1.5, 0.1, 0.08, 'wood')  # big double door
    for sx in (-1, 1): k.box(sx * 0.33, 0.0, d / 2 + 0.05, 0.04, 1.15, 0.03, 'wood')
    with k.frame(0, 0, math.pi / 2): k.tile_roof(0, 1.35, 0, d + 0.1, w + 0.1, 0.62, over=0.14)
    k.lathe(w / 2 - 0.5, 1.2, -d / 2 + 0.55, [(0.0, -0.02), (0.2, -0.02), (0.19, 0.0), (0.17, 0.5), (0.2, 0.9), (0.26, 1.02), (0.3, 1.12), (0.3, 1.16), (0.0, 1.16)], 28 if k.hi else 16, 'lime')  # kiln chimney with a flared cap
    k.lathe(w / 2 - 0.5, 1.2 + 1.16, -d / 2 + 0.55, [(0.0, 0.0), (0.24, 0.0), (0.24, 0.02), (0.0, 0.02)], 24 if k.hi else 14, 'dark')
    for i, (x, z) in enumerate(((-w / 2 + 0.35, d / 2 + 0.3), (-w / 2 + 0.75, d / 2 + 0.38), (-w / 2 + 0.55, d / 2 + 0.7))):  # amphorae
        k.lathe(x, 0, z, [(0.0, 0.0), (0.07, 0.0), (0.14, 0.14), (0.15, 0.24), (0.09, 0.34), (0.06, 0.42), (0.08, 0.46), (0.0, 0.46)], 14 if k.hi else 6, 'terra')
    for sx in (-1, 1): k.box(sx * (w / 2 - 0.2), 0, d / 2 + 0.3, 0.1, 0.9, 0.1, 'wood')  # shed posts
    k.box(0, 0.9, d / 2 + 0.3, w - 0.2, 0.08, 0.2, 'wood')


def tower(k):
    D = DIMS['tower']; R = D['w'] / 2 - 0.2
    k.lathe(0, 0, 0, [(R + 0.25, 0.0), (R + 0.25, 0.12), (R + 0.12, 0.12), (R + 0.12, 0.24)], 8, 'marble', mod=lambda a, y: 1.0)
    oct_ = lambda a, y: 1.0 / math.cos(math.pi / 8 - (a % (math.pi / 4))) * math.cos(math.pi / 8)  # octagon with circumradius R
    course = (lambda a, y: oct_(a, y) * (1.0 - (0.012 if (y % 0.22) < 0.014 else 0.0))) if k.hi else oct_  # dressed courses on the stone base
    k.lathe(0, 0.24, 0, [(R, 0.0), (R, 0.99)], 8, 'lime', mod=course)
    k.lathe(0, 1.23, 0, [(R + 0.03, 0.0), (R + 0.03, 0.06), (R, 0.06), (R, 1.0), (R + 0.04, 1.0), (R + 0.04, 1.12), (R, 1.12), (R, 1.71)], 8, 'plaster', mod=oct_)
    ap = R * math.cos(math.pi / 8)
    for i in (2, 4, 6):  # slit windows with marble surrounds on three faces
        yaw = math.pi / 2 - (i + 0.5) * math.pi / 4
        with k.frame(0, 0, yaw):
            k.box(0, 1.5, ap + 0.01, 0.22, 0.62, 0.04, 'marble'); k.box(0, 1.55, ap + 0.025, 0.1, 0.5, 0.03, 'dark')
    for sx in (-1, 1): k.column(sx * 0.4, R + 0.22, 0.24, 1.6, 0.07, 0.06, 'doric')
    k.box(0, 1.84, R + 0.22, 1.1, 0.12, 0.3, 'marble'); k.box(0, 0.24, R - 0.02, 0.5, 1.2, 0.05, 'wood')
    k.cone_roof(0, 2.94, 0, R + 0.18, 0.9, 0.0, TAU)
    k.lathe(0, 3.84, 0, [(0.0, 0.0), (0.05, 0.0), (0.03, 0.4), (0.0, 0.5)], 10, 'bronze'); k.lathe(0, 4.1, 0, [(0.0, 0.0), (0.07, 0.04), (0.11, 0.12), (0.0, 0.34)], 12, 'bronze', ratio=(1.0, 0.35))  # Triton vane


def bouleuterion(k):
    D = DIMS['bouleuterion']; w, d = D['w'], D['d']; hw = w / 2 - 0.35; hd = 2.0; over = 0.1; rise = 0.55
    y = k.steps(0, 0, 0, w - 0.3, d - 0.3, 2, 0.12, 0.15)
    fz = d / 2 - hd / 2 - 0.15; z0 = fz - hd / 2  # hall centre toward the front; the apse is a true semicircle of radius hw centred on the hall's back wall
    k.ashlar(0, y, fz, hw * 2, 1.5, hd, 'lime', course=0.2)
    k.arc_wall(0, z0, y, 1.5, hw, 0.32, -0.05, math.pi + 0.05, 'lime', course=0.2, block=0.42)  # 0.05 rad runs into the hall so no bevel notch shows black at the join
    for i in range(4): k.column(-hw * 0.78 + hw * 1.56 * i / 3, d / 2 - 0.2, y, 1.2, 0.075, 0.06, 'ionic')
    k.box(0, y + 1.2 + 0.14, d / 2 - 0.2, hw * 2, 0.24, 0.24, 'marble')
    ry = y + 1.5; k.cornice(0, ry, fz, hw * 2, hd); k.arc_wall(0, z0, ry, 0.07, hw + 0.09, 0.42, -0.05, math.pi + 0.05, 'lime', course=0.07)
    k.tile_roof(0, ry + 0.07, fz, hw * 2, hd, rise, over=over)  # gable over the hall; the half cone below takes the ridge end round the apse at the same slope
    k.cone_roof(0, ry + 0.07, z0, hw + over, rise, 0.0, math.pi)
    k.pediment(0, ry + 0.07, d / 2 - 0.08, hw * 2 + 0.2, 0.07, rise, 'marble')
    fy = fz + hd / 2  # panelled door in a marble frame
    k.box(0, y, fy + 0.02, 0.5, 0.95, 0.04, 'wood'); k.box(0, y + 0.95, fy + 0.03, 0.7, 0.08, 0.07, 'marble')
    for sx in (-1, 1): k.box(sx * 0.31, y, fy + 0.03, 0.08, 0.95, 0.07, 'marble')
    if k.hi:
        for sx in (-1, 0, 1): k.box(sx * 0.12, y + 0.04, fy + 0.045, 0.012, 0.87, 0.012, 'dark')


def palaestra(k):
    D = DIMS['palaestra']; w, d = D['w'], D['d']; t = 0.42
    y = k.steps(0, 0, 0, w - 0.2, d - 0.2, 1, 0.14, 0.1)
    k.box(0, y - 0.02, 0, w - 1.1, 0.03, d - 1.1, 'sand')  # the yard
    n = 5
    for s in (-1, 1):
        _col_run(k, 'x', n, -w / 2 + 0.5, w / 2 - 0.5, s * (d / 2 - 0.55) if s > 0 else s * (d / 2 - 0.55), y, 0.95, 0.06, 0.05, 'doric')
    for s in (-1, 1): _col_run(k, 'z', 3, -d / 2 + 1.0, d / 2 - 1.0, s * (w / 2 - 0.55), y, 0.95, 0.06, 0.05, 'doric')
    k.ashlar(0, y, -d / 2 + 0.17, w - 0.1, 1.55, 0.3, 'lime', course=0.2)  # back hall
    for s in (-1, 1): k.ashlar(s * (w / 2 - 0.15), y, -0.2, 0.28, 1.2, d - 0.9, 'lime', course=0.2)
    k.ashlar(-0.9 - 0.45, y, d / 2 - 0.15, 1.0, 1.0, 0.26, 'lime', course=0.2); k.ashlar(0.9 + 0.45, y, d / 2 - 0.15, 1.0, 1.0, 0.26, 'lime', course=0.2)  # entry piers
    with k.frame(0, 0, math.pi / 2): k.tile_roof(d / 2 - 0.3, y + 1.55, 0, 1.1, w, 0.4, over=0.08)  # frame: local x = -world z, local z = world x
    for s in (-1, 1): k.box(s * (w / 2 - 0.4), y + 1.0, -0.1, 0.5, 0.09, d - 1.1, 'terra')
    k.box(0, y + 1.0, d / 2 - 0.35, w - 1.2, 0.09, 0.5, 'terra')
    k.sculpt(-0.5, y, 0.0, 0.5, 'stride', -1.2, False, 'lime'); k.sculpt(0.5, y, 0.0, 0.5, 'kneel', 1.2, True, 'lime')  # two skinned athletes in the yard: a runner and a kneeling wrestler


def hostel(k):
    D = DIMS['hostel']; w, d = D['w'], D['d']; wh = 1.2
    y = k.steps(0, 0, 0, w - 0.2, d - 0.2, 1, 0.14, 0.1)
    k.ashlar(0, y, -d / 2 + 0.3, w - 0.2, wh, 0.5, 'lime', course=0.2)  # rear range
    for sx in (-1, 1): k.ashlar(sx * (w / 2 - 0.3), y, 0.0, 0.5, wh, d - 0.3, 'lime', course=0.2)
    fw = w / 2 - 0.6
    k.ashlar(-w / 4 - 0.3, y, d / 2 - 0.25, fw, wh, 0.5, 'lime', course=0.2); k.ashlar(w / 4 + 0.3, y, d / 2 - 0.25, fw, wh, 0.5, 'lime', course=0.2)
    gap = w / 2 + 0.6 - 2 * fw  # entrance between the front blocks: door, marble jambs, ashlar lintel under the roof
    gy = y + 1.0
    k.ashlar(0, gy, d / 2 - 0.25, gap + 0.04, wh - 1.0, 0.5, 'lime', course=0.1)
    k.box(0, y, d / 2 - 0.3, gap - 0.2, 0.98, 0.05, 'wood'); k.box(0, y + 0.98, d / 2 - 0.3, gap - 0.1, 0.04, 0.12, 'marble')
    for sx in (-1, 1): k.box(sx * (gap / 2 - 0.05), y, d / 2 - 0.26, 0.09, 0.98, 0.12, 'marble')
    if k.hi:
        for sx in (-1, 0, 1): k.box(sx * 0.14, y + 0.03, d / 2 - 0.27, 0.012, 0.92, 0.012, 'dark')
    for sx in (-1, 1):
        for i in range(3): k.column(sx * (w / 2 - 0.7), -d / 2 + 1.0 + i * (d - 2.0) / 2, y, 0.9, 0.06, 0.05, 'ionic')
    for i in range(3): k.column(-0.9 + i * 0.9, -d / 2 + 0.75, y, 0.9, 0.06, 0.05, 'ionic')
    for sx in (-1, 1): k.box(sx * (w / 2 - 0.62), y + 0.95, 0.0, 0.44, 0.08, d - 1.2, 'terra')
    k.box(0, y + 0.95, -d / 2 + 0.62, w - 1.2, 0.08, 0.44, 'terra')  # entablature over the rear colonnade
    iw, idp = w - 1.1, d - 1.1  # court opening
    k.ring_roof(w + 0.1, d + 0.1, iw, idp, y + wh, 0.3, 0.02)
    k.lathe(0, y, 0.0, [(0.0, 0.0), (0.22, 0.0), (0.2, 0.18), (0.0, 0.18)], 18 if k.hi else 10, 'stone')  # well


def propylon(k):
    D = DIMS['propylon']; w, d = D['w'], D['d']
    y = k.steps(0, 0, 0, w - 0.2, d - 0.2, 1, 0.12, 0.1)
    for sx in (-1, 1): k.ashlar(sx * (w / 2 - 0.45), y, 0.0, 0.7, 1.55, d - 0.4, 'lime', course=0.2)
    for sx in (-1, 1):
        for zz in (-1, 1):
            for cx in (0.95, 1.65): k.column(sx * cx, zz * (d / 2 - 0.2), y, 1.5, 0.095, 0.075, 'doric')
    top = y + 1.5 + 0.14
    k.triglyph_frieze(0, top, d / 2 - 0.2, w - 0.15, 0.3, 0.32, 'z'); k.triglyph_frieze(0, top, -d / 2 + 0.2, w - 0.15, 0.3, 0.32, 'z')
    k.box(0, top, 0, w - 0.15, 0.32, d - 0.6, 'lime')
    ry = top + 0.32; k.cornice(0, ry, 0, w - 0.1, d - 0.1); ry += 0.07
    k.tile_roof(0, ry, 0, w - 0.15, d - 0.1, 0.5, over=0.1)
    for s in (-1, 1): k.pediment(0, ry, s * (d / 2 - 0.05), w - 0.1, 0.07, 0.5, 'marble', face=s); k.acroterion(0, ry + 0.5, s * (d / 2 - 0.05), 1.1)


def statue(k):
    k.ashlar(0, 0, 0, 0.42, 0.38, 0.42, 'lime', course=0.19, block=0.21)
    k.box(0, 0.38, 0, 0.5, 0.05, 0.5, 'marble'); k.sculpt(0, 0.43, 0, 0.82, 'stand', 0.0, False, 'marble', True, True)
    k.box(0, 0.43, 0.215, 0.2, 0.06, 0.012, 'bronze')


def herm(k):
    k.box(0, 0, 0, 0.3, 0.14, 0.3, 'lime')
    k.box(0, 0.14, 0, 0.24, 0.74, 0.24, 'marble', rot=None)
    for sx in (-1, 1): k.box(sx * 0.15, 0.68, 0, 0.1, 0.05, 0.05, 'marble')
    k.lathe(0, 0.88, 0, [(0.0, 0.0), (0.11, 0.0), (0.13, 0.1), (0.1, 0.22), (0.0, 0.25)], 14 if k.hi else 6, 'marble')
    k.box(0, 0.86, 0.1, 0.12, 0.12, 0.05, 'marble')  # beard


def torch(k):
    for i in range(3):
        a = TAU * i / 3; k.box(math.sin(a) * 0.1, 0.0, math.cos(a) * 0.1, 0.035, 0.85, 0.035, 'bronze', rot=None)
    k.lathe(0, 0.78, 0, [(0.0, 0.0), (0.1, 0.0), (0.16, 0.12), (0.13, 0.12), (0.0, 0.05)], 18 if k.hi else 14, 'bronze')
    for i in range(3): k.beam((math.sin(TAU * i / 3) * 0.1, 0.4, math.cos(TAU * i / 3) * 0.1), (0.0, 0.4, 0.0), 0.02, 'bronze')
    k.lathe(0, 0.0, 0, [(0.0, 0.0), (0.16, 0.0), (0.14, 0.04), (0.0, 0.05)], 14, 'bronze')


def _rrect(hx, hz, rr, n, step=None):
    """Closed CCW rounded-rectangle path of (x, z, nx, nz) points (outward normals); straights are subdivided every `step` when given."""
    pts = []
    for ccx, ccz, a0 in ((hx - rr, hz - rr, 0.0), (-(hx - rr), hz - rr, math.pi / 2), (-(hx - rr), -(hz - rr), math.pi), (hx - rr, -(hz - rr), 1.5 * math.pi)):
        for i in range(n + 1):
            a = a0 + math.pi / 2 * i / n; nx, nz = math.cos(a), math.sin(a)
            if step and i == 0 and pts:
                px, pz, qx, qz = pts[-1][0], pts[-1][1], ccx + nx * rr, ccz + nz * rr
                m = int(math.hypot(qx - px, qz - pz) / step)
                pts += [(px + (qx - px) * j / (m + 1), pz + (qz - pz) * j / (m + 1), pts[-1][2], pts[-1][3]) for j in range(1, m + 1)]
            pts.append((ccx + nx * rr, ccz + nz * rr, nx, nz))
    return pts


def _smooth(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


def _bank_profile(W, E, nt, hi, soft=1.4):
    """Closed (d, y, mat) loop across an embankment that follows the terrain bowl (src/scene/site/height.ts: E * smooth(d / W), then E * (1 - smooth) over `soft`): stone kerb, nt turf terraces with earth risers, outer slope. mat belongs to the segment arriving at the point."""
    kb = 0.14; p = [(0.0, -0.12, 'soil'), (0.0, 0.0, 'soil'), (0.0, kb, 'marble'), (0.1, kb, 'marble')]
    tread = (W - 0.1) / nt; d = 0.1; ns = 4 if hi else 1
    for i in range(nt):
        y = E if i == nt - 1 else max(kb, E * _smooth((d + tread) / W)); p.append((d, y, 'soil'))
        for j in range(1, ns + 1): p.append((d + tread * j / ns, y, 'grass'))
        d += tread
    for j in range(1, 5): p.append((W + soft * j / 4, E * (1 - _smooth(j / 4)), 'grass'))
    return p + [(W + soft, -0.12, 'soil')]


def _bank_y(prof, d):
    """Terrace top height at distance d (first flat run covering d)."""
    for (d0, y0, _), (d1, y1, _) in zip(prof, prof[1:]):
        if y0 == y1 and d0 <= d <= d1 and y0 > 0.1: return y0
    return prof[-3][1]


def _sweep(k, pts, prof, skip=(), noise=0.0):
    """Sweep the closed profile along the closed path as a watertight solid; path segments in `skip` stay open and are capped."""
    n = len(pts); rings = []
    for (x, z, nx, nz) in pts:
        r = []
        for d, y, _m in prof:
            yy = y + (noise * math.sin(x * 9.1 + z * 7.3 + d * 13.0) * math.cos(x * 4.3 - z * 5.1) if noise and y > 0.15 and 0.1 < d < prof[-2][0] else 0.0)
            r.append(k.v(x + nx * d, yy, z + nz * d))
        rings.append(r)
    m = len(prof)
    for i in range(n):
        j = (i + 1) % n
        if i in skip: continue
        for q in range(m):
            q2 = (q + 1) % m
            if abs(prof[q][0] - prof[q2][0]) < 1e-9 and abs(prof[q][1] - prof[q2][1]) < 1e-9: continue
            k.face([rings[i][q], rings[j][q], rings[j][q2], rings[i][q2]], prof[q2][2])
    corner = [q for q in range(m) if abs((prof[q][0] - prof[q - 1][0]) * (prof[(q + 1) % m][1] - prof[q][1]) - (prof[q][1] - prof[q - 1][1]) * (prof[(q + 1) % m][0] - prof[q][0])) > 1e-9]  # drop collinear points: they triangulate to zero-area faces
    for i in skip:
        k.face([rings[i][q] for q in corner], 'soil'); k.face([rings[(i + 1) % n][q] for q in corner][::-1], 'soil')


def stadium(k):
    D = DIMS['stadium']; hx, hz, W = D['w'] / 2, D['d'] / 2, D['wall']; E = 1.25; rr = 1.0; nt = 7; cn = 20
    prof = _bank_profile(W, E, nt, k.hi); pts = _rrect(hx, hz, rr, cn, 0.45 if k.hi else None)
    # tunnel gap (krypte) in the west straight: open the bank at |z| < 1.1 and cap both ends against the stone block
    pts2 = [p for p in pts if not (abs(p[0] + hx) < 1e-6 and abs(p[1]) < 1.1)]
    i0 = max(i for i, p in enumerate(pts2) if abs(p[0] + hx) < 1e-6 and p[1] > 0)
    pts2[i0 + 1:i0 + 1] = [(-hx, 1.1, -1.0, 0.0), (-hx, -1.1, -1.0, 0.0)]; skip = {i0 + 1}
    _sweep(k, pts2, prof, skip, 0.012 if k.hi else 0.0)
    # sand floor: closed slab following the rounded outline
    fl = [(p[0], p[1]) for p in pts]; nf = len(fl); sc = (1.0, 0.7, 0.4, 0.15)
    rg = [[k.v(x * f, 0.03, z * f) for x, z in fl] for f in sc]; bot = [k.v(x, -0.06, z) for x, z in fl]; ct, cb = k.v(0, 0.03, 0), k.v(0, -0.06, 0)
    for r in range(len(sc) - 1):
        for i in range(nf): j = (i + 1) % nf; k.face([rg[r][i], rg[r][j], rg[r + 1][j], rg[r + 1][i]][::-1], 'sand')
    for i in range(nf):
        j = (i + 1) % nf; k.face([ct, rg[-1][i], rg[-1][j]][::-1], 'sand'); k.face([cb, bot[i], bot[j]], 'sand'); k.face([rg[0][i], bot[i], bot[j], rg[0][j]], 'sand')
    for sz in (-1, 1):  # start and finish lines: two stone sills with post sockets
        k.ashlar(0, 0.0, sz * (hz - 0.35), D['w'] - 0.5, 0.07, 0.16, 'marble', course=0.07, block=0.45)
        if k.hi:
            for i in range(8): k.box(-hx + 0.5 + i * (D['w'] - 1.0) / 7, 0.07, sz * (hz - 0.35), 0.07, 0.012, 0.07, 'dark')
    for i in range(5):  # judges' stair flush with the east bank terraces
        d = 0.3 + i * 0.26; k.ashlar(hx + d, 0.0, 0.0, 0.26, _bank_y(prof, d) + 0.03, 1.5, 'marble', course=0.125, block=0.5)
    k.ashlar(-hx - W / 2, 0.0, 0.0, W, E, 2.2, 'lime', course=0.21)  # tunnel block in the west bank
    for j in range(3):  # stepped stone cheek carrying the tunnel mouth out over the outer slope
        d0 = W + j * 0.47; k.ashlar(-hx - d0 - 0.235, 0.0, 0.0, 0.47, E * (1 - _smooth((d0 + 0.235 - W) / 1.4)) + 0.03, 2.2, 'lime', course=0.21, block=0.5)
    with k.frame(-hx - W / 2, 0.0, math.pi / 2): k.tube_arch(0, 0, 0, 1.1, 1.0, W + 0.04, 0.12, 'stone')
    k.box(-hx + 0.02, 0.0, 0.0, 0.05, 0.95, 1.0, 'dark')
    # exedra seat of the Hellanodikai on the south bank
    k.ashlar(0, _bank_y(prof, 0.55) - 0.03, hz + 0.55, 1.1, 0.3, 0.45, 'marble', course=0.15)
    if k.hi:  # scattered fieldstones and tufts of rock on the terraces (normal-map detail only)
        for i in range(46):
            side = k.rnd.random(); d = 0.2 + k.rnd.random() * (W - 0.3)
            x, z = (hx + d, (k.rnd.random() - 0.5) * 2 * (hz - 1.2)) if side < 0.4 else ((-hx - d, (k.rnd.random() - 0.5) * 2 * (hz - 1.2)) if side < 0.6 else ((k.rnd.random() - 0.5) * 2 * (hx - 1.2), (hz + d) if side < 0.8 else -(hz + d)))
            if x < -hx and abs(z) < 1.3: continue
            k.rock(x, _bank_y(prof, d) - 0.01, z, 0.025 + k.rnd.random() * 0.03, 'stone', seed=i, squash=0.6, sub=2)

ASSETS = {
    'temple': (temple, 2048), 'stoa': (stoa, 1024), 'stoa_short': (stoa_short, 1024), 'tholos': (tholos, 2048), 'treasury': (treasury, 1024),
    'treasury_small': (treasury_small, 512), 'workshop': (workshop, 1024), 'tower': (tower, 1024), 'bouleuterion': (bouleuterion, 2048),
    'palaestra': (palaestra, 1024), 'hostel': (hostel, 1024), 'propylon': (propylon, 1024), 'statue': (statue, 512), 'herm': (herm, 512),
    'torch': (torch, 256), 'altar': (None, 512), 'stadium': (stadium, 2048),
}


def altar(k):
    k.ashlar(0, 0.0, 0, 0.9, 0.16, 0.9, 'lime', course=0.16)
    k.ashlar(0, 0.16, 0, 0.7, 0.2, 0.7, 'marble', course=0.2)
    k.box(0, 0.36, 0, 0.78, 0.06, 0.78, 'marble')
    for sx in (-1, 1):
        for sz in (-1, 1): k.lathe(sx * 0.32, 0.42, sz * 0.32, [(0.0, 0.0), (0.05, 0.0), (0.04, 0.1), (0.0, 0.12)], 10 if k.hi else 6, 'marble')
    k.lathe(0, 0.42, 0, [(0.0, 0.0), (0.26, 0.0), (0.3, 0.05), (0.26, 0.09), (0.0, 0.07)], 24 if k.hi else 10, 'dark')


ASSETS['altar'] = (altar, 512)
