'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type CheckoutResumePopupProps = {
  loading: boolean;
  onDismiss: () => void;
  onResume: () => void;
  placement?: 'viewport' | 'top-right' | 'inline';
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
  const [isExiting, setIsExiting] = useState(false);
  const dismissalStartedRef = useRef(false);
  const exitTimeoutRef = useRef<number | null>(null);
  const dismissRef = useRef(onDismiss);
  const resumeRef = useRef(onResume);
  dismissRef.current = onDismiss;
  resumeRef.current = onResume;

  function startDismissal(afterExit: () => void = () => dismissRef.current()) {
    if (dismissalStartedRef.current) return;
    dismissalStartedRef.current = true;
    setIsExiting(true);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    exitTimeoutRef.current = window.setTimeout(afterExit, reducedMotion ? 0 : 200);
  }

  const startDismissalRef = useRef(startDismissal);
  startDismissalRef.current = startDismissal;

  useEffect(() => {
    if (paused || isExiting || autoDismissMs === null) return;
    const timeout = window.setTimeout(() => startDismissalRef.current(), autoDismissMs);
    return () => window.clearTimeout(timeout);
  }, [autoDismissMs, isExiting, paused]);

  useEffect(() => () => {
    if (exitTimeoutRef.current !== null) window.clearTimeout(exitTimeoutRef.current);
  }, []);

  const popup = (
    <aside
      role="status"
      aria-live="polite"
      className={`w-[min(32rem,calc(100vw-2.5rem))] rounded-xl border-0 bg-[#ebe3f4] p-4 text-[#3d3a3f] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)] ${isExiting ? `animate-out fade-out ${placement === 'top-right' ? 'slide-out-to-top-2' : 'slide-out-to-bottom-2'}` : `animate-in fade-in ${placement === 'top-right' ? 'slide-in-from-top-2' : 'slide-in-from-bottom-2'}`} motion-reduce:animate-none duration-200 motion-reduce:duration-0 ${placement === 'viewport' ? 'fixed bottom-5 right-5 z-[100]' : ''} ${placement === 'top-right' ? 'fixed z-[100]' : ''}`}
      style={placement === 'top-right' ? { top: '124px', right: 'var(--app-toast-right-offset, 24px)' } : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold leading-6 text-[#302b36]">{title}</p>
          <p className="mt-1.5 text-[13px] leading-[18px] text-[#51485b]">{description}</p>
        </div>
        <button type="button" aria-label="Fechar aviso" onClick={() => startDismissal()} disabled={isExiting} className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-[#51485b] transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none">×</button>
      </div>
      <button type="button" onClick={() => startDismissal(() => resumeRef.current())} disabled={loading || isExiting} className="mt-2.5 inline-flex p-0 text-[13px] font-medium leading-5 text-[#512a82] underline underline-offset-2 transition-colors hover:text-[#43236c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none">
        {loading ? 'Abrindo...' : actionLabel}
      </button>
    </aside>
  );

  if (placement === 'inline') return popup;
  if (typeof document === 'undefined') return null;
  return createPortal(popup, document.body);
}
