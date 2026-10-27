'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';

type CheckoutResumePopupProps = {
  loading: boolean;
  onDismiss: () => void;
  onResume: () => void;
  placement?: 'viewport' | 'inline';
  autoDismissMs?: number | null;
  title?: string;
  description?: string;
  actionLabel?: string;
};

export function CheckoutResumePopup({
  loading,
  onDismiss,
  onResume,
  placement = 'viewport',
  autoDismissMs = 5000,
  title = 'Sua contratação está aguardando pagamento',
  description = 'Retome o checkout para revisar e confirmar o pagamento do plano.',
  actionLabel = 'Retomar contratação',
}: CheckoutResumePopupProps) {
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (paused || autoDismissMs === null) return;
    const timeout = window.setTimeout(() => dismissRef.current(), autoDismissMs);
    return () => window.clearTimeout(timeout);
  }, [autoDismissMs, paused]);

  const popup = (
    <aside
      role="status"
      aria-live="polite"
      className={`w-[min(24rem,calc(100vw-2.5rem))] animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none rounded-2xl border-0 bg-[#ddcbf5] p-5 text-[#3d3a3f] shadow-xl duration-200 ${placement === 'viewport' ? 'fixed bottom-5 right-5 z-[100]' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-5 text-[#302b36]">{title}</p>
          <p className="mt-1.5 text-sm leading-5 text-[#51485b]">{description}</p>
        </div>
        <button type="button" aria-label="Fechar aviso" onClick={onDismiss} className="-mr-2 -mt-2 flex size-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-[#51485b] transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">×</button>
      </div>
      <Button type="button" onClick={onResume} disabled={loading} className="mt-4 h-10 px-4 bg-[#512a82] text-[#f9f4fe] transition-colors duration-200 hover:bg-[#43236c]">
        {loading ? 'Abrindo...' : actionLabel}
      </Button>
    </aside>
  );

  if (placement === 'inline') return popup;
  if (typeof document === 'undefined') return null;
  return createPortal(popup, document.body);
}
