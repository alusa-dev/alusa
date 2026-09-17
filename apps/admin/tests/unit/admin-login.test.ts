import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateAdminUser = vi.hoisted(() => vi.fn());
const mockCreateAdminSession = vi.hoisted(() => vi.fn());
const mockRecordAdminAudit = vi.hoisted(() => vi.fn());
const mockAuthRateLimitAsync = vi.hoisted(() => vi.fn());
const mockRateLimitSubject = vi.hoisted(() => vi.fn());

vi.mock('@alusa/admin-auth', () => ({
  authenticateAdminUser: mockAuthenticateAdminUser,
  createAdminSession: mockCreateAdminSession,
  supportRoleFromAdminRole: () => 'SUPPORT_ADMIN',
}));

vi.mock('@alusa/lib/security/rate-limit', () => ({
  authRateLimitAsync: mockAuthRateLimitAsync,
  ipFromRequest: () => '127.0.0.1',
  rateLimitSubject: mockRateLimitSubject,
}));

vi.mock('@/lib/admin-session', () => ({
  recordAdminAudit: mockRecordAdminAudit,
}));

vi.mock('@/lib/session', () => ({
  ADMIN_SESSION_COOKIE: 'alusa_admin_session',
}));

import { POST } from '@/app/api/auth/login/route';

function request(body: unknown) {
  return new Request('http://admin.local/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthRateLimitAsync.mockResolvedValue({ ok: true });
    mockRateLimitSubject.mockResolvedValue('subject-hash');
    mockAuthenticateAdminUser.mockResolvedValue({
      id: 'admin-1',
      username: 'operator',
      role: 'ADMIN',
    });
    mockCreateAdminSession.mockResolvedValue({
      token: 'session-token',
      expiresAt: new Date('2026-09-17T00:00:00.000Z'),
    });
    mockRecordAdminAudit.mockResolvedValue({ id: 'audit-1' });
  });

  it('valida o payload, cria sessão e registra auditoria sem Prisma no handler', async () => {
    const response = await POST(request({ username: 'operator', password: 'secret' }));

    expect(response.status).toBe(200);
    expect(mockAuthenticateAdminUser).toHaveBeenCalledWith({ username: 'operator', password: 'secret' });
    expect(mockRecordAdminAudit).toHaveBeenCalledWith({
      actorId: 'admin-1',
      actorUsername: 'operator',
      actorRole: 'SUPPORT_ADMIN',
      action: 'admin.auth.login',
      ip: '127.0.0.1',
      userAgent: 'vitest',
      metadata: { authSource: 'admin_user' },
    });
    expect(response.cookies.get('alusa_admin_session')?.value).toBe('session-token');
  });

  it('rejeita payload inválido antes de autenticar', async () => {
    const response = await POST(request({ username: '', password: '' }));

    expect(response.status).toBe(401);
    expect(mockAuthenticateAdminUser).not.toHaveBeenCalled();
    expect(mockRecordAdminAudit).not.toHaveBeenCalled();
  });
});
