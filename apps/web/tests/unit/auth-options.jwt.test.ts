import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSessionAccessMock = vi.fn();

vi.mock('@/lib/auth-service', () => ({
  verifyCredentialsDetailed: vi.fn(),
  resolveSessionAccess: resolveSessionAccessMock,
}));

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret';

describe('authOptions callbacks.jwt', () => {
  beforeEach(() => {
    resolveSessionAccessMock.mockReset();
    resolveSessionAccessMock.mockResolvedValue({ ok: true });
  });

  it('atualiza emailVerified quando o update vem em session.user', async () => {
    const { authOptions } = await import('@/lib/auth-options');

    const result = await authOptions.callbacks!.jwt!({
      token: { emailVerified: false },
      trigger: 'update',
      session: { user: { emailVerified: true } },
    } as never);

    expect((result as { emailVerified?: boolean }).emailVerified).toBe(true);
  });

  it('atualiza emailVerified quando o update vem na raiz da session', async () => {
    const { authOptions } = await import('@/lib/auth-options');

    const result = await authOptions.callbacks!.jwt!({
      token: { emailVerified: false },
      trigger: 'update',
      session: { emailVerified: true },
    } as never);

    expect((result as { emailVerified?: boolean }).emailVerified).toBe(true);
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
});
