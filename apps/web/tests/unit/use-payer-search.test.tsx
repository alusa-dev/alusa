/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePayerSearch } from '@/hooks/usePayerSearch';

function deferred<T>() {
  let resolve!: (_value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const response = (results: Array<{ id: string }>, ok = true) => ({ ok, json: async () => ({ results }) });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('usePayerSearch request lifecycle', () => {
  it('ignores an older deferred response after a newer query resolves', async () => {
    vi.useFakeTimers();
    const older = deferred<ReturnType<typeof response>>();
    const newer = deferred<ReturnType<typeof response>>();
    const fetchMock = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePayerSearch());

    act(() => { result.current.setSearchQuery('old'); result.current.setSearchOpen(true); });
    expect(result.current.searching).toBe(true);
    await act(async () => { vi.advanceTimersByTime(300); });
    act(() => result.current.setSearchQuery('new'));
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { newer.resolve(response([{ id: 'new-result' }])); await newer.promise; });
    await act(async () => { older.resolve(response([{ id: 'old-result' }])); await older.promise; });

    expect(result.current.searchResults.map((item) => item.id)).toEqual(['new-result']);
  });

  it('clears stale results as soon as query becomes too short and exposes HTTP errors', async () => {
    vi.useFakeTimers();
    const pending = deferred<ReturnType<typeof response>>();
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response([], false));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePayerSearch());
    act(() => { result.current.setSearchQuery('maria'); result.current.setSearchOpen(true); });
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { pending.resolve(response([{ id: 'stale' }])); await pending.promise; });
    expect(result.current.searchResults).toHaveLength(1);

    act(() => result.current.setSearchQuery('m'));
    expect(result.current.searchResults).toEqual([]);
    expect(result.current.searching).toBe(false);
    act(() => result.current.setSearchQuery('maria'));
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.searchError).toBe(true);
  });

  it('aborts in-flight work when selection, reset, or unmount invalidates it', async () => {
    vi.useFakeTimers();
    const pending = deferred<ReturnType<typeof response>>();
    const selectedRequest = deferred<ReturnType<typeof response>>();
    const unmountedRequest = deferred<ReturnType<typeof response>>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(selectedRequest.promise)
      .mockReturnValueOnce(unmountedRequest.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(() => usePayerSearch());
    act(() => { result.current.setSearchQuery('mar'); result.current.setSearchOpen(true); });
    await act(async () => { vi.advanceTimersByTime(300); });
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    act(() => result.current.reset());
    expect(signal.aborted).toBe(true);
    pending.resolve(response([{ id: 'late' }]));
    await act(async () => { await pending.promise; });
    expect(result.current.searchResults).toEqual([]);

    act(() => { result.current.setSearchQuery('ana'); result.current.setSearchOpen(true); });
    await act(async () => { vi.advanceTimersByTime(300); });
    const selectionSignal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    act(() => result.current.handleSelectPayer({
      id: 'payer', name: 'Ana', type: 'responsavel', isMinor: false, hasResponsible: false,
      responsibleId: null, responsibleName: null,
      payerResolved: { type: 'responsavel', id: 'payer', name: 'Ana', hasAsaasCustomerId: true }, financialStatus: 'OK',
    }));
    expect(selectionSignal.aborted).toBe(true);

    act(() => { result.current.clearSelection(); result.current.setSearchQuery('ana'); result.current.setSearchOpen(true); });
    await act(async () => { vi.advanceTimersByTime(300); });
    const unmountSignal = fetchMock.mock.calls[2][1].signal as AbortSignal;
    unmount();
    expect(unmountSignal.aborted).toBe(true);
  });
});
