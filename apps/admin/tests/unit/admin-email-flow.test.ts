import { afterEach, describe, expect, it, vi } from 'vitest';

describe('sendInviteEmail', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('loga somente categoria e contagem no fallback local', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RESEND_API_KEY', '');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { sendInviteEmail } = await import('@/lib/admin-email-flow');
    const sensitiveEmail = 'person@example.com';
    const sensitiveInviteId = 'invite-sensitive-id';
    const sensitiveInviteUrl = 'https://admin.alusa.app/invite?token=secret-token';

    await expect(sendInviteEmail({
      inviteId: sensitiveInviteId,
      inviteUrl: sensitiveInviteUrl,
      email: sensitiveEmail,
      role: 'ADMIN',
      expiresAt: new Date('2026-10-10T00:00:00.000Z'),
    })).resolves.toEqual({ delivery: 'logged', emailId: null });

    expect(info).toHaveBeenCalledTimes(1);
    const line = info.mock.calls[0]?.[0];
    expect(typeof line).toBe('string');
    const event = JSON.parse(line as string) as { 'event.name': string; attributes: Record<string, unknown> };
    expect(event['event.name']).toBe('admin.email.invite.fallback');
    expect(event.attributes).toEqual({ category: 'invite_user', deliveryCount: 1 });
    expect(line).not.toContain(sensitiveEmail);
    expect(line).not.toContain(sensitiveInviteId);
    expect(line).not.toContain(sensitiveInviteUrl);
  });
});
