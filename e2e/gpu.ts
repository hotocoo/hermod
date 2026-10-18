/**
 * Chromium WebGL flags. Software GL (swiftshader) makes the town's first build a 60 s main-thread stall, so it is only used where
 * no GPU exists (CI, E2E_SOFTWARE_GL=1). On macOS the real GPU is used through ANGLE/Metal (boot takes about 4 s).
 */
export const GL_ARGS: string[] = process.env.CI || process.env.E2E_SOFTWARE_GL || process.platform !== 'darwin'
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
