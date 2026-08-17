'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { platformBillingSummaryDTOSchema, type PlatformBillingSummaryDTO } from './dtos/platform-billing-summary';

type PlatformBillingContextValue = {
  summary: PlatformBillingSummaryDTO | null;
  loading: boolean;
  userId: string | null;
  refresh: () => Promise<void>;
};

const PlatformBillingContext = createContext<PlatformBillingContextValue | null>(null);

export function PlatformBillingProvider({ children }: { children: ReactNode }) {
  const { data: session, status: sessionStatus } = useSession();
  const [summary, setSummary] = useState<PlatformBillingSummaryDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const userId = typeof session?.user?.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const role = String((session?.user as { role?: string } | undefined)?.role ?? '').toUpperCase();
  const canRead = role === 'ADMIN' || role === 'FINANCEIRO';

  const refresh = useCallback(async () => {
    if (!canRead) {
      setSummary(null);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/platform-billing/summary', {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        setSummary(null);
        return;
      }

      setSummary(platformBillingSummaryDTOSchema.parse(await response.json()));
    } catch (error) {
      console.warn('[PlatformBillingProvider] failed to load summary', error);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !canRead) {
      setSummary(null);
      return;
    }

    void refresh();
  }, [canRead, refresh, sessionStatus]);

  const value = useMemo(() => ({ summary, loading, userId, refresh }), [loading, refresh, summary, userId]);
  return <PlatformBillingContext.Provider value={value}>{children}</PlatformBillingContext.Provider>;
}

export function usePlatformBilling() {
  const context = useContext(PlatformBillingContext);
  if (!context) throw new Error('usePlatformBilling must be used inside PlatformBillingProvider');
  return context;
}
