import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

  it('encerra somente o dispositivo atual e expira todos os fragments do JWT', async () => {
    const response = await POST(request());
    const cookies = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(cookies).toContain('next-auth.session-token.0=;');
    expect(cookies).toContain('next-auth.session-token.1=;');
    expect(cookies).toContain('__Secure-next-auth.session-token=;');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('SameSite=lax');
  });

  it('limpa cookies mesmo quando já não existe sessão', async () => {
    const response = await POST(request('next-auth.session-token=stale'));

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('next-auth.session-token=;');
  });

  it('rejeita logout CSRF sem tocar na sessão', async () => {
    const response = await POST(new NextRequest('http://localhost:3000/api/auth/logout', { method: 'POST' }));

    expect(response.status).toBe(403);
  });
});
