import { notFound } from 'next/navigation';
import RoomsDev from './RoomsDev';

/** Dev-only harness: never ships (404 in production builds, and not part of the static export). */
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <RoomsDev />;
}
