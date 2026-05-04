'use client';

import { useEffect, useRef } from 'react';

type RefreshReason = 'interval' | 'focus' | 'visibility' | 'online';

interface UseFinanceLiveRefreshOptions {
  enabled?: boolean;
  intervalMs?: number | null;
  minIntervalMs?: number;
}

/**
 * Revalida leituras financeiras oficiais quando o usuário volta para a tela.
 * Mantém o Asaas como fonte de verdade, sem criar espelho local de saldo/ledger.
 */
export function useFinanceLiveRefresh(
  refresh: (_reason: RefreshReason) => void | Promise<void>,
  options: UseFinanceLiveRefreshOptions = {},
) {
  const { enabled = true, intervalMs = 30_000, minIntervalMs = 5_000 } = options;
  const refreshRef = useRef(refresh);
  const lastRunRef = useRef(0);

  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const run = (reason: RefreshReason, force = false) => {
      const now = Date.now();
      if (!force && now - lastRunRef.current < minIntervalMs) return;
      lastRunRef.current = now;
      void refreshRef.current(reason);
    };

    const handleFocus = () => run('focus');
    const handleOnline = () => run('online', true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') run('visibility');
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const intervalId =
      intervalMs && intervalMs > 0
        ? window.setInterval(() => run('interval'), intervalMs)
        : null;

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, minIntervalMs]);
}
