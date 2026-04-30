import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  conta: {
    findUnique: vi.fn(),
  },
  asaasNotificationPreference: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('../../../prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('../../../security/encryption', () => ({
  decryptSecret: vi.fn((value: string | null | undefined) => value ?? null),
}));

const {
  ensureAsaasNotificationPreferences,
  saveAsaasNotificationPreferences,
} = await import('../asaas-notifications.service');

function buildPreference(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pref-1',
    contaId: 'conta-1',
    event: 'PAYMENT_CREATED',
    scheduleOffset: 0,
    enabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
    createdAt: new Date('2026-04-17T00:00:00.000Z'),
    updatedAt: new Date('2026-04-17T00:00:00.000Z'),
    ...overrides,
  };
}

describe('asaas-notifications.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) =>
      callback(prismaMock),
    );
    prismaMock.asaasNotificationPreference.deleteMany.mockResolvedValue({ count: 0 });
  });

  it('faz seed idempotente com skipDuplicates e releitura final', async () => {
    prismaMock.asaasNotificationPreference.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildPreference()]);
    prismaMock.asaasNotificationPreference.createMany.mockResolvedValue({ count: 1 });

    const result = await ensureAsaasNotificationPreferences('conta-1');

    expect(prismaMock.asaasNotificationPreference.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            contaId: 'conta-1',
            event: 'PAYMENT_CREATED',
            scheduleOffset: 0,
          }),
        ]),
      }),
    );
    expect(prismaMock.asaasNotificationPreference.findMany).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ contaId: 'conta-1', event: 'PAYMENT_CREATED' }));
  });

  it('normaliza entradas duplicadas antes de salvar', async () => {
    prismaMock.asaasNotificationPreference.findMany.mockResolvedValue([
      buildPreference({
        whatsappEnabledForCustomer: true,
      }),
    ]);
    prismaMock.asaasNotificationPreference.createMany.mockResolvedValue({ count: 1 });

    await saveAsaasNotificationPreferences('conta-1', [
      {
        event: 'PAYMENT_CREATED',
        scheduleOffset: 0,
        enabled: true,
        emailEnabledForCustomer: true,
        smsEnabledForCustomer: false,
        whatsappEnabledForCustomer: false,
      },
      {
        event: 'PAYMENT_CREATED',
        scheduleOffset: 0,
        enabled: true,
        emailEnabledForCustomer: false,
        smsEnabledForCustomer: false,
        whatsappEnabledForCustomer: true,
      },
    ]);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.asaasNotificationPreference.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          contaId: 'conta-1',
          event: 'PAYMENT_CREATED',
          scheduleOffset: 0,
          emailEnabledForCustomer: false,
          smsEnabledForCustomer: false,
          whatsappEnabledForCustomer: true,
        }),
      ],
    });
  });
});
