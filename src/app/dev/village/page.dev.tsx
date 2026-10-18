import { notFound } from 'next/navigation';
import VillageDev from './VillageDev';

/** Dev-only harness: never ships (404 in production builds). */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <VillageDev />;
}
