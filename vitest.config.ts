import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // legal/*.md load as raw text, as next.config.ts's raw-loader rule does for the app
  plugins: [{ name: 'md-raw', transform: (code, id) => (id.endsWith('.md') ? `export default ${JSON.stringify(code)};` : undefined) }],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
