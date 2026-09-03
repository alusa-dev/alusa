import type { ReactNode } from 'react';

import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';

type InfoCalloutVariant = 'info' | 'brand' | 'warning';
type InfoCalloutSize = 'sm' | 'md';

export function InfoCallout({
  variant = 'info',
  size = 'md',
  title,
  showIcon = false,
  children,
  className,
}: {
  variant?: InfoCalloutVariant;
  size?: InfoCalloutSize;
  title?: ReactNode;
  showIcon?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        'support-info-callout',
        `support-info-callout-${variant}`,
        `support-info-callout-${size}`,
        className,
      )}
    >
      <div className="support-info-callout-content">
        {showIcon ? (
          <Icon
            name={variant === 'warning' ? 'ExclamationTriangle' : 'InformationCircle'}
            size={18}
            aria-hidden="true"
          />
        ) : null}
        <div className="support-info-callout-copy">
          {title ? <p className="support-info-callout-title">{title}</p> : null}
          <div className="support-info-callout-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
