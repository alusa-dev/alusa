import type { HTMLAttributes, ReactNode } from 'react';

export function Badge({ children, className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode }) {
  return <span className={`admin-badge ${className}`} {...props}>{children}</span>;
}
