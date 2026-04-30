/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { POST as loginPost } from '@/app/api/global-admin/auth/login/route';
import { POST as logoutPost } from '@/app/api/global-admin/auth/logout/route';

describe('global admin auth api', () => {
  beforeEach(() => {
    process.env.GLOBAL_ADMIN_USERNAME = 'test-admin';
    process.env.GLOBAL_ADMIN_PASSWORD = 'test-password';
    process.env.GLOBAL_ADMIN_SESSION_SECRET = 'test-session-secret';
  });

  it('autentica com sucesso e define cookie exclusivo', async () => {
    const req = new Request('http://localhost/api/global-admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify({ username: 'test-admin', password: 'test-password' }),
    });

    const res = await loginPost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, user: { username: 'test-admin' } });
    expect(res.headers.get('set-cookie')).toContain('alusa.global_admin.session=');
  });

  it('rejeita credenciais inválidas', async () => {
    const req = new Request('http://localhost/api/global-admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '127.0.0.2' },
      body: JSON.stringify({ username: 'test-admin', password: 'wrong-password' }),
    });

    const res = await loginPost(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toMatchObject({ success: false, error: 'Credenciais inválidas' });
  });

  it('limpa a sessão no logout', async () => {
    const res = await logoutPost();

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('alusa.global_admin.session=');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
