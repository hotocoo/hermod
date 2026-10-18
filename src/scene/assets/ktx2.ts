import type * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

interface Entry { loader: KTX2Loader; refs: number }
const live = new Map<THREE.WebGLRenderer, Entry>();

/** The one KTX2Loader (one transcoder worker pool) per renderer, shared by the room library and the site assets. Every acquire needs a matching release. */
export function acquireKtx2(r: THREE.WebGLRenderer, transcoderPath = '/basis/'): KTX2Loader {
  let e = live.get(r); if (!e) { e = { loader: new KTX2Loader().setTranscoderPath(transcoderPath).detectSupport(r), refs: 0 }; live.set(r, e); }
  e.refs++; return e.loader;
}
/** Drop one hold; the last one disposes the loader and its workers. */
export function releaseKtx2(r: THREE.WebGLRenderer): void {
  const e = live.get(r); if (!e || --e.refs > 0) return; e.loader.dispose(); live.delete(r);
}
