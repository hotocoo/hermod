import { notFound } from 'next/navigation';
import TownDev from './TownDev';

/** Dev-only harness: never ships (the dev.tsx page extension is not registered in production builds). */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <TownDev />;
}
