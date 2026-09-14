import { authenticatedApi } from '@/features/auth/services/auth-service';

import { notificationsService } from './notifications-service';

jest.mock('@/features/auth/services/auth-service', () => ({
  authenticatedApi: { request: jest.fn() },
}));

const requestMock = authenticatedApi.request as jest.Mock;

describe('notificationsService', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('lista o feed interno com paginação e visão ativa', async () => {
    requestMock.mockResolvedValue({ items: [], unreadCount: 0, totalCount: 0 });

    await notificationsService.list({ limit: 20, page: 1, view: 'active' });

    expect(requestMock).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/mobile/notifications?limit=20&page=1&view=active',
    });
  });

  it('usa os endpoints autenticados para contador e alteração de estado', async () => {
    requestMock.mockResolvedValue({ success: true });

    await notificationsService.getUnreadCount();
    await notificationsService.update('notification/1', 'read');
    await notificationsService.markAllAsRead();
    await notificationsService.remove('notification/1');

    expect(requestMock).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      path: '/api/mobile/notifications/unread-count',
    });
    expect(requestMock).toHaveBeenNthCalledWith(2, {
      method: 'PATCH',
      path: '/api/mobile/notifications/notification%2F1',
      body: { action: 'read' },
    });
    expect(requestMock).toHaveBeenNthCalledWith(3, {
      method: 'PATCH',
      path: '/api/mobile/notifications',
      body: { action: 'markAllRead' },
    });
    expect(requestMock).toHaveBeenNthCalledWith(4, {
      method: 'DELETE',
      path: '/api/mobile/notifications/notification%2F1',
    });
  });
});
