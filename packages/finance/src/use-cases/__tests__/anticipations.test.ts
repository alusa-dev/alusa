import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {},
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
  updateAnticipationConfiguration: vi.fn(),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(),
  },
}));

import {
  getReceivableAnticipationConfiguration,
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
});