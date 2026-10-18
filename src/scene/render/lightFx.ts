import * as THREE from 'three';
import { LIGHT_FX as LF, LIGHT_TIERS, type QualityTier } from '@/config/scene';

/**
 * PCSS contact-hardening shadows + photometric (IES style) lamp profiles.
 *
 * PCSS: three's default PCF shadow lookup uses a hardware compare sampler, which cannot return the blocker depth. The BASIC shadow type samples the raw depth
 * texture instead, so on high and ultra the renderer uses BASIC and this module swaps BASIC's `getShadow` for a blocker search + variable-radius filter
 * (receiver plane depth bias, Vogel taps rotated by interleaved gradient noise). Penumbra width grows with the blocker to receiver distance: hard at contact, soft far away.
 * Low and medium keep the stock 5 tap PCF. Everything runs at the 1x render scale.
 */
const P = { ...LF.pcss, ...((globalThis as { __lfx?: { pcssCfg?: Partial<typeof LF.pcss> } }).__lfx?.pcssCfg ?? {}) }; // dev A/B: __lfx.pcssCfg overrides the PCSS numbers (read once, before the first compile)
const PCSS_GLSL = /* glsl */ `
#else // SHADOWMAP_TYPE_BASIC (hermod PCSS)
		float pcssIgn( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
		vec2 pcssVogel( int i, int n, float phi ) { float r = sqrt( ( float( i ) + 0.5 ) / float( n ) ); float a = float( i ) * 2.399963229728653 + phi; return vec2( cos( a ), sin( a ) ) * r; }
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			vec3 sdx = dFdx( shadowCoord.xyz ); vec3 sdy = dFdy( shadowCoord.xyz );
			float det = sdx.x * sdy.y - sdx.y * sdy.x;
			vec2 rp = abs( det ) > 1e-12 ? vec2( sdy.y * sdx.z - sdx.y * sdy.z, sdx.x * sdy.z - sdy.x * sdx.z ) / det : vec2( 0.0 );
			rp = clamp( rp, vec2( -0.5 ), vec2( 0.5 ) );
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			if ( inFrustum && shadowCoord.z <= 1.0 ) {
				// tap budget by view depth (1 / gl_FragCoord.w): a penumbra far from the camera is a few pixels wide, so fewer taps (TAA resolves the rest) and a cheaper blocker search
				bool isFar = 1.0 / gl_FragCoord.w > ${P.lodFrom.toFixed(1)}; int nbT = isFar ? ${P.farBlockerTaps} : ${P.blockerTaps}; int nfT = isFar ? ${P.farFilterTaps} : ${P.filterTaps};
				float zr = shadowCoord.z; float phi = pcssIgn( gl_FragCoord.xy ) * PI2;
				float searchR = shadowRadius * ${P.search.toFixed(5)}; float zSum = 0.0; float nb = 0.0;
				for ( int i = 0; i < ${P.blockerTaps}; i ++ ) {
					if ( i >= nbT ) break;
					vec2 o = i == 0 ? vec2( 0.0 ) : pcssVogel( i - 1, nbT - 1, phi ) * searchR; // tap 0 at the receiver itself: a thin umbra narrower than the first ring is still found
					float zs = texture2D( shadowMap, shadowCoord.xy + o ).r;
					if ( zs < zr + dot( o, rp ) ) { zSum += zs; nb += 1.0; }
				}
				if ( nb >= float( nbT ) ) shadow = 0.0; // every search tap blocked: umbra (the search disc is wider than maxUv), skip the filter
				else if ( nb > 0.0 ) {
					float pen = clamp( ( zr - zSum / nb ) * shadowRadius * ${P.k.toFixed(5)}, ${P.minUv.toFixed(5)}, ${P.maxUv.toFixed(5)} ); float lit = 0.0;
					for ( int i = 0; i < ${P.filterTaps}; i ++ ) {
						if ( i >= nfT ) break;
						vec2 o = pcssVogel( i, nfT, phi + 1.7 ) * pen; lit += step( zr + dot( o, rp ), texture2D( shadowMap, shadowCoord.xy + o ).r );
					}
					shadow = lit / float( nfT );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
`;
const POINT_TAPS = /* glsl */ `{
				vec3 pa = abs( bd3D ); vec3 pt = normalize( cross( bd3D, pa.x > pa.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) ); vec3 pb = cross( bd3D, pt );
				float pr = shadowRadius / shadowMapSize.x; float ph = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) * PI2; float acc = 0.0;
				for ( int i = 0; i < 5; i ++ ) { float rr = sqrt( ( float( i ) + 0.5 ) / 5.0 ); float aa = float( i ) * 2.399963229728653 + ph; vec2 o = vec2( cos( aa ), sin( aa ) ) * rr * pr; acc += step( dp, textureCube( shadowMap, bd3D + pt * o.x + pb * o.y ).r ); }
				shadow = acc * 0.2; }`;

