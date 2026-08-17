'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
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
  userId: string | null;
  refresh: (_force?: boolean) => Promise<void>;
};

const PlatformBillingContext = createContext<PlatformBillingContextValue | null>(null);

export function PlatformBillingProvider({ children }: { children: ReactNode }) {
  const { data: session, status: sessionStatus } = useSession();
  const [summary, setSummary] = useState<PlatformBillingSummaryDTO | null>(null);
  const [access, setAccess] = useState<PlatformBillingAccessDTO | null>(null);
  const lastFetchedAtRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Start conservatively so write actions cannot open before the first billing
  // policy response is available.
  const [loading, setLoading] = useState(true);
  const userId = typeof session?.user?.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const role = String((session?.user as { role?: string } | undefined)?.role ?? '').toUpperCase();
  const canRead = role === 'ADMIN' || role === 'FINANCEIRO';

  useEffect(() => {
    lastFetchedAtRef.current = 0;
    setSummary(null);
    setAccess(null);
  }, [userId]);

  const refresh = useCallback(async (force = false) => {
    if (!canRead) {
      setSummary(null);
      setAccess(null);
      setLoading(false);
      return;
    }

    if (!force && summary && Date.now() - lastFetchedAtRef.current < 5 * 60_000) return;
    if (inFlightRef.current) return inFlightRef.current;

    setLoading(true);
    const request = (async () => {
      try {
        const response = await fetch('/api/platform-billing/summary', {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          setSummary(null);
          setAccess(null);
          return;
        }

        const parsed = platformBillingSummaryDTOSchema.parse(await response.json());
        setSummary(parsed);
        setAccess(parsed.access);
        lastFetchedAtRef.current = Date.now();
      } catch (error) {
        console.warn('[PlatformBillingProvider] failed to load summary', error);
        setSummary(null);
        setAccess(null);
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = request;
    return request;
  }, [canRead, summary]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated') {
      setSummary(null);
      setAccess(null);
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
  }, [canRead, refresh, sessionStatus]);

  const value = useMemo(() => ({ summary, access, loading, userId, refresh }), [access, loading, refresh, summary, userId]);
  return <PlatformBillingContext.Provider value={value}>{children}</PlatformBillingContext.Provider>;
}

export function usePlatformBilling() {
  const context = useContext(PlatformBillingContext);
  if (!context) throw new Error('usePlatformBilling must be used inside PlatformBillingProvider');
  return context;
}
