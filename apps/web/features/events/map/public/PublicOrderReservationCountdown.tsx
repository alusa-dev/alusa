'use client';

import { useEffect, useState } from 'react';

import { formatReservationCountdown } from './public-order-utils';

export function PublicOrderReservationCountdown({
  expiresAt,
  className,
  tone = 'warning',
}: {
  expiresAt: string | null;
  className?: string;
  tone?: 'warning' | 'danger';
}) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    function tick() {
      setLabel(formatReservationCountdown(expiresAt));
    }

    tick();
    const intervalId = window.setInterval(tick, 1_000);
    return () => window.clearInterval(intervalId);
  }, [expiresAt]);

  if (!expiresAt || !label) return null;

  const expired = label === 'Expirado';

  return (
    <p
      className={className}
      role="status"
      aria-live="polite"
    >
      {!expired ? (
        <span className={tone === 'danger' ? 'text-red-700' : 'text-slate-500'}>Tempo restante: </span>
      ) : null}
      <span className={expired ? 'font-semibold text-rose-700' : tone === 'danger' ? 'font-mono font-semibold tabular-nums text-red-700' : 'font-mono font-semibold tabular-nums text-amber-800'}>{label}</span>
    </p>
  );
}
