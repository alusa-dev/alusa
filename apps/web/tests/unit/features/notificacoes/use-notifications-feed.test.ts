import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNotificationsFeed } from '@/features/notificacoes/hooks/use-notifications-feed';

function response(items: Array<{ id: string; readAt: string | null }>) {
  return {
    ok: true,
    json: async () => ({ items, unreadCount: items.filter((item) => !item.readAt).length, totalCount: items.length }),
  } as Response;
}

describe('useNotificationsFeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preserva os itens ao fechar e recarrega ao reabrir dentro da janela de throttling', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response([{ id: 'notification-1', readAt: null }]))
      .mockResolvedValueOnce(response([{ id: 'notification-1', readAt: null }, { id: 'notification-2', readAt: null }]));
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) => useNotificationsFeed({ enabled: true, isOpen, limit: 5 }),
      { initialProps: { isOpen: false } },
    );

    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ isOpen: true });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ isOpen: false });
    expect(result.current.items).toHaveLength(1);

    rerender({ isOpen: true });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('limpa o feed quando a autorização deixa de existir', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([{ id: 'notification-1', readAt: null }]));
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useNotificationsFeed({ enabled, isOpen: true }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => rerender({ enabled: false }));
    expect(result.current.items).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });
});
