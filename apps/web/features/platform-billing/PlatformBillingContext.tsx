'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { logClientOperationalEvent } from '@/lib/observability/client-operational-log';
import {
  platformBillingAccessDTOSchema,
  platformBillingSummaryDTOSchema,
  type PlatformBillingAccessDTO,
  type PlatformBillingSummaryDTO,
} from './dtos/platform-billing-summary';

type PlatformBillingContextValue = {
  summary: PlatformBillingSummaryDTO | null;
  access: PlatformBillingAccessDTO | null;
  loading: boolean;
  refreshFailed: boolean;
  userId: string | null;
  refresh: (_force?: boolean) => Promise<boolean>;
};

const PlatformBillingContext = createContext<PlatformBillingContextValue | null>(null);

export function PlatformBillingProvider({ children }: { children: ReactNode }) {
  const { data: session, status: sessionStatus } = useSession();
  const [summary, setSummary] = useState<PlatformBillingSummaryDTO | null>(null);
  const [access, setAccess] = useState<PlatformBillingAccessDTO | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const lastFetchedAtRef = useRef(0);
  const inFlightRef = useRef<{ promise: Promise<boolean> } | null>(null);
  const requestIdRef = useRef(0);
  // Start conservatively so write actions cannot open before the first billing
  // policy response is available.
  const [loading, setLoading] = useState(true);
  const userId = typeof session?.user?.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const role = String((session?.user as { role?: string } | undefined)?.role ?? '').toUpperCase();
  const canRead = role === 'ADMIN' || role === 'FINANCEIRO';

  useEffect(() => {
    requestIdRef.current += 1;
    inFlightRef.current = null;
    lastFetchedAtRef.current = 0;
    setSummary(null);
    setAccess(null);
    setRefreshFailed(false);
    setLoading(true);
  }, [userId]);

  const refresh = useCallback(async (force = false) => {
    if (!canRead) {
      setSummary(null);
      setAccess(null);
      setRefreshFailed(false);
      setLoading(false);
      return false;
    }

    if (!force && summary && Date.now() - lastFetchedAtRef.current < 5 * 60_000) return true;
    if (inFlightRef.current && !force) return inFlightRef.current.promise;

    const requestId = ++requestIdRef.current;
    if (!summary) setLoading(true);
    const request = (async () => {
      try {
        const response = await fetch('/api/platform-billing/summary', {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          if (summary && requestId === requestIdRef.current) setRefreshFailed(true);
          return false;
        }

        const parsed = platformBillingSummaryDTOSchema.parse(await response.json());
        if (requestId === requestIdRef.current) {
          setSummary(parsed);
          setAccess(parsed.access);
          setRefreshFailed(false);
          lastFetchedAtRef.current = Date.now();
        }
        return requestId === requestIdRef.current;
      } catch (error) {
        logClientOperationalEvent('platform_billing.summary.load_failed', error);
        if (summary && requestId === requestIdRef.current) setRefreshFailed(true);
        return false;
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          inFlightRef.current = null;
        }
      }
    })();
    inFlightRef.current = { promise: request };
    return request;
  }, [canRead, summary]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') {
      setSummary(null);
      setAccess(null);
      setRefreshFailed(false);
      setLoading(false);
      return;
    }

    if (canRead) {
      void refresh();
      return;
    }

    let cancelled = false;
    setLoading(true);
    void fetch('/api/platform-billing/access', { cache: 'no-store', headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Platform access unavailable');
        return platformBillingAccessDTOSchema.parse(await response.json());
      })
      .then((snapshot) => {
        if (!cancelled) setAccess(snapshot);
      })
      .catch(() => {
        if (!cancelled) setAccess(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canRead, refresh, sessionStatus, userId]);

  const value = useMemo(() => ({ summary, access, loading, refreshFailed, userId, refresh }), [access, loading, refresh, refreshFailed, summary, userId]);
  return <PlatformBillingContext.Provider value={value}>{children}</PlatformBillingContext.Provider>;
}

export function usePlatformBilling() {
  const context = useContext(PlatformBillingContext);
  if (!context) throw new Error('usePlatformBilling must be used inside PlatformBillingProvider');
  return context;
}
