import type { NextConfig } from 'next';

// Static export: Tauri serves ./out (see src-tauri/tauri.conf.json frontendDist).
// Dev-only pages are named page.dev.tsx; the 'dev.tsx' extension is registered outside production so they never enter the static export.
const nextConfig: NextConfig = {
  pageExtensions: process.env.NODE_ENV === 'production' ? ['tsx', 'ts', 'jsx', 'js'] : ['tsx', 'ts', 'jsx', 'js', 'dev.tsx'],
  output: 'export',
  // E2E builds (devhost transport) go to their own dir so the production `out/` (Tauri frontendDist) is never overwritten.
  ...(process.env.E2E_DIST ? { distDir: process.env.E2E_DIST } : {}),
  images: { unoptimized: true },
  // legal/*.md are bundled as raw text (Terms gate) so the app and the site read one source.
  turbopack: {
    rules: { '*.md': { loaders: ['raw-loader'], as: '*.js' } },
  },
};

export default nextConfig;
