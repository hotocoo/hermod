import { ICONS, type IconName } from '@/config/icons';

interface IconProps { name: IconName | string; size?: number; strokeWidth?: number }

/** 24x24 stroke icon from the shared path table; null for an unknown name. */
export function Icon({ name, size = 18, strokeWidth = 1.6 }: IconProps) {
  const d = (ICONS as Record<string, string>)[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <path d={d} />
    </svg>
  );
}
