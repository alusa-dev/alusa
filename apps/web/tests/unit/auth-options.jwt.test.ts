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
