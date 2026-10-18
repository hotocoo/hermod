"""QA turntable stills (Cycles, 3 angles) for the sanctuary glb set: blender -b --factory-startup -P qa.py -- <outDir> [id ...]. Reads assets/cache/site-src (webp source glb)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from common import argv, turntable
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.environ.get('SITE_ASSET_OUT') or os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', 'assets', 'cache', 'site-src'))
a = argv(); out = a[0]; ids = a[1:] or sorted(f[:-4] for f in os.listdir(SRC) if f.endswith('.glb'))
os.makedirs(out, exist_ok=True)
import bpy
for i in ids:
    turntable(os.path.join(SRC, i + '.glb'), out, i, frames=(30, 150, 270), px=640)
