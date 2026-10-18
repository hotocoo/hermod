'use client';
import { Gate } from '@/components/gate/Gate';
import { TownRoot } from '@/components/town/TownRoot';
import { useAppStore } from '@/state/store';

import { useAppBoot } from './useAppBoot';

export default function App() {
  useAppBoot();
  const inApp = useAppStore((s) => s.phase === 'app' && !!s.seed);
  return inApp ? <TownRoot /> : <Gate />;
}
