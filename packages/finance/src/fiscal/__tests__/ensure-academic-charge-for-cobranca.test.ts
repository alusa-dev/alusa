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
      matricula: {
        alunoId: 'aluno-1',
        responsavelFinanceiroId: 'responsavel-1',
      },
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

  it('usa referência única por payment mesmo quando o evento repete a referência pai da assinatura', async () => {
    mocks.cobrancaFindFirst.mockResolvedValue({
      id: 'cobranca-cycle-2', descricao: 'Mensalidade', valor: 120, valorFinal: null,
      vencimento: new Date('2026-07-10'), formaPagamento: 'BOLETO', asaasStatus: 'PENDING',
      matricula: { alunoId: 'aluno-1', responsavelFinanceiroId: null },
    });
    mocks.chargeFindFirst.mockResolvedValue(null);
    mocks.chargeUpsert.mockResolvedValue({ id: 'cobranca-cycle-2' });

    const result = await ensureAcademicChargeForCobranca({
      contaId: 'conta-1', cobrancaId: 'cobranca-cycle-2', asaasPaymentId: 'pay-cycle-2',
      subscriptionExternalReference: 'alusa:subscription:matricula-1:plano-1',
      payment: {
        status: 'PENDING', value: 120, dueDate: '2026-07-10',
        externalReference: 'alusa:subscription:matricula-1:plano-1',
      },
    });

    expect(result).toEqual({ chargeId: 'cobranca-cycle-2', created: true });
    expect(mocks.chargeUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        externalReference: 'alusa:subscription:matricula-1:plano-1:payment:pay-cycle-2',
        asaasPaymentId: 'pay-cycle-2',
      }),
      update: expect.objectContaining({
        externalReference: 'alusa:subscription:matricula-1:plano-1:payment:pay-cycle-2',
        asaasPaymentId: 'pay-cycle-2',
      }),
    }));
  });

  it('não reassocia um payment já mapeado a outra cobrança acadêmica', async () => {
    mocks.cobrancaFindFirst.mockResolvedValue({
      id: 'cobranca-cycle-2', descricao: 'Mensalidade', valor: 120, valorFinal: null,
      vencimento: new Date('2026-07-10'), formaPagamento: 'BOLETO', asaasStatus: 'PENDING',
      matricula: { alunoId: 'aluno-1', responsavelFinanceiroId: null },
    });
    mocks.chargeFindFirst.mockResolvedValueOnce({ id: 'charge-existing', cobrancaId: 'cobranca-cycle-1' });

    const result = await ensureAcademicChargeForCobranca({
      contaId: 'conta-1', cobrancaId: 'cobranca-cycle-2', asaasPaymentId: 'pay-cycle-1',
      subscriptionExternalReference: 'alusa:subscription:matricula-1:plano-1',
    });

    expect(result).toBeNull();
    expect(mocks.chargeUpsert).not.toHaveBeenCalled();
  });

  it('não reabre Charge existente ao materializar snapshot PENDING atrasado', async () => {
    mocks.cobrancaFindFirst.mockResolvedValue({
      id: 'cobranca-paid', descricao: 'Mensalidade', valor: 120, valorFinal: null,
      vencimento: new Date('2026-07-10'), formaPagamento: 'BOLETO', asaasStatus: 'RECEIVED',
      matricula: { alunoId: 'aluno-1', responsavelFinanceiroId: null },
    });
    mocks.chargeFindFirst
      .mockResolvedValueOnce({ id: 'charge-paid', cobrancaId: 'cobranca-paid' })
      .mockResolvedValueOnce({ id: 'charge-paid', cobrancaId: 'cobranca-paid' });
    mocks.chargeUpsert.mockResolvedValue({ id: 'charge-paid' });

    await ensureAcademicChargeForCobranca({
      contaId: 'conta-1', cobrancaId: 'cobranca-paid', asaasPaymentId: 'pay-paid',
      subscriptionExternalReference: 'alusa:subscription:matricula-1:plano-1',
      payment: { status: 'PENDING', value: 120 },
    });

    const update = mocks.chargeUpsert.mock.calls[0]?.[0]?.update;
    expect(update).not.toHaveProperty('status');
    expect(update).not.toHaveProperty('statusUpdatedAt');
  });

  it('semeia Charge como PAID quando Cobranca RECEIVED ainda não tem Charge e chega PAYMENT_CREATED PENDING atrasado', async () => {
    mocks.cobrancaFindFirst.mockResolvedValue({
      id: 'cobranca-paid-without-charge', descricao: 'Mensalidade', valor: 120, valorFinal: null,
      vencimento: new Date('2026-07-10'), formaPagamento: 'BOLETO', asaasStatus: 'RECEIVED',
      matricula: { alunoId: 'aluno-1', responsavelFinanceiroId: null },
    });
    mocks.chargeFindFirst.mockResolvedValue(null);
    mocks.chargeUpsert.mockResolvedValue({ id: 'cobranca-paid-without-charge' });

    await ensureAcademicChargeForCobranca({
      contaId: 'conta-1', cobrancaId: 'cobranca-paid-without-charge', asaasPaymentId: 'pay-created-late',
      subscriptionExternalReference: 'alusa:subscription:matricula-1:plano-1',
      payment: { status: 'PENDING', value: 120 },
    });

    expect(mocks.chargeUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        asaasPaymentId: 'pay-created-late',
        status: 'PAID',
      }),
    }));
  });
});
