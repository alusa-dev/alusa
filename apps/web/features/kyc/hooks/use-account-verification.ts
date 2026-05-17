import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountVerificationResponse, SubaccountProvisioningHint } from '../constants';
import { SNAPSHOT_POLL_INTERVAL_MS } from '../constants';

const NOT_READY_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const UNDER_REVIEW_POLL_INTERVAL_MS = 60_000;
const PENDING_ACTIVATION_POLL_INTERVAL_MS = 20_000;

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) return null;
  const seconds = Number(retryAfterHeader);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

async function fetchVerification(
  fresh = false,
): Promise<{
  data: AccountVerificationResponse | null;
  reason?: string;
  retryAfterMs?: number;
  subaccountProvisioning?: SubaccountProvisioningHint;
}> {
  const url = fresh ? '/api/account/verification-status?fresh=1' : '/api/account/verification-status';
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: fresh ? 'no-store' : 'default',
  });
  const json = await res.json().catch(() => null);
  const retryAfterMs = parseRetryAfterMs(res.headers.get('Retry-After'));
  const subaccountProvisioning = (json as { subaccountProvisioning?: SubaccountProvisioningHint } | null)
    ?.subaccountProvisioning;

  // 202 = NOT_READY
  if (res.status === 202) {
    return {
      data: null,
      reason: 'NOT_READY',
      retryAfterMs: retryAfterMs ?? undefined,
      subaccountProvisioning,
    };
  }
  if (!res.ok) throw new Error((json as { error?: string } | null)?.error ?? 'Erro ao carregar status');
  return json as { data: AccountVerificationResponse };
}

function shouldAutoPoll(verification: AccountVerificationResponse | null): boolean {
  if (!verification) return true;
  if (verification.actions.some((action) => action.mode === 'WAITING_PROVIDER' || action.mode === 'PROVISIONING_TIMEOUT')) {
    return true;
  }

  return verification.status === 'ACCOUNT_PENDING_ACTIVATION' || verification.status === 'ACCOUNT_UNDER_REVIEW';
}

function getPollIntervalMs(verification: AccountVerificationResponse | null): number {
  if (!verification) return SNAPSHOT_POLL_INTERVAL_MS;
  if (verification.actions.some((action) => action.mode === 'WAITING_PROVIDER' || action.mode === 'PROVISIONING_TIMEOUT')) {
    return SNAPSHOT_POLL_INTERVAL_MS;
  }
  if (verification.status === 'ACCOUNT_PENDING_ACTIVATION') {
    return PENDING_ACTIVATION_POLL_INTERVAL_MS;
  }
  if (verification.status === 'ACCOUNT_UNDER_REVIEW') {
    return UNDER_REVIEW_POLL_INTERVAL_MS;
  }
  return SNAPSHOT_POLL_INTERVAL_MS;
}

export type UseAccountVerificationResult = {
  verification: AccountVerificationResponse | null;
  loading: boolean;
  error: string | null;
  isApproved: boolean;
  refresh: (_fresh?: boolean) => Promise<void>;
  fetchFresh: () => Promise<{ data: AccountVerificationResponse | null; reason?: string }>;
  /** Preenchido quando o snapshot KYC ainda não está pronto mas há contexto de provisionamento de subconta. */
  provisioningHint: SubaccountProvisioningHint | null;
};

export function useAccountVerification(opts?: {
  enabled?: boolean;
  poll?: boolean;
}): UseAccountVerificationResult {
  const { enabled = true, poll = true } = opts ?? {};

  const [loading, setLoading] = useState(true);
  const [verification, setVerification] = useState<AccountVerificationResponse | null>(null);
  const [provisioningHint, setProvisioningHint] = useState<SubaccountProvisioningHint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<{ fresh: boolean; promise: Promise<void> } | null>(null);
  const notReadyRetryRef = useRef<{ attempt: number; timer: ReturnType<typeof setTimeout> | null }>({
    attempt: 0,
    timer: null,
  });

  const load = useCallback(async (fresh = false, silent = false) => {
    while (inFlightRef.current) {
      const inFlight = inFlightRef.current;
      await inFlight.promise;
      if (!fresh || inFlight.fresh === fresh) {
        return;
      }
    }

    const promise = (async () => {
      try {
        if (!silent) setLoading(true);
        setError(null);
        const res = await fetchVerification(fresh);
        if (mountedRef.current) {
          setVerification(res.data);
          setProvisioningHint(res.subaccountProvisioning ?? null);
        }

        if (mountedRef.current && res.data === null && res.reason === 'NOT_READY') {
          const attempt = notReadyRetryRef.current.attempt;
          const delay = res.retryAfterMs ?? NOT_READY_RETRY_DELAYS_MS[attempt] ?? null;

          if (delay !== null) {
            notReadyRetryRef.current.attempt = attempt + 1;
            if (notReadyRetryRef.current.timer) clearTimeout(notReadyRetryRef.current.timer);
            notReadyRetryRef.current.timer = setTimeout(() => {
              if (!mountedRef.current) return;
              void load(true, true);
            }, delay);
          }
        } else if (mountedRef.current) {
          notReadyRetryRef.current.attempt = 0;
          if (notReadyRetryRef.current.timer) {
            clearTimeout(notReadyRetryRef.current.timer);
            notReadyRetryRef.current.timer = null;
          }
        }
      } catch (e) {
        if (mountedRef.current && !silent) setError((e as Error).message);
      } finally {
        if (mountedRef.current && !silent) setLoading(false);
      }
    })();

    inFlightRef.current = { fresh, promise };

    try {
      await promise;
    } finally {
      if (inFlightRef.current?.promise === promise) {
        inFlightRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const retryState = notReadyRetryRef.current;
    return () => {
      mountedRef.current = false;
      if (retryState.timer) clearTimeout(retryState.timer);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    void load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;
    if (!poll || !shouldAutoPoll(verification)) return;

    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void load(true, true);
    }, getPollIntervalMs(verification));

    return () => clearInterval(id);
  }, [enabled, poll, verification, load]);

  const refresh = useCallback(async (fresh = true) => load(fresh), [load]);

  const isApproved = verification?.status === 'ACCOUNT_ACTIVE';

  return {
    verification,
    loading,
    error,
    isApproved,
    refresh,
    fetchFresh: () => fetchVerification(true),
    provisioningHint,
  };
}
