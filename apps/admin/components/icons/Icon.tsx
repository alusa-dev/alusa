import type { HTMLAttributes } from 'react';

export type IconName = 'Search' | 'BuildingLibrary' | 'CreditCard' | 'Refresh' | 'DocumentText' | 'Clock' | 'Settings' | 'Users' | 'Bell' | 'CheckCircle' | 'ChevronRight';

export function Icon({ name, size = 16, ...props }: HTMLAttributes<HTMLSpanElement> & { name: IconName; size?: number }) {
  return <span role="img" aria-label={name} style={{ display: 'inline-flex', width: size, height: size, alignItems: 'center', justifyContent: 'center', fontSize: Math.max(10, size - 3) }} {...props}>•</span>;
}
