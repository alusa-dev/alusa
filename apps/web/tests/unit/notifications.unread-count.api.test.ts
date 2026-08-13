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
  getUnreadNotificationCount: vi.fn(),
}));

const { getServerSession } = await import('next-auth');
const { getUnreadNotificationCount } = await import('@alusa/lib');
const { GET } = await import('@/app/api/notifications/unread-count/route');

describe('/api/notifications/unread-count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna somente o contador para o usuário autenticado no tenant', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);
    vi.mocked(getUnreadNotificationCount).mockResolvedValueOnce(3);

    const response = await GET(new NextRequest('http://localhost/api/notifications/unread-count'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 3 });
    expect(getUnreadNotificationCount).toHaveBeenCalledWith({
      contaId: 'conta-1',
      userId: 'user-1',
    });
  });

  it('rejeita usuário sem papel operacional', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', contaId: 'conta-1', role: 'PROFESSOR' },
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/notifications/unread-count'));

    expect(response.status).toBe(403);
    expect(getUnreadNotificationCount).not.toHaveBeenCalled();
  });
});
