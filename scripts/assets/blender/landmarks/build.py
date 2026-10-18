"""Bake and export landmark assets: blender -b --factory-startup -P build.py -- [id ...]   (no ids = all). Writes public/assets/site/<id>.glb and assets.log.json."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import bake_and_export, OUT
from arch import ASSETS
from kit import ASSETS as KIT_ASSETS
ASSETS = {**ASSETS, **KIT_ASSETS}
ids = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(ASSETS)
stats = []
for i in ids:
    fn, size = ASSETS[i]; print('BUILD', i, flush=True); stats.append(bake_and_export(i, fn, size=size))
log = os.path.join(OUT, 'build-log.json')
old = {s['id']: s for s in (json.load(open(log)) if os.path.exists(log) else [])}
old.update({s['id']: s for s in stats}); json.dump(list(old.values()), open(log, 'w'), indent=1)
