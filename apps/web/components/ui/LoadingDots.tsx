'use client';

import styles from './LoadingDots.module.css';

interface LoadingDotsProps {
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function LoadingDots({ label = 'Salvando cadastro', className, size = 'md' }: LoadingDotsProps) {
  return (
    <span
      className={[styles.indicator, className].filter(Boolean).join(' ')}
      style={size === 'sm' ? { width: 32 } : undefined}
      role="status"
      aria-label={label}
    />
  );
}
