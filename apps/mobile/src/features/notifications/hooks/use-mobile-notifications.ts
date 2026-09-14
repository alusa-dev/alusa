import { useCallback, useEffect, useRef, useState } from 'react';

import { isAuthError } from '@/lib/api/errors';

import { notificationsService } from '../services/notifications-service';
import type { MobileNotificationItem } from '../types/notifications';

const FEED_REFRESH_INTERVAL_MS = 15_000;

export function useMobileNotifications(visible: boolean) {
  const [items, setItems] = useState<MobileNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [countLoading, setCountLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastLoadedAtRef = useRef(0);

  const loadUnreadCount = useCallback(async () => {
    setCountLoading(true);
    try {
      const response = await notificationsService.getUnreadCount();
      setUnreadCount(response.count);
    } catch (reason) {
      if (!isAuthError(reason)) console.error('[MobileNotifications][unread-count]', reason);
    } finally {
      setCountLoading(false);
    }
  }, []);

  const load = useCallback(async (force = false) => {
    if (!visible) return;
    if (!force && Date.now() - lastLoadedAtRef.current < FEED_REFRESH_INTERVAL_MS) return;

    setLoading(true);
    setError(null);
    try {
      const response = await notificationsService.list({ limit: 20, page: 1, view: 'active' });
      setItems(response.items);
      setUnreadCount(response.unreadCount);
      lastLoadedAtRef.current = Date.now();
    } catch (reason) {
      if (isAuthError(reason)) {
        setItems([]);
        setUnreadCount(0);
        setError('Você não tem permissão para acessar as notificações.');
      } else {
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as notificações.');
        console.error('[MobileNotifications][load]', reason);
      }
    } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    void loadUnreadCount();
  }, [loadUnreadCount]);

  useEffect(() => {
    if (visible) void load(true);
  }, [load, visible]);

  const markAsRead = useCallback(async (notificationId: string) => {
    const current = items.find((item) => item.id === notificationId);
    if (!current || current.readAt) return;

    const now = new Date().toISOString();
    setItems((currentItems) => currentItems.map((item) => item.id === notificationId ? { ...item, readAt: now } : item));
    setUnreadCount((currentCount) => Math.max(0, currentCount - 1));
    try {
      await notificationsService.update(notificationId, 'read');
    } catch (reason) {
      setItems((currentItems) => currentItems.map((item) => item.id === notificationId ? { ...item, readAt: current.readAt } : item));
      setUnreadCount((currentCount) => currentCount + 1);
      console.error('[MobileNotifications][read]', reason);
    }
  }, [items]);

  const markAllAsRead = useCallback(async () => {
    if (submitting || unreadCount === 0) return;
    const previousItems = items;
    const now = new Date().toISOString();
    setSubmitting(true);
    setItems((currentItems) => currentItems.map((item) => item.readAt ? item : { ...item, readAt: now }));
    setUnreadCount(0);
    try {
      await notificationsService.markAllAsRead();
    } catch (reason) {
      setItems(previousItems);
      setUnreadCount(previousItems.filter((item) => !item.readAt && !item.archivedAt).length);
      console.error('[MobileNotifications][read-all]', reason);
    } finally {
      setSubmitting(false);
    }
  }, [items, submitting, unreadCount]);

  const remove = useCallback(async (notificationId: string) => {
    if (submitting) return;
    const previousItems = items;
    const removed = previousItems.find((item) => item.id === notificationId);
    if (!removed) return;
    setSubmitting(true);
    setItems((currentItems) => currentItems.filter((item) => item.id !== notificationId));
    if (!removed.readAt && !removed.archivedAt) setUnreadCount((currentCount) => Math.max(0, currentCount - 1));
    try {
      await notificationsService.remove(notificationId);
    } catch (reason) {
      setItems(previousItems);
      setUnreadCount(previousItems.filter((item) => !item.readAt && !item.archivedAt).length);
      console.error('[MobileNotifications][delete]', reason);
    } finally {
      setSubmitting(false);
    }
  }, [items, submitting]);

  return {
    items,
    unreadCount,
    loading,
    countLoading,
    submitting,
    error,
    reload: () => load(true),
    markAsRead,
    markAllAsRead,
    remove,
    refreshUnreadCount: loadUnreadCount,
  };
}

export type MobileNotificationsController = ReturnType<typeof useMobileNotifications>;
