"""blender -b --factory-startup -P turntable.py -- <glb> <outDir> <name>  (QA stills; not part of shipped output)"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import argv, turntable
a = argv(); turntable(a[0], a[1], a[2])
