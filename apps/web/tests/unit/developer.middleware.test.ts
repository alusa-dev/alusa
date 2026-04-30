/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(),
}));

import middleware from '@/middleware';
import { createGlobalAdminSessionToken } from '@/features/global-admin/auth/session';

describe('developer middleware', () => {
  beforeEach(() => {
    process.env.GLOBAL_ADMIN_SESSION_SECRET = 'global-admin-secret-123456789';
  });

  it('redireciona /developer sem sessão para /developer/login', async () => {
    const req = new NextRequest('http://localhost:3000/developer');
    const res = await middleware(req);

    expect(res.headers.get('location')).toContain('/developer/login');
  });

  it('redireciona /developer para /developer/dashboard com sessão válida', async () => {
    const token = await createGlobalAdminSessionToken('alusa');
    const req = new NextRequest('http://localhost:3000/developer', {
      headers: { cookie: `alusa.global_admin.session=${token}` },
    });

    const res = await middleware(req);
    expect(res.headers.get('location')).toBe('http://localhost:3000/developer/dashboard');
  });

  it('permite /developer/login sem sessão', async () => {
    const req = new NextRequest('http://localhost:3000/developer/login');
    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
  });
});
