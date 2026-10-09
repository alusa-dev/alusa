'use client';

import { useEffect, useRef, useState } from 'react';

import { formatReservationCountdown } from './public-order-utils';

export function PublicOrderReservationCountdown({
  expiresAt,
  className,
  tone = 'warning',
  onExpired,
}: {
  expiresAt: string | null;
  className?: string;
  tone?: 'warning' | 'danger';
  onExpired?: () => void;
}) {
  const [label, setLabel] = useState<string | null>(null);
  const expirationNotified = useRef(false);
  const onExpiredRef = useRef(onExpired);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    expirationNotified.current = false;
    function tick() {
      const nextLabel = formatReservationCountdown(expiresAt);
      setLabel(nextLabel);
      if (nextLabel === 'Expirado' && !expirationNotified.current) {
        expirationNotified.current = true;
        onExpiredRef.current?.();
      }
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
      {expired ? <span className="ml-2 font-normal text-slate-600">Verificando o pagamento antes de liberar os assentos.</span> : null}
    </p>
  );
}
