/**
 * Chromium WebGL flags. Software GL (swiftshader) makes the town's first build a 60 s main-thread stall, so it is only used where
 * no GPU exists (CI, E2E_SOFTWARE_GL=1). On macOS the real GPU is used through ANGLE/Metal (boot takes about 4 s).
 */
const SOFTWARE_GL = !!(process.env.CI || process.env.E2E_SOFTWARE_GL || process.platform !== 'darwin');
/** Time factor for waits that include a town boot: software GL on a shared 4-vCPU runner boots two pages several times slower than a real GPU. */
export const BOOT_FACTOR = SOFTWARE_GL ? 2.5 : 1;
/** Waits after the town nav shows until the scene is up (real-GPU budgets, scaled by BOOT_FACTOR): canvas mounted, intro text gone, "Raising" splash gone. */
export const BOOT_WAIT = { canvas: 30_000 * BOOT_FACTOR, intro: 40_000 * BOOT_FACTOR, raising: 30_000 * BOOT_FACTOR } as const;
export const GL_ARGS: string[] = SOFTWARE_GL
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
