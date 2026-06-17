/** @vitest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFinanceRealtime } from '@/hooks/use-finance-realtime';

describe('useFinanceRealtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, events: [] }),
      }),
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('compartilha um único fetch entre múltiplos hooks no mesmo tick', async () => {
    const fetchMock = vi.mocked(fetch);

    renderHook(() =>
      useFinanceRealtime({
        onEvents: vi.fn(),
      }),
    );
    renderHook(() =>
      useFinanceRealtime({
        onEvents: vi.fn(),
      }),
    );
    renderHook(() =>
      useFinanceRealtime({
        onEvents: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('não entrega o mesmo evento duas vezes para o mesmo subscriber dentro da janela de dedupe', async () => {
    vi.advanceTimersByTime(6_000);

    const event = {
      type: 'PAYMENT_UPDATED',
      entityId: 'cobranca-1',
      ts: Date.now() + 1,
      status: 'PAGO',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, events: [event] }),
      }),
    );
    const onEvents = vi.fn();

    renderHook(() =>
      useFinanceRealtime({
        onEvents,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    document.dispatchEvent(new Event('visibilitychange'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(onEvents).toHaveBeenCalledWith([event]);
  });
});
