import { afterEach, describe, expect, it, vi } from 'vitest';

describe('sendTransactionalEmail', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('usa fallback determinístico no E2E production-like sem enviar e-mail real', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYWRIGHT_TEST', 'true');
    vi.stubEnv('RESEND_API_KEY', '');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { sendTransactionalEmail } = await import('@/lib/email/transactional-email');

    await expect(sendTransactionalEmail({
      to: 'e2e@example.com',
      category: 'verify_email',
      idempotencyKey: 'e2e-email-1',
      subject: 'Teste',
    })).resolves.toEqual({ delivery: 'logged', emailId: null });

    expect(info).toHaveBeenCalledWith('[EMAIL][DEV_FALLBACK]');
  });

  it('não permite fallback silencioso em produção real', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYWRIGHT_TEST', 'false');
    vi.stubEnv('RESEND_API_KEY', '');
    const { sendTransactionalEmail } = await import('@/lib/email/transactional-email');

    await expect(sendTransactionalEmail({
      to: 'production@example.com',
      category: 'verify_email',
      idempotencyKey: 'production-email-1',
      subject: 'Teste',
    })).rejects.toThrow('RESEND_API_KEY ausente em produção.');
  });
});
