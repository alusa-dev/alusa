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
  updateNotificationRecipientState: vi.fn(),
  deleteNotificationRecipient: vi.fn(),
}));

const { getServerSession } = await import('next-auth');
const {
  updateNotificationRecipientState,
  deleteNotificationRecipient,
} = await import('@alusa/lib');
const { PATCH, DELETE } = await import('@/app/api/notifications/[id]/route');

describe('/api/notifications/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('atualiza o estado de uma notificação do usuário autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', contaId: 'conta-1', role: 'RECEPCAO' },
    } as never);
    vi.mocked(updateNotificationRecipientState).mockResolvedValueOnce(true as never);

    const response = await PATCH(
      new NextRequest('http://localhost/api/notifications/notif-1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'archive' }),
      }),
      { params: Promise.resolve({ id: 'notif-1' }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(updateNotificationRecipientState).toHaveBeenCalledWith({
      contaId: 'conta-1',
      userId: 'user-1',
      notificationId: 'notif-1',
      action: 'archive',
    });
  });

  it('retorna 404 com mensagem quando a notificação não existe para o usuário', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);
    vi.mocked(updateNotificationRecipientState).mockResolvedValueOnce(false as never);

    const response = await PATCH(
      new NextRequest('http://localhost/api/notifications/notif-404', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'read' }),
      }),
      { params: Promise.resolve({ id: 'notif-404' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toEqual({
      error: 'NOTIFICACAO_NAO_ENCONTRADA',
      message: 'Notificação não encontrada.',
    });
  });

  it('exclui apenas o vínculo do recipient autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', contaId: 'conta-1', role: 'FINANCEIRO' },
    } as never);
    vi.mocked(deleteNotificationRecipient).mockResolvedValueOnce(true as never);

    const response = await DELETE(
      new NextRequest('http://localhost/api/notifications/notif-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'notif-1' }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(deleteNotificationRecipient).toHaveBeenCalledWith({
      contaId: 'conta-1',
      userId: 'user-1',
      notificationId: 'notif-1',
    });
  });
});
