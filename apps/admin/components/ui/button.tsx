import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ className = '', children, variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: string; size?: string }) {
  return <button className={`admin-button ${className}`} {...props}>{children}</button>;
}
