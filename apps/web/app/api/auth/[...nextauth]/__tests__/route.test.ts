import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authRateLimitAsyncMock, nextAuthHandlerMock } = vi.hoisted(() => ({
  authRateLimitAsyncMock: vi.fn(),
  nextAuthHandlerMock: vi.fn(),
}));

vi.mock('next-auth', () => ({ default: vi.fn(() => nextAuthHandlerMock) }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/lib/rate-limit', () => ({
  authRateLimitAsync: authRateLimitAsyncMock,
  ipFromRequest: vi.fn(),
  rateLimitSubject: vi.fn(),
}));

import { POST } from '@/app/api/auth/[...nextauth]/route';

describe('NextAuth route protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextAuthHandlerMock.mockResolvedValue(new Response(JSON.stringify({ url: '/' }), { status: 200 }));
  });

  it('nunca aplica rate limit ao signout e expira fragmentos residuais', async () => {
    const response = await POST(new NextRequest('http://localhost:3000/api/auth/signout', {
      method: 'POST',
      headers: { cookie: 'next-auth.session-token.0=part0; next-auth.session-token.1=part1' },
    }));

    expect(response.status).toBe(200);
    expect(authRateLimitAsyncMock).not.toHaveBeenCalled();
    expect(nextAuthHandlerMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get('set-cookie')).toContain('next-auth.session-token.0=;');
    expect(response.headers.get('set-cookie')).toContain('next-auth.session-token.1=;');
  });
});
