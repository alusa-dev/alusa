import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAccountVerification } from '@/features/kyc/hooks/use-account-verification';
import type { AccountVerificationResponse } from '@/features/kyc/constants';

function buildVerification(
  overrides: Partial<AccountVerificationResponse> = {},
): AccountVerificationResponse {
  return {
    status: 'ACCOUNT_ACTIVE',
    areas: [],
    actions: [],
    rejectReasons: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAccountVerification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('faz apenas a carga inicial e não entra em loop quando a verification muda', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ data: buildVerification() }));

    const { result } = renderHook(() => useAccountVerification({ enabled: true, poll: true }));

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('só faz autopoll no intervalo do estado transitório', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: buildVerification({ status: 'ACCOUNT_PENDING_ACTIVATION' }),
      }),
    );

    renderHook(() => useAccountVerification({ enabled: true, poll: true }));

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(19_000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/account/verification-status?fresh=1');
  });

  it('deduplica refresh concorrente enquanto já existe request fresh em voo', async () => {
    const fetchMock = vi.mocked(fetch);
    let resolveInitial: (() => void) | null = null;
    let resolveFresh: (() => void) | null = null;

    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitial = () => resolve(jsonResponse({ data: buildVerification() }));
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFresh = () => resolve(jsonResponse({ data: buildVerification() }));
          }),
      );

    const { result } = renderHook(() => useAccountVerification({ enabled: true, poll: false }));

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstRefresh = result.current.refresh(true);
    const secondRefresh = result.current.refresh(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveInitial?.();
      await Promise.resolve();
    });

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFresh?.();
      await Promise.all([firstRefresh, secondRefresh]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/account/verification-status?fresh=1');
  });

  it('respeita o Retry-After devolvido pelo endpoint em 202 NOT_READY', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: null, reason: 'NOT_READY' }), {
          status: 202,
          headers: { 'content-type': 'application/json', 'Retry-After': '3' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: buildVerification() }));

    renderHook(() => useAccountVerification({ enabled: true, poll: false }));

    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2_999);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/account/verification-status?fresh=1');
  });

  it('expõe provisioningHint quando o endpoint 202 inclui subaccountProvisioning', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: null,
          reason: 'NOT_READY',
          subaccountProvisioning: { state: 'QUEUED', jobStatus: 'PENDING' },
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { result } = renderHook(() => useAccountVerification({ enabled: true, poll: false }));

    await flushAsyncWork();

    expect(result.current.provisioningHint?.state).toBe('QUEUED');
  });
});
