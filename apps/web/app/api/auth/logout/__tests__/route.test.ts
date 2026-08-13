import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getTokenMock, updateManyMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
  updateManyMock: vi.fn(),
}));

vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }));
vi.mock('@/lib/prisma', () => ({ default: { usuario: { updateMany: updateManyMock } } }));

import { POST } from '@/app/api/auth/logout/route';

function request(cookie = 'next-auth.session-token.0=part0; next-auth.session-token.1=part1') {
  return new NextRequest('http://localhost:3000/api/auth/logout', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      referer: 'http://localhost:3000/dashboard',
      cookie,
    },
  });
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revoga a versão da sessão e expira todos os fragments do JWT', async () => {
    getTokenMock.mockResolvedValueOnce({ id: 'user_1' });
    updateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await POST(request());
    const cookies = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(cookies).toContain('next-auth.session-token.0=;');
    expect(cookies).toContain('next-auth.session-token.1=;');
    expect(cookies).toContain('__Secure-next-auth.session-token=;');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('SameSite=lax');
  });

  it('limpa cookies mesmo quando já não existe sessão', async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await POST(request('next-auth.session-token=stale'));

    expect(response.status).toBe(200);
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toContain('next-auth.session-token=;');
  });

  it('rejeita logout CSRF sem tocar na sessão', async () => {
    const response = await POST(new NextRequest('http://localhost:3000/api/auth/logout', { method: 'POST' }));

    expect(response.status).toBe(403);
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
