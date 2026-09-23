import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSessionAccessMock = vi.fn();

vi.mock('@/lib/auth-service', () => ({
  verifyCredentialsDetailed: vi.fn(),
  resolveSessionAccess: resolveSessionAccessMock,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    usuario: { findUnique: vi.fn(async () => null) },
    conta: { findUnique: vi.fn(async () => null) },
  },
}));

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

describe('authOptions callbacks.jwt', () => {
  beforeEach(() => {
    resolveSessionAccessMock.mockReset();
    resolveSessionAccessMock.mockResolvedValue({ ok: true });
  });

  it('não revoga sessões no evento de logout normal', async () => {
    const { authOptions } = await import('@/lib/auth-options');

    expect(authOptions.events?.signOut).toBeUndefined();
  });

  it('ignora tentativa do cliente de promover emailVerified', async () => {
    const { authOptions } = await import('@/lib/auth-options');

    const result = await authOptions.callbacks!.jwt!({
      token: { emailVerified: false },
      trigger: 'update',
      session: { user: { emailVerified: true } },
    } as never);

    expect((result as { emailVerified?: boolean }).emailVerified).toBe(false);
  });

  it('permite trocar a escola ativa somente após validar o vínculo', async () => {
    resolveSessionAccessMock
      .mockResolvedValueOnce({ ok: true, contaId: 'conta_2', role: 'RECEPCAO', emailVerified: true, sessionVersion: 1 })
      .mockResolvedValueOnce({ ok: true, contaId: 'conta_2', role: 'RECEPCAO', emailVerified: true, sessionVersion: 1 });
    const { authOptions } = await import('@/lib/auth-options');

    const result = await authOptions.callbacks!.jwt!({
      token: { id: 'user_1', contaId: 'conta_1', sessionVersion: 1 },
      trigger: 'update',
      session: { contaId: 'conta_2' },
    } as never);

    expect((result as { contaId?: string }).contaId).toBe('conta_2');
    expect((result as { role?: string }).role).toBe('RECEPCAO');
  });

  it('ignora escola sem vínculo sem invalidar a sessão atual', async () => {
    resolveSessionAccessMock
      .mockResolvedValueOnce({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: true, contaId: 'conta_1', role: 'ADMIN', emailVerified: true, sessionVersion: 1 });
    const { authOptions } = await import('@/lib/auth-options');

    const result = await authOptions.callbacks!.jwt!({
      token: { id: 'user_1', contaId: 'conta_1', sessionVersion: 1 },
      trigger: 'update',
      session: { contaId: 'conta_alheia' },
    } as never);

    expect((result as { id?: string }).id).toBe('user_1');
    expect((result as { contaId?: string }).contaId).toBe('conta_1');
  });

  it('remove o acesso da sessão quando a conta está desativada', async () => {
    resolveSessionAccessMock.mockResolvedValueOnce({ ok: false, reason: 'ACCOUNT_DEACTIVATED' });
    const { authOptions } = await import('@/lib/auth-options');

    const result = await authOptions.callbacks!.jwt!({
      token: { id: 'user_1', contaId: 'conta_1', emailVerified: true },
    } as never);

    expect((result as { id?: string }).id).toBeUndefined();
    expect((result as { contaId?: string | null }).contaId).toBeNull();
    expect((result as { accountActive?: boolean }).accountActive).toBe(false);
  });

  it('remove o acesso quando o JWT foi revogado por logout', async () => {
    resolveSessionAccessMock.mockResolvedValueOnce({ ok: false, reason: 'SESSION_REVOKED' });
    const { authOptions } = await import('@/lib/auth-options');

    const result = await authOptions.callbacks!.jwt!({
      token: { id: 'user_1', contaId: 'conta_1', sessionVersion: 2, emailVerified: true },
    } as never);

    expect((result as { id?: string }).id).toBeUndefined();
    expect((result as { contaId?: string | null }).contaId).toBeNull();
    expect((result as { accountActive?: boolean }).accountActive).toBe(false);
  });

  it('remove o acesso quando a revalidação lança erro', async () => {
    resolveSessionAccessMock.mockRejectedValueOnce(new Error('database unavailable'));
    const { authOptions } = await import('@/lib/auth-options');

    const result = await authOptions.callbacks!.jwt!({
      token: { id: 'user_1', contaId: 'conta_1', emailVerified: true, accountActive: true },
    } as never);

    expect((result as { id?: string }).id).toBeUndefined();
    expect((result as { contaId?: string | null }).contaId).toBeNull();
    expect((result as { accountActive?: boolean }).accountActive).toBe(false);
  });
});
