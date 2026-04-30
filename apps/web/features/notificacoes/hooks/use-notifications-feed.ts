'use client';

import { startTransition, useCallback, useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast';
import type {
  NotificationAction,
  NotificationItem,
  NotificationListResponse,
  NotificationView,
} from '../types';

async function parseResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    const message =
      typeof data === 'object' && data
        ? 'message' in data && typeof data.message === 'string'
          ? data.message
          : 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Não foi possível concluir a operação.'
        : 'Não foi possível concluir a operação.';
    throw new Error(message);
  }
  if (!data) {
    throw new Error('Resposta inválida do servidor.');
  }
  return data;
}

export function useNotificationsFeed(params?: {
  view?: NotificationView;
  limit?: number;
  page?: number;
  autoRefreshMs?: number;
  enabled?: boolean;
}) {
  const view = params?.view ?? 'active';
  const limit = params?.limit ?? 20;
  const page = params?.page ?? 1;
  const autoRefreshMs = params?.autoRefreshMs ?? 0;
  const enabled = params?.enabled ?? true;

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const applyLocalAction = useCallback((notificationId: string, action: NotificationAction) => {
    setItems((currentItems) => {
      if (action === 'archive' && view === 'active') {
        return currentItems.filter((item) => item.id !== notificationId);
      }
      if (action === 'unarchive' && view === 'archived') {
        return currentItems.filter((item) => item.id !== notificationId);
      }

      return currentItems.map((item) => {
        if (item.id !== notificationId) return item;

        const now = new Date().toISOString();
        if (action === 'read') {
          return { ...item, readAt: item.readAt ?? now };
        }
        if (action === 'unread') {
          return { ...item, readAt: null };
        }
        if (action === 'archive') {
          return { ...item, archivedAt: now, readAt: item.readAt ?? now };
        }
        return { ...item, archivedAt: null };
      });
    });

    setUnreadCount((currentCount) => {
      const currentItem = items.find((item) => item.id === notificationId);
      if (!currentItem) return currentCount;
      if (action === 'read' && !currentItem.readAt) return Math.max(0, currentCount - 1);
      if (action === 'unread' && !currentItem.archivedAt && currentItem.readAt) return currentCount + 1;
      if (action === 'archive' && !currentItem.readAt) return Math.max(0, currentCount - 1);
      return currentCount;
    });

    setTotalCount((currentCount) => {
      if (action === 'archive' && view === 'active') return Math.max(0, currentCount - 1);
      if (action === 'unarchive' && view === 'archived') return Math.max(0, currentCount - 1);
      return currentCount;
    });
  }, [items, view]);

  const applyLocalDelete = useCallback((notificationId: string) => {
    const currentItem = items.find((item) => item.id === notificationId);
    setItems((currentItems) => currentItems.filter((item) => item.id !== notificationId));
    setTotalCount((currentCount) => Math.max(0, currentCount - 1));
    if (currentItem && !currentItem.readAt && !currentItem.archivedAt) {
      setUnreadCount((currentCount) => Math.max(0, currentCount - 1));
    }
  }, [items]);

  const load = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setUnreadCount(0);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const searchParams = new URLSearchParams({
        view,
        limit: String(limit),
        page: String(page),
      });
      const response = await fetch(`/api/notifications?${searchParams.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      const data = await parseResponse<NotificationListResponse>(response);
      setItems(data.items);
      setUnreadCount(data.unreadCount);
      setTotalCount(data.totalCount);
    } catch (error) {
      console.error('[Notifications][load]', error);
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar as notificações.');
    } finally {
      setLoading(false);
    }
  }, [enabled, limit, page, view]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled || autoRefreshMs <= 0) return undefined;
    const interval = window.setInterval(() => {
      startTransition(() => {
        void load();
      });
    }, autoRefreshMs);
    return () => window.clearInterval(interval);
  }, [autoRefreshMs, enabled, load]);

  const updateNotification = useCallback(
    async (notificationId: string, action: NotificationAction) => {
      setSubmitting(true);
      try {
        const response = await fetch(`/api/notifications/${notificationId}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action }),
        });
        await parseResponse<{ success: boolean }>(response);
        applyLocalAction(notificationId, action);
      } catch (error) {
        console.error('[Notifications][update]', error);
        toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar a notificação.');
        await load();
      } finally {
        setSubmitting(false);
      }
    },
    [applyLocalAction, load],
  );

  const markAllAsRead = useCallback(async () => {
    setSubmitting(true);
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'markAllRead' }),
      });
      await parseResponse<{ success: boolean }>(response);
      const now = new Date().toISOString();
      setItems((currentItems) =>
        currentItems.map((item) =>
          item.archivedAt || item.readAt ? item : { ...item, readAt: now }
        )
      );
      setUnreadCount(0);
    } catch (error) {
      console.error('[Notifications][markAllAsRead]', error);
      toast.error(error instanceof Error ? error.message : 'Não foi possível marcar as notificações como lidas.');
      await load();
    } finally {
      setSubmitting(false);
    }
  }, [load]);

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      setSubmitting(true);
      try {
        const response = await fetch(`/api/notifications/${notificationId}`, {
          method: 'DELETE',
        });
        await parseResponse<{ success: boolean }>(response);
        applyLocalDelete(notificationId);
      } catch (error) {
        console.error('[Notifications][delete]', error);
        toast.error(error instanceof Error ? error.message : 'Não foi possível excluir a notificação.');
        await load();
      } finally {
        setSubmitting(false);
      }
    },
    [applyLocalDelete, load],
  );

  return {
    items,
    unreadCount,
    totalCount,
    loading,
    submitting,
    reload: load,
    updateNotification,
    deleteNotification,
    markAllAsRead,
  };
}
