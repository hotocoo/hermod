'use client';
import dynamic from 'next/dynamic';

// WebGL + window-bound store: client only.
const App = dynamic(() => import('@/components/app/App'), { ssr: false });

export default function Page() {
  return <App />;
}
