import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  matricula: vi.fn(), contrato: vi.fn(), subscription: vi.fn(), createSubscription: vi.fn(),
}));
vi.mock('@/prisma/client', () => ({ prisma: {
  matricula: { findFirst: mocks.matricula }, contrato: { findFirst: mocks.contrato }, subscription: { findFirst: mocks.subscription },
} }));
vi.mock('@alusa/finance', () => ({ createSubscription: mocks.createSubscription, buildSubscriptionExternalReference: vi.fn() }));
vi.mock('./issue-enrollment-contract.service', () => ({ issueEnrollmentContract: vi.fn() }));
vi.mock('@/src/server/enrollments/subscription-payment-materialization', () => ({ materializeSubscriptionPaymentForCharge: vi.fn() }));

import { getContractCreationContext, syncContractSubscriptionForTenant } from './contract-creation.service';

describe('contract subscription respects enrollment financial terms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contrato.mockResolvedValue(null);
    mocks.subscription.mockResolvedValue(null);
    mocks.createSubscription.mockResolvedValue({ success: true, data: { asaasSubscriptionId: 'sub-1' } });
  });

  it.each(['NORMAL', 'BOLSA_PARCIAL', 'ISENCAO_INTEGRAL'])('keeps %s when issuing a contract without an existing monthly charge', async (condicaoFinanceira) => {
    mocks.matricula.mockResolvedValue({
      id: 'matricula-1', plano: { valor: 150, nome: 'Plano', periodicidade: 'MENSAL' }, combo: null,
      condicaoFinanceira, condicaoPercentual: condicaoFinanceira === 'BOLSA_PARCIAL' ? 50 : null,
      descontos: [], cobrancas: [], billingMode: 'INDIVIDUAL', formaPagamento: 'PIX',
      dataInicio: new Date('2027-01-01'), dataFimContrato: new Date('2027-12-31'), vencimentoDia: 5,
    });
    const context = await getContractCreationContext({ contaId: 'conta-1', matriculaId: 'matricula-1' });
    if (!context) throw new Error('Expected contract context');
    const result = await syncContractSubscriptionForTenant({ contaId: 'conta-1', contratoId: 'contrato-1', actorId: 'user-1', matricula: context.matricula });
    if (condicaoFinanceira === 'ISENCAO_INTEGRAL') {
      expect(result).toBeNull();
      expect(mocks.createSubscription).not.toHaveBeenCalled();
      expect(mocks.subscription).not.toHaveBeenCalled();
    } else {
      expect(mocks.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-1', value: condicaoFinanceira === 'BOLSA_PARCIAL' ? 75 : 150 }));
    }
  });
});
