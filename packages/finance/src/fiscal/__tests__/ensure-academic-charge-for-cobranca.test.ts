import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cobrancaFindFirst: vi.fn(),
  chargeFindFirst: vi.fn(),
  chargeUpsert: vi.fn(),
  projectChargeReadModelByCobrancaId: vi.fn(),
}));

vi.mock('../fiscal-prisma', () => ({
  getFiscalPrisma: () => ({
    cobranca: { findFirst: mocks.cobrancaFindFirst },
    charge: {
      findFirst: mocks.chargeFindFirst,
      upsert: mocks.chargeUpsert,
    },
  }),
}));

vi.mock('../read-model/charge-read-model.service', () => ({
  chargeReadModelService: {
    projectChargeReadModelByCobrancaId: mocks.projectChargeReadModelByCobrancaId,
  },
}));

import { ensureAcademicChargeForCobranca } from '../ensure-academic-charge-for-cobranca';

describe('ensureAcademicChargeForCobranca', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectChargeReadModelByCobrancaId.mockResolvedValue(undefined);
  });

  it('materializa Charge para cobrança avulsa com pagamento Asaas', async () => {
    mocks.cobrancaFindFirst.mockResolvedValueOnce({
      id: 'cobranca-1',
      descricao: 'Taxa de matrícula',
      valor: 500,
      valorFinal: null,
      vencimento: new Date('2026-06-10'),
      formaPagamento: 'PIX',
      asaasStatus: 'CONFIRMED',
    });
    mocks.chargeFindFirst.mockResolvedValueOnce(null);
    mocks.chargeUpsert.mockResolvedValueOnce({ id: 'cobranca-1' });

    const result = await ensureAcademicChargeForCobranca({
      contaId: 'conta-1',
      cobrancaId: 'cobranca-1',
      asaasPaymentId: 'pay_123',
      payment: {
        status: 'CONFIRMED',
        value: 500,
        billingType: 'PIX',
      },
    });

    expect(result).toEqual({ chargeId: 'cobranca-1', created: true });
    expect(mocks.chargeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cobrancaId: 'cobranca-1' },
        create: expect.objectContaining({
          id: 'cobranca-1',
          externalReference: 'charge:cobranca-1',
          asaasPaymentId: 'pay_123',
        }),
      }),
    );
  });
});
