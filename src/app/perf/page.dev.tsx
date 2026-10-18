'use client';
// Dev-only scene perf harness (see scripts/perf-scene.mjs). The `dev.tsx` page extension is registered outside production only (next.config.ts), so this route is never part of the static export.
import dynamic from 'next/dynamic';

const Harness = dynamic(() => import('./PerfHarness'), { ssr: false });

export default function PerfPage() {
  return <Harness />;
}
