/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/mobile-auth-service', () => ({
  verifyMobileAccessToken: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true })),
}));

vi.mock('@alusa/lib', () => ({
  listNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  updateNotificationRecipientState: vi.fn(),
  deleteNotificationRecipient: vi.fn(),
}));

const { verifyMobileAccessToken } = await import('@/lib/mobile-auth-service');
const {
  listNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  updateNotificationRecipientState,
  deleteNotificationRecipient,
} = await import('@alusa/lib');
const feedRoute = await import('@/app/api/mobile/notifications/route');
const countRoute = await import('@/app/api/mobile/notifications/unread-count/route');
const itemRoute = await import('@/app/api/mobile/notifications/[id]/route');

const actor = { userId: 'user-1', contaId: 'conta-1', role: 'ADMIN' };

describe('mobile notifications API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyMobileAccessToken).mockResolvedValue(actor);
  });

  it('lista o mesmo feed interno isolado por conta e usuário', async () => {
    vi.mocked(listNotifications).mockResolvedValue({ items: [], unreadCount: 0, totalCount: 0 });

    const request = new NextRequest('http://localhost/api/mobile/notifications?limit=20&page=1&view=active', {
      headers: { authorization: 'Bearer access-token' },
    });
    const response = await feedRoute.GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], unreadCount: 0, totalCount: 0 });
    expect(listNotifications).toHaveBeenCalledWith({ contaId: 'conta-1', userId: 'user-1', limit: 20, page: 1, view: 'active' });
  });

  it('consulta o contador e permite marcar todas como lidas', async () => {
    vi.mocked(getUnreadNotificationCount).mockResolvedValue(3);
    vi.mocked(markAllNotificationsAsRead).mockResolvedValue(3);

    const countResponse = await countRoute.GET(new NextRequest('http://localhost/api/mobile/notifications/unread-count', { headers: { authorization: 'Bearer access-token' } }));
    const patchResponse = await feedRoute.PATCH(new NextRequest('http://localhost/api/mobile/notifications', {
      method: 'PATCH',
      headers: { authorization: 'Bearer access-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'markAllRead' }),
    }));

    expect(await countResponse.json()).toEqual({ count: 3 });
    expect(await patchResponse.json()).toEqual({ success: true, updatedCount: 3 });
    expect(markAllNotificationsAsRead).toHaveBeenCalledWith({ contaId: 'conta-1', userId: 'user-1' });
  });

  it('atualiza e exclui somente o vínculo do usuário autenticado', async () => {
    vi.mocked(updateNotificationRecipientState).mockResolvedValue(true);
    vi.mocked(deleteNotificationRecipient).mockResolvedValue(true);

    const patchResponse = await itemRoute.PATCH(
      new NextRequest('http://localhost/api/mobile/notifications/notif-1', {
        method: 'PATCH',
        headers: { authorization: 'Bearer access-token', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'read' }),
      }),
      { params: Promise.resolve({ id: 'notif-1' }) },
    );
    const deleteResponse = await itemRoute.DELETE(
      new NextRequest('http://localhost/api/mobile/notifications/notif-1', { headers: { authorization: 'Bearer access-token' } }),
      { params: Promise.resolve({ id: 'notif-1' }) },
    );

    expect(await patchResponse.json()).toEqual({ success: true });
    expect(await deleteResponse.json()).toEqual({ success: true });
    expect(updateNotificationRecipientState).toHaveBeenCalledWith({ contaId: 'conta-1', userId: 'user-1', notificationId: 'notif-1', action: 'read' });
    expect(deleteNotificationRecipient).toHaveBeenCalledWith({ contaId: 'conta-1', userId: 'user-1', notificationId: 'notif-1' });
  });

  it('rejeita perfil fora da política de notificações internas', async () => {
    vi.mocked(verifyMobileAccessToken).mockResolvedValue({ ...actor, role: 'PROFESSOR' });

    const response = await feedRoute.GET(new NextRequest('http://localhost/api/mobile/notifications', { headers: { authorization: 'Bearer access-token' } }));

    expect(response.status).toBe(403);
    expect(listNotifications).not.toHaveBeenCalled();
  });
});