/** Dev A/B switch for screenshots: `window.__lfx = { pcss: false, ies: false, rect: false, rectfar: false, froxel: false }` before the page loads turns a feature off. All on by default. `rectLights` (pool size) and `rectFar` (far field range) override the config numbers. */
export const lfxOn = (k: 'pcss' | 'ies' | 'rect' | 'rectfar' | 'froxel'): boolean => (globalThis as { __lfx?: Record<string, boolean> }).__lfx?.[k] !== false;


const RECT_HEAD = /float roughness = material\.roughness;\s*vec3 rectCoords\[ 4 \];/;
/** Beyond `LF.rect.cullRange` a pane is skipped outright; beyond `LF.rect.farRange` a window pane is a point source: its diffuse term is A cos(s) cos(l) / (pi d^2) (error under 1 percent at 4 pane widths), so the four edge LTC integrals and both LTC fetches are skipped. Specular of a far window is dropped. */
const rectFar = () => (globalThis as { __lfx?: { rectFar?: number } }).__lfx?.rectFar ?? LF.rect.farRange; // dev A/B: __lfx.rectFar overrides the range
const rectFarGlsl = () => /* glsl */ `
		{
			vec3 toL = lightPos - position; float d2r = dot( toL, toL );
			if ( d2r > ${(LF.rect.cullRange ** 2).toFixed(3)} ) return; // beyond cullRange a pane adds under 0.5 percent of the ambient (see lightFx.test), the GI probes carry its far glow
			if ( d2r > ${(rectFar() ** 2).toFixed(3)} ) {
				vec3 wl = toL * inversesqrt( d2r ); vec3 crs = cross( halfWidth, halfHeight ); float a4 = length( crs ); vec3 ln = - crs / max( a4, 1e-6 );
				float cs = max( dot( normal, wl ), 0.0 ) * max( dot( ln, - wl ), 0.0 );
				reflectedLight.directDiffuse += lightColor * material.diffuseContribution * ( 4.0 * a4 * cs / ( PI * d2r ) );
				return;
			}
		}
		`;
let rectPatched = false;
/** Add the far field point approximation to three's RectAreaLight shading. Idempotent; call before the first rect light program compiles. */
export function installRectChunk(): boolean {
  if (rectPatched) return true; if (!lfxOn('rectfar')) return false;
  const src = THREE.ShaderChunk.lights_physical_pars_fragment; if (src.includes('d2r >')) { rectPatched = true; return true; } // already patched (module reloaded in dev)
  if (!RECT_HEAD.test(src) || !src.includes('void RE_Direct_RectArea_Physical')) { console.warn('[lightFx] rect area chunk layout changed, far field LOD disabled'); return false; }
  THREE.ShaderChunk.lights_physical_pars_fragment = src.replace(RECT_HEAD, () => 'float roughness = material.roughness;\n' + rectFarGlsl() + '\n\t\tvec3 rectCoords[ 4 ];');
  rectPatched = true; return true;
}

