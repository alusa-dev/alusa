'use client';

import { useEffect, useState } from 'react';

import { formatReservationCountdown } from './public-order-utils';

export function PublicOrderReservationCountdown({
  expiresAt,
  className,
}: {
  expiresAt: string | null;
  className?: string;
}) {
  const [label, setLabel] = useState(() => formatReservationCountdown(expiresAt));

  useEffect(() => {
    function tick() {
      setLabel(formatReservationCountdown(expiresAt));
    }

    tick();
    const intervalId = window.setInterval(tick, 30_000);
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
      <span className={expired ? 'text-rose-700 font-semibold' : 'text-amber-800 font-semibold'}>{label}</span>
      {!expired ? <span className="text-slate-500"> para pagamento</span> : null}
    </p>
  );
}
