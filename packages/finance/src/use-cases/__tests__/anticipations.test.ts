import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    receivableAnticipationSnapshot: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({})),
    },
    cobranca: {
      findMany: vi.fn(async () => []),
    },
    charge: {
      findMany: vi.fn(async () => []),
    },
    installmentPlan: {
      findMany: vi.fn(async () => []),
    },
    standaloneInstallmentPlan: {
      findMany: vi.fn(async () => []),
    },
  },
}));

vi.mock('@alusa/asaas', () => ({
  AsaasHttpError: class AsaasHttpError extends Error {
    constructor(
      message: string,
      public status: number,
      public response?: unknown,
      public responseBody?: unknown,
    ) {
      super(message);
      this.name = 'AsaasHttpError';
    }
  },
  getAnticipationConfiguration: vi.fn(),
  getMyAccountCommercialInfo: vi.fn(),
  listAnticipations: vi.fn(),
  updateAnticipationConfiguration: vi.fn(),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(),
  },
}));

import {
  getReceivableAnticipationConfiguration,
  listReceivableAnticipations,
  updateReceivableAnticipationConfiguration,
} from '../anticipations';

describe('anticipations use-cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expõe inelegibilidade de antecipação automática para conta PF', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    const {
      getAnticipationConfiguration,
      getMyAccountCommercialInfo,
    } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sub_key' } as never);
    vi.mocked(getAnticipationConfiguration).mockResolvedValueOnce({
      creditCardAutomaticEnabled: false,
    } as never);
    vi.mocked(getMyAccountCommercialInfo).mockResolvedValueOnce({ personType: 'FISICA' } as never);

    const result = await getReceivableAnticipationConfiguration({ contaId: 'conta-1' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.creditCardAutomaticEnabled).toBe(false);
      expect(result.data.automaticCreditCardEligible).toBe(false);
      expect(result.data.automaticCreditCardReason).toBe('PERSON_TYPE_MUST_BE_PJ');
      expect(result.data.accountPersonType).toBe('FISICA');
    }
  });

  it('bloqueia ativação de antecipação automática para conta PF antes do PUT no Asaas', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    const {
      getMyAccountCommercialInfo,
      updateAnticipationConfiguration,
    } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sub_key' } as never);
    vi.mocked(getMyAccountCommercialInfo).mockResolvedValueOnce({ personType: 'FISICA' } as never);

    const result = await updateReceivableAnticipationConfiguration({
      contaId: 'conta-1',
      userId: 'user-1',
      creditCardAutomaticEnabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('ANTECIPACAO_AUTOMATICA_EXIGE_PJ');
    }

    expect(updateAnticipationConfiguration).not.toHaveBeenCalled();
  });

  it('lista antecipações a partir do snapshot local recente sem chamar o Asaas', async () => {
    const { loadAsaasCredentials, prisma } = await import('@alusa/database');
    const { listAnticipations } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sub_key' } as never);
    vi.mocked(prisma.receivableAnticipationSnapshot.count).mockResolvedValueOnce(1);
    vi.mocked(prisma.receivableAnticipationSnapshot.findMany).mockResolvedValueOnce([
      {
        asaasAnticipationId: 'ant_1',
        status: 'PENDING',
        paymentId: 'pay_1',
        installmentId: null,
        anticipationDate: new Date('2026-06-20T00:00:00.000Z'),
        dueDate: new Date('2026-07-01T00:00:00.000Z'),
        requestDate: new Date('2026-06-17T00:00:00.000Z'),
        fee: { toString: () => '2.00' },
        anticipationDays: 14,
        netValue: { toString: () => '98.00' },
        totalValue: { toString: () => '100.00' },
        value: { toString: () => '100.00' },
        denialObservation: null,
        fetchedAt: new Date('2026-06-17T12:00:00.000Z'),
      },
    ] as never);

    const result = await listReceivableAnticipations({
      contaId: 'conta-1',
      page: 1,
      pageSize: 20,
    });

    expect(result.success).toBe(true);
    expect(listAnticipations).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.items[0]).toMatchObject({
        id: 'ant_1',
        payment: 'pay_1',
        status: 'PENDING',
        value: 100,
        netValue: 98,
      });
      expect(result.data.summary.pending).toBe(100);
    }
  });
});
