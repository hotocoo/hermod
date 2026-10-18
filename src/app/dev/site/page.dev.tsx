import { notFound } from 'next/navigation';
import SiteDev from './SiteDev';

/** Dev-only harness: never ships (404 in production builds). */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SiteDev />;
}
