/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServerSessionMock,
  comparePasswordMock,
  hashPasswordMock,
  rateLimitAsyncMock,
  prismaMock,
  auditRecordMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  comparePasswordMock: vi.fn(),
  hashPasswordMock: vi.fn(),
  rateLimitAsyncMock: vi.fn(),
  prismaMock: {
    usuario: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  auditRecordMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/auth-password', () => ({
  comparePassword: comparePasswordMock,
  hashPassword: hashPasswordMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimitAsync: rateLimitAsyncMock,
}));

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

vi.mock('@alusa/finance', () => ({
  auditLogService: { record: auditRecordMock },
}));

const { PATCH } = await import('../route');

function buildRequest(body: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/users/me/password', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      origin,
      'user-agent': 'vitest',
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/users/me/password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    rateLimitAsyncMock.mockResolvedValue({ ok: true, remaining: 9, resetAt: Date.now() });
    prismaMock.usuario.findUnique.mockResolvedValue({
      senhaHash: 'old-hash',
      contaId: 'conta-1',
    });
    prismaMock.usuario.update.mockResolvedValue({ id: 'user-1' });
    comparePasswordMock.mockResolvedValue(true);
    hashPasswordMock.mockResolvedValue('new-hash');
    auditRecordMock.mockResolvedValue(undefined);
  });

  it('rejeita requisição sem sessão', async () => {
    getServerSessionMock.mockResolvedValue(null);

  const response = await PATCH(buildRequest({ currentPassword: 'old', newPassword: 'NewStrong@1234' }));

    expect(response.status).toBe(401);
    expect(rateLimitAsyncMock).not.toHaveBeenCalled();
  });

  it('bloqueia origem diferente da aplicação', async () => {
    const response = await PATCH(buildRequest({ currentPassword: 'old', newPassword: 'NewStrong@1234' }, 'https://attacker.example'));

    expect(response.status).toBe(403);
    expect(getServerSessionMock).not.toHaveBeenCalled();
  });

  it('retorna 429 quando o limite distribuído é atingido', async () => {
    rateLimitAsyncMock.mockResolvedValue({ ok: false, remaining: 0, resetAt: Date.now() });

    const response = await PATCH(buildRequest({ currentPassword: 'old', newPassword: 'NewStrong@1234' }));

    expect(response.status).toBe(429);
    expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled();
  });

  it('não altera a senha quando a senha atual está incorreta e audita a tentativa', async () => {
    comparePasswordMock.mockResolvedValue(false);

    const response = await PATCH(buildRequest({ currentPassword: 'wrong', newPassword: 'NewStrong@1234' }));

    expect(response.status).toBe(403);
    expect(prismaMock.usuario.update).not.toHaveBeenCalled();
    expect(auditRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.password_change_failed',
      metadata: expect.objectContaining({ result: 'invalid_current_password' }),
    }));
  });

  it('altera a senha, atualiza o marcador de sessão e audita o sucesso', async () => {
    const response = await PATCH(buildRequest({ currentPassword: 'old', newPassword: 'NewStrong@1234' }));

    expect(response.status).toBe(200);
    expect(hashPasswordMock).toHaveBeenCalledWith('NewStrong@1234');
    expect(prismaMock.usuario.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        senhaHash: 'new-hash',
        passwordChangedAt: expect.any(Date),
      },
    });
    expect(auditRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.password_changed',
      metadata: expect.objectContaining({ result: 'success', ip: '127.0.0.1' }),
    }));
  });
});
