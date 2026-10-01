import { afterEach, describe, expect, it, vi } from 'vitest';

describe('sendTransactionalEmail', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('usa fallback determinístico no E2E production-like sem enviar e-mail real', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYWRIGHT_TEST', 'true');
    vi.stubEnv('RESEND_API_KEY', '');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { sendTransactionalEmail } = await import('@/lib/email/transactional-email');

    const sensitiveRecipient = 'e2e-person@example.com';
    const sensitiveSubject = 'Reset with secret token';
    const sensitiveUrl = 'https://alusa.app/reset?token=secret-token-value';
    const sensitiveKey = 'reset-password/secret-idempotency-value';
    await expect(sendTransactionalEmail({
      to: sensitiveRecipient,
      category: 'verify_email',
      idempotencyKey: sensitiveKey,
      subject: sensitiveSubject,
      actionUrl: sensitiveUrl,
      html: 'payload-secret',
    })).resolves.toEqual({ delivery: 'logged', emailId: null });

    expect(info).toHaveBeenCalledTimes(1);
    const line = info.mock.calls[0]?.[0];
    expect(typeof line).toBe('string');
    const event = JSON.parse(line as string) as { 'event.name': string; attributes: Record<string, unknown> };
    expect(event['event.name']).toBe('email.delivery.fallback');
    expect(event.attributes).toEqual({ category: 'verify_email', deliveryCount: 1 });
    expect(line).not.toContain(sensitiveRecipient);
    expect(line).not.toContain(sensitiveSubject);
    expect(line).not.toContain(sensitiveUrl);
    expect(line).not.toContain(sensitiveKey);
    expect(line).not.toContain('payload-secret');
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

  it('propaga falha do provedor em produção em vez de reportar envio como sucesso', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYWRIGHT_TEST', 'false');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: 'provider rejected request' } });
    vi.doMock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send } })) }));
    const { sendTransactionalEmail } = await import('@/lib/email/transactional-email');

    await expect(sendTransactionalEmail({
      to: 'person@example.com',
      category: 'verify_email',
      idempotencyKey: 'verify-email/provider-error',
      subject: 'Confirme seu e-mail',
    })).rejects.toThrow('provider rejected request');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('normaliza tags para o contrato ASCII do Resend antes do envio', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYWRIGHT_TEST', 'true');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const send = vi.fn().mockResolvedValue({ data: { id: 'email_123' }, error: null });
    vi.doMock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send } })) }));
    const { sendTransactionalEmail } = await import('@/lib/email/transactional-email');

    await expect(sendTransactionalEmail({
      to: 'billing@example.com',
      category: 'platform_billing',
      idempotencyKey: 'platform-billing/event-1',
      subject: 'Assinatura atualizada',
      tags: [
        { name: 'event type', value: 'customer.subscription.created' },
        { name: 'conta', value: 'ação-á' },
      ],
    })).resolves.toEqual({ delivery: 'sent', emailId: 'email_123' });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [
          { name: 'event-type', value: 'customer-subscription-created' },
          { name: 'conta', value: 'acao-a' },
        ],
      }),
      { idempotencyKey: 'platform-billing/event-1' },
    );
  });

  it('usa o domínio autenticado da Alusa como remetente padrão de confirmação', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLAYWRIGHT_TEST', 'true');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('EMAIL_FROM_AUTH', '');
    vi.stubEnv('RESEND_FROM', '');
    const send = vi.fn().mockResolvedValue({ data: { id: 'email_verify_123' }, error: null });
    vi.doMock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send } })) }));
    const { sendTransactionalEmail } = await import('@/lib/email/transactional-email');

    await sendTransactionalEmail({
      to: 'person@example.com',
      category: 'verify_email',
      idempotencyKey: 'verify-email/token-123',
      template: { id: 'verify-email-template', variables: { ACTION_URL: 'https://alusa.app/verify' } },
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Alusa <no-reply@alusa.app>' }),
      { idempotencyKey: 'verify-email/token-123' },
    );
  });
});
