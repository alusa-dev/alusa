/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(),
}));

import middleware from '@/middleware';

describe('developer middleware', () => {
  beforeEach(() => {
    process.env.GLOBAL_ADMIN_SESSION_SECRET = 'global-admin-secret-123456789';
  });

  it('permite /developer sem sessão (central aberta)', async () => {
    const req = new NextRequest('http://localhost:3000/developer');
    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
  });

  it('redireciona /developer/login para /developer', async () => {
    const req = new NextRequest('http://localhost:3000/developer/login');
    const res = await middleware(req);

    expect(res.headers.get('location')).toBe('http://localhost:3000/developer');
  });

  it('redireciona rotas antigas do console para a nova central', async () => {
    const req = new NextRequest('http://localhost:3000/developer/dashboard');
    const res = await middleware(req);
    expect(res.headers.get('location')).toBe('http://localhost:3000/developer');
  });
});
