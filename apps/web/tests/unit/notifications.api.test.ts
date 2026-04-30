/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/lib', () => ({
  listNotifications: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
}));

const { getServerSession } = await import('next-auth');
const { listNotifications, markAllNotificationsAsRead } = await import('@alusa/lib');
const { GET, PATCH } = await import('@/app/api/notifications/route');

describe('/api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);

    const response = await GET(new NextRequest('http://localhost/api/notifications'));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: 'NAO_AUTENTICADO',
      message: 'Usuário não autenticado.',
    });
  });

  it('lista notificações com contrato estável', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);
    vi.mocked(listNotifications).mockResolvedValueOnce({
      items: [
        {
          id: 'notif-1',
          type: 'BILLING_CREATED',
          category: 'BILLING',
          severity: 'INFO',
          title: 'Cobrança disponível',
          message: 'Existe uma cobrança disponível.',
          relatedPath: '/cobrancas/1',
          entityType: 'Cobranca',
          entityId: 'cobranca-1',
          sourceType: 'ASAAS_WEBHOOK',
          sourceId: 'pay-1',
          metadata: null,
          createdAt: new Date('2026-03-14T10:00:00.000Z'),
          triggeredAt: new Date('2026-03-14T09:30:00.000Z'),
          readAt: null,
          archivedAt: null,
        },
      ],
      unreadCount: 1,
      totalCount: 1,
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/notifications?view=active&limit=5&page=1'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      items: [
        {
          id: 'notif-1',
          type: 'BILLING_CREATED',
          category: 'BILLING',
          severity: 'INFO',
          title: 'Cobrança disponível',
          message: 'Existe uma cobrança disponível.',
          relatedPath: '/cobrancas/1',
          entityType: 'Cobranca',
          entityId: 'cobranca-1',
          sourceType: 'ASAAS_WEBHOOK',
          sourceId: 'pay-1',
          metadata: null,
          createdAt: '2026-03-14T10:00:00.000Z',
          triggeredAt: '2026-03-14T09:30:00.000Z',
          readAt: null,
          archivedAt: null,
        },
      ],
      unreadCount: 1,
      totalCount: 1,
    });
    expect(listNotifications).toHaveBeenCalledWith({
      contaId: 'conta-1',
      userId: 'user-1',
      limit: 5,
      page: 1,
      view: 'active',
    });
  });

  it('marca todas como lidas', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', contaId: 'conta-1', role: 'FINANCEIRO' },
    } as never);
    vi.mocked(markAllNotificationsAsRead).mockResolvedValueOnce(4 as never);

    const response = await PATCH(
      new NextRequest('http://localhost/api/notifications', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'markAllRead' }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true, updatedCount: 4 });
    expect(markAllNotificationsAsRead).toHaveBeenCalledWith({
      contaId: 'conta-1',
      userId: 'user-1',
    });
  });

  it('retorna 422 com mensagem quando payload da ação em lote é inválido', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);

    const response = await PATCH(
      new NextRequest('http://localhost/api/notifications', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'archiveAll' }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error).toBe('PAYLOAD_INVALIDO');
    expect(json.message).toBe('Payload inválido para ação em lote.');
  });
});
