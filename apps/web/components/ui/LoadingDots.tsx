'use client';

import styles from './LoadingDots.module.css';

interface LoadingDotsProps {
  label?: string;
  className?: string;
}

export function LoadingDots({ label = 'Salvando cadastro', className }: LoadingDotsProps) {
  return (
    <span
      className={[styles.indicator, className].filter(Boolean).join(' ')}
      role="status"
      aria-label={label}
    />
  );
}
