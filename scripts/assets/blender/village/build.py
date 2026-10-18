"""blender -b --factory-startup -P build.py -- [--size N] [--lm N] [--ultra] [id ...]   (no ids = all). Writes public/assets/village/<id>.glb and <id>.stats.json."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
size = lm = None; ultra = False; ids = []; i = 0
while i < len(args):
    a = args[i]
    if a == '--size': size = int(args[i + 1]); i += 1
    elif a == '--lm': lm = int(args[i + 1]); i += 1
    elif a == '--ultra': ultra = True
    else: ids.append(a)
    i += 1
import bake
from buildings import BUILDERS
try:
    from cottages import BUILDERS as CB; BUILDERS.update(CB)
except ImportError: pass
try:
    from props import BUILDERS as PB; BUILDERS.update(PB)
except ImportError: pass
for aid in ids or list(BUILDERS):
    fn, sz = BUILDERS[aid]; print('BUILD', aid, flush=True)
    bake.bake_asset(aid, fn, size=size or (min(4096, sz * 2) if ultra else sz), lm_size=lm or (1024 if ultra else 512), ultra=ultra)
