import { defineConfig, devices } from '@playwright/test';
import { BOOT_FACTOR, GL_ARGS } from './e2e/gpu';

const PORT = Number(process.env.E2E_UI_PORT ?? 3210);
/** Devhost ports are BASE, BASE+1, BASE+2 (A, B, FRESH); override E2E_BASE to run two suites side by side. */
const BASE = Number(process.env.E2E_BASE ?? 7781);
/** Local iteration only: reuse an already running UI server and hand-started devhosts (their data dirs then persist across runs). */
const REUSE = !!process.env.E2E_REUSE;
/** Static export of the devhost build, separate from the production `out/`. */
const SITE = `.e2e-site-${BASE}`;

/**
 * Real stack under test: three devhosts (real Core + real Node over HTTP), see docs/ARCHITECTURE.md sections 6.1 and 9.
 * The devhosts are not started here: every spec file replaces them with empty ones (`freshDevhosts` in e2e/devhosts.ts),
 * so specs never share identities, Spaces or peers.
 */
export default defineConfig({
  testDir: './e2e',
  // Side-by-side suites (other E2E_BASE) must not share artifacts.
  outputDir: BASE === 7781 ? 'test-results' : `test-results-${BASE}`,
  timeout: 120_000 * BOOT_FACTOR,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // A broken boot fails every spec; stop early instead of burning the 2 h job limit.
  maxFailures: process.env.CI ? 5 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: BASE === 7781 ? 'playwright-report' : `playwright-report-${BASE}` }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // Real GPU locally (ANGLE/Metal); software GL only on CI. See e2e/gpu.ts.
        launchOptions: { args: GL_ARGS },
      },
    },
  ],
  webServer: {
    // Devhost transport baked in; each page picks its peer with ?devhost=<url>.
    command: `E2E_DIST=${SITE} NEXT_PUBLIC_HERMOD_DEVHOST=1 npx next build && npx serve ${SITE} -l ${PORT} --no-clipboard`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: REUSE,
    timeout: 300_000,
  },
});
