import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformBillingSummaryDTO } from '../dtos/platform-billing-summary';

const sessionState = vi.hoisted(() => ({
  data: { user: { id: 'user-1', role: 'ADMIN' } },
  status: 'authenticated',
}));

vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('@/lib/observability/client-operational-log', () => ({ logClientOperationalEvent: vi.fn() }));
vi.mock('../dtos/platform-billing-summary', () => ({
  platformBillingAccessDTOSchema: { parse: (value: unknown) => value },
  platformBillingSummaryDTOSchema: { parse: (value: unknown) => value },
}));

import { PlatformBillingProvider, usePlatformBilling } from '../PlatformBillingContext';

function summary(name: string) {
  return {
    marker: name,
    access: { accountId: `account-${name}`, accessStatus: 'ACTIVE' },
  } as unknown as PlatformBillingSummaryDTO;
}

function deferred<T>() {
  let resolve!: (_value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function response(value: unknown, ok = true) {
  return { ok, json: async () => value };
}

function wrapper({ children }: { children: ReactNode }) {
  return <PlatformBillingProvider>{children}</PlatformBillingProvider>;
}

describe('PlatformBillingProvider refresh', () => {
  beforeEach(() => {
    sessionState.data = { user: { id: 'user-1', role: 'ADMIN' } };
    sessionState.status = 'authenticated';
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('preserva o resumo e não liga o loading da página durante atualização ou falha', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(summary('saved')));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePlatformBilling(), { wrapper });

    await waitFor(() => expect(result.current.summary).toMatchObject({ marker: 'saved' }));
    fetchMock.mockResolvedValueOnce(response(null, false));

    await act(async () => result.current.refresh(true));

    expect(result.current.summary).toMatchObject({ marker: 'saved' });
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshFailed).toBe(true);

    fetchMock.mockResolvedValueOnce(response(summary('refreshed')));
    await act(async () => result.current.refresh(true));

    expect(result.current.summary).toMatchObject({ marker: 'refreshed' });
    expect(result.current.refreshFailed).toBe(false);
  });

  it('uma atualização forçada inicia fetch novo e impede a resposta antiga de sobrescrevê-lo', async () => {
    const older = deferred<ReturnType<typeof response>>();
    const newer = deferred<ReturnType<typeof response>>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePlatformBilling(), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    let forcedRefresh!: Promise<boolean>;
    act(() => { forcedRefresh = result.current.refresh(true); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      newer.resolve(response(summary('fresh')));
      await forcedRefresh;
    });
    await act(async () => { older.resolve(response(summary('stale'))); });

    expect(result.current.summary).toMatchObject({ marker: 'fresh' });
    expect(result.current.loading).toBe(false);
  });

  it('descarta a resposta do usuário anterior sem encerrar o loading do usuário atual', async () => {
    const userA = deferred<ReturnType<typeof response>>();
    const userB = deferred<ReturnType<typeof response>>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(userA.promise)
      .mockReturnValueOnce(userB.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(() => usePlatformBilling(), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    sessionState.data = { user: { id: 'user-2', role: 'ADMIN' } };
    rerender();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.loading).toBe(true);

    await act(async () => { userB.resolve(response(summary('user-b'))); });
    expect(result.current.summary).toMatchObject({ marker: 'user-b' });
    expect(result.current.access).toMatchObject({ accountId: 'account-user-b' });
    expect(result.current.loading).toBe(false);

    await act(async () => { userA.resolve(response(summary('user-a'))); });
    expect(result.current.summary).toMatchObject({ marker: 'user-b' });
    expect(result.current.access).toMatchObject({ accountId: 'account-user-b' });
    expect(result.current.loading).toBe(false);
  });
});
