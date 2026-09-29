import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  sync: vi.fn(),
  audit: vi.fn(),
  log: vi.fn(),
  prior: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({
  syncCustomerNotificationsForUserSelection: mocks.sync,
  recordNotificationSyncAudit: mocks.audit,
  channelPreferencesFromWizardSelection: (channels: string[]) => ({
    email: channels.includes('EMAIL'), sms: channels.includes('SMS'), whatsapp: channels.includes('WHATSAPP'),
  }),
}));
vi.mock('@/src/prisma', () => ({ prisma: { matriculaLog: { create: mocks.log, findFirst: mocks.prior } } }));
vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: vi.fn(async (_contaId: string, callback: (tx: unknown) => unknown) =>
    callback({ matriculaLog: { create: mocks.log, findFirst: mocks.prior } })),
}));
vi.mock('./financial-context.service', () => ({ resolveMatriculaFinancialContext: mocks.resolve }));
import { syncEnrollmentNotifications, type EnrollmentNotificationInput } from './enrollment-notifications.service';

const input: EnrollmentNotificationInput = {
  contaId: 'conta-a', matriculaId: 'matricula-a', actorId: 'user-a', correlationId: 'attempt-a',
  configured: true, channels: ['EMAIL', 'WHATSAPP'],
};
const applied = { email: true, sms: false, whatsapp: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prior.mockResolvedValue(null);
  mocks.resolve.mockResolvedValue({ customerId: 'customer-a' });
  mocks.sync.mockResolvedValue({ success: true, applied, warnings: [] });
  mocks.log.mockResolvedValue({});
  mocks.audit.mockResolvedValue({});
});

describe('enrollment notification selection', () => {
  it('preserves existing settings for an untouched selection', async () => {
    expect(await syncEnrollmentNotifications({ ...input, configured: false })).toBeNull();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('resolves the customer in the authenticated tenant and applies the selection', async () => {
    expect(await syncEnrollmentNotifications(input)).toEqual({ success: true, applied, warnings: [] });
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', matriculaId: 'matricula-a' }));
    expect(mocks.sync).toHaveBeenCalledWith('conta-a', 'customer-a', applied);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'attempt-a', status: 'SUCCESS' }));
  });

  it('does not overwrite later preferences when a confirmed creation is replayed', async () => {
    mocks.prior.mockResolvedValue({ id: 'log-previous' });
    expect(await syncEnrollmentNotifications(input)).toBeNull();
    expect(mocks.prior).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ matriculaId: 'matricula-a', matricula: { contaId: 'conta-a' } }),
    }));
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('applies explicit all-channel opt-out' , async () => {
    await syncEnrollmentNotifications({ ...input, channels: [] });
    expect(mocks.sync).toHaveBeenCalledWith('conta-a', 'customer-a', { email: false, sms: false, whatsapp: false });
  });

  it('does not sync or write logs for another tenant enrollment', async () => {
    mocks.resolve.mockResolvedValue(null);
    const result = await syncEnrollmentNotifications({ ...input, contaId: 'conta-b' });
    expect(result?.success).toBe(false);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('reports a recoverable warning without throwing or exposing provider errors', async () => {
    mocks.sync.mockRejectedValue(new Error('secret-provider-token'));
    const result = await syncEnrollmentNotifications(input);
    expect(result?.success).toBe(false);
    expect(result?.warnings[0]?.message).toContain('sem recriar');
    expect(JSON.stringify(result)).not.toContain('secret-provider-token');
    expect(mocks.log).toHaveBeenCalled();
  });

  it('preserves partial warnings from the existing integration', async () => {
    const warning = { notificationId: 'n1', event: 'PAYMENT_CREATED', channel: 'whatsapp', code: 'UNSUPPORTED', message: 'Canal indisponível' };
    mocks.sync.mockResolvedValue({ success: true, applied, warnings: [warning] });
    expect((await syncEnrollmentNotifications(input))?.warnings).toEqual([warning]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ status: 'PARTIAL' }));
  });

  it('supplies an actionable warning when provider returns failure without detail', async () => {
    mocks.sync.mockResolvedValue({ success: false, applied, warnings: [] });
    expect((await syncEnrollmentNotifications(input))?.warnings).toHaveLength(1);
  });

  it('does not fail a confirmed enrollment when audit storage fails', async () => {
    mocks.log.mockRejectedValue(new Error('storage unavailable'));
    expect((await syncEnrollmentNotifications(input))?.success).toBe(true);
  });
});
