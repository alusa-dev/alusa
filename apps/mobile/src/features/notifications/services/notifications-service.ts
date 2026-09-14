import { authenticatedApi } from '@/features/auth/services/auth-service';

import type {
  MobileNotificationAction,
  MobileNotificationListResponse,
  MobileNotificationUnreadCountResponse,
} from '../types/notifications';

function queryString(input: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const notificationsService = {
  list(input: { limit?: number; page?: number; view?: 'active' | 'archived' | 'all' } = {}) {
    return authenticatedApi.request<MobileNotificationListResponse>({
      method: 'GET',
      path: `/api/mobile/notifications${queryString({
        limit: input.limit,
        page: input.page,
        view: input.view,
      })}`,
    });
  },

  getUnreadCount() {
    return authenticatedApi.request<MobileNotificationUnreadCountResponse>({
      method: 'GET',
      path: '/api/mobile/notifications/unread-count',
    });
  },

  update(notificationId: string, action: MobileNotificationAction) {
    return authenticatedApi.request<{ success: true }>({
      method: 'PATCH',
      path: `/api/mobile/notifications/${encodeURIComponent(notificationId)}`,
      body: { action },
    });
  },

  markAllAsRead() {
    return authenticatedApi.request<{ success: true; updatedCount: number }>({
      method: 'PATCH',
      path: '/api/mobile/notifications',
      body: { action: 'markAllRead' },
    });
  },

  remove(notificationId: string) {
    return authenticatedApi.request<{ success: true }>({
      method: 'DELETE',
      path: `/api/mobile/notifications/${encodeURIComponent(notificationId)}`,
    });
  },
};