let patched = false;
/** Swap BASIC's directional/spot lookup for PCSS and soften its point lookup. Idempotent; call before the first material compiles. */
export function installShadowChunks(): boolean {
  if (patched) return true;
  const src = THREE.ShaderChunk.shadowmap_pars_fragment; if (src.includes('hermod PCSS')) { patched = true; return true; } // already patched (module reloaded in dev)
  const re = /#else[^\n]*\n\s*float getShadow\([\s\S]*?return mix\( 1\.0, shadow, shadowIntensity \);\s*\}\s*/;
  if (!re.test(src) || !src.includes('shadow = step( dp, depth );')) { console.warn('[lightFx] shadow chunk layout changed, PCSS disabled'); return false; }
  THREE.ShaderChunk.shadowmap_pars_fragment = src.replace(re, PCSS_GLSL).replace('shadow = step( dp, depth );', POINT_TAPS);
  patched = true; return true;
}

/** PCSS needs raw depth (BASIC); other tiers keep hardware PCF. On a change every shadow map and program is rebuilt once. */
export function applyShadowTier(renderer: THREE.WebGLRenderer, scene: THREE.Scene, tier: QualityTier): void {
  const want = LIGHT_TIERS[tier].pcss && lfxOn('pcss') && installShadowChunks() ? THREE.BasicShadowMap : THREE.PCFShadowMap;
  if (renderer.shadowMap.type === want) return;
  renderer.shadowMap.type = want;
  scene.traverse((o) => {
    const l = o as THREE.SpotLight; if (l.isLight && l.shadow?.map) { l.shadow.map.dispose(); l.shadow.map = null; }
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; });
  });
  renderer.shadowMap.needsUpdate = true;
}

/**
 * IES style cookie: the lamp's photometric web (value against the polar angle from its axis) baked into the texture a SpotLight projects. The cookie lives in the
 * projection plane, so texel radius rho maps to polar angle atan(rho * tan(spot angle)); this makes the projected profile angle-accurate for any cone.
 */
const iesCache = new Map<string, THREE.DataTexture>();
export function iesTexture(name: keyof typeof LF.ies): THREE.DataTexture {
  const hit = iesCache.get(name); if (hit) return hit;
  const P2 = LF.ies[name]; const n = P2.size; const web = P2.web; const data = new Uint8Array(n * n * 4); const ta = Math.tan(P2.angle);
  const at = (deg: number) => { if (deg >= web[web.length - 1][0]) return web[web.length - 1][1] * Math.max(0, 1 - (deg - web[web.length - 1][0]) / 20); for (let i = 1; i < web.length; i++) if (deg <= web[i][0]) { const [a0, v0] = web[i - 1], [a1, v1] = web[i]; return v0 + ((deg - a0) / (a1 - a0)) * (v1 - v0); } return 0; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = ((x + 0.5) / n) * 2 - 1, v = ((y + 0.5) / n) * 2 - 1; const rho = Math.hypot(u, v); const v8 = Math.round(255 * (rho > 1 ? 0 : at((Math.atan(rho * ta) * 180) / Math.PI)));
    const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v8; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); t.colorSpace = THREE.NoColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  iesCache.set(name, t); return t;
}

/** A downward lantern: SpotLight on the lamp axis with the IES cookie. Its target joins `parent` so the axis follows the parent transform. */
export function lanternLight(parent: THREE.Object3D, color: number, distance: number, decay: number): THREE.SpotLight {
  const I = LF.ies.lantern; const l = new THREE.SpotLight(color, 0, distance, I.angle, I.penumbra, decay); l.map = iesTexture('lantern'); l.castShadow = false;
  parent.add(l, l.target); return l;
}
/** Point the lantern straight down from its current position (call after setting `position`). */
export function aimDown(l: THREE.SpotLight): void { l.target.position.set(l.position.x, l.position.y - 1, l.position.z); l.target.updateMatrixWorld(); }
