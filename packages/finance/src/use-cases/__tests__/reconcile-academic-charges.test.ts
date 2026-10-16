import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cobrancaFindMany: vi.fn(),
  cobrancaUpdate: vi.fn(),
  matriculaUpdateMany: vi.fn(),
  chargeUpdate: vi.fn(),
  getPayment: vi.fn(),
  isAsaasEnabled: vi.fn(),
  projectByChargeId: vi.fn(),
  projectByCobrancaId: vi.fn(),
  updateFinanceStatus: vi.fn(),
  resolveLiquidacao: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    cobranca: { findMany: mocks.cobrancaFindMany, update: mocks.cobrancaUpdate },
    matricula: { updateMany: mocks.matriculaUpdateMany },
    charge: { update: mocks.chargeUpdate },
  },
}));
vi.mock('../asaas-ops', () => ({ getPayment: mocks.getPayment, isAsaasEnabled: mocks.isAsaasEnabled }));
vi.mock('../read-model/charge-read-model.service', () => ({
  chargeReadModelService: {
    projectChargeReadModelByChargeId: mocks.projectByChargeId,
    projectChargeReadModelByCobrancaId: mocks.projectByCobrancaId,
  },
}));
vi.mock('../guards/finance-status-guard', () => ({ updateFinanceStatusFromPayment: mocks.updateFinanceStatus }));
vi.mock('../foundation/asaas-read-intent', () => ({ recordAsaasReadIntent: vi.fn() }));
vi.mock('../foundation/operational-log', () => ({ logFinanceOperationalEvent: vi.fn() }));
vi.mock('../mappers', () => ({
  canApplyChargeStatusTransition: vi.fn(),
  computeNextChargeStatus: vi.fn(),
  computeNextCobrancaStatus: vi.fn(() => ({ nextStatus: 'PAGO' })),
  mapAsaasStatusToInternal: vi.fn(),
}));
vi.mock('../mappers/asaas-payment-snapshot-status', () => ({
  normalizeAsaasPaymentSnapshotStatus: vi.fn(() => 'CONFIRMED'),
}));
vi.mock('../mappers/liquidacao-from-asaas', () => ({
  resolveLiquidacaoFromAsaasPayment: mocks.resolveLiquidacao,
}));

import { prisma } from '@alusa/database';
import { reconcileAcademicChargesWithAsaas } from '../reconcile-academic-charges';

describe('reconcileAcademicChargesWithAsaas invalid calendar dates', () => {
  let existingCobranca: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAsaasEnabled.mockReturnValue(true);
    existingCobranca = {
      id: 'charge-1',
      matriculaId: 'enrollment-1',
      tipo: 'MENSALIDADE',
      status: 'PENDENTE',
      asaasPaymentId: 'pay-1',
      asaasStatus: 'PENDING',
      vencimento: new Date('2026-01-10T12:00:00.000Z'),
      dataPagamento: null,
      pagoEm: null,
      liquidacaoStatus: 'PENDENTE',
      liquidadoEm: new Date('2026-01-11T12:00:00.000Z'),
      charge: { id: 'standalone-1', status: 'PENDING', asaasPaymentId: 'pay-1' },
    };
    mocks.cobrancaFindMany.mockResolvedValue([existingCobranca]);
    mocks.getPayment.mockResolvedValue({
      status: 'CONFIRMED',
      billingType: 'BOLETO',
      dueDate: '2026-01-10',
      paymentDate: '2026-01-11',
      creditDate: null,
      estimatedCreditDate: null,
      value: 100,
      netValue: 98,
    });
    mocks.resolveLiquidacao.mockReturnValue('DISPONIVEL');
  });

  it.each([
    ['creditDate', { creditDate: '2026-02-30' }, 'asaasCreditDate'],
    ['estimatedCreditDate', { estimatedCreditDate: '2026-02-30T00:00:00.000Z' }, 'asaasEstimatedCreditDate'],
  ])('preserves prior snapshot data when %s is invalid', async (field, invalidDate, dbField) => {
    mocks.getPayment.mockResolvedValueOnce({
      status: 'CONFIRMED',
      billingType: 'BOLETO',
      dueDate: '2026-01-10',
      paymentDate: '2026-01-11',
      creditDate: null,
      estimatedCreditDate: null,
      value: 100,
      netValue: 98,
      ...invalidDate,
    });
    mocks.cobrancaUpdate.mockResolvedValue(existingCobranca);

    const result = await reconcileAcademicChargesWithAsaas({ contaId: 'conta-1' });

    expect(result).toMatchObject({ checked: 1, updated: 1 });
    expect(prisma.cobranca.update).toHaveBeenCalledOnce();
    expect(prisma.charge.update).toHaveBeenCalledOnce();
    const cobrancaUpdate = vi.mocked(prisma.cobranca.update).mock.calls[0]?.[0]?.data;
    const chargeUpdate = vi.mocked(prisma.charge.update).mock.calls[0]?.[0]?.data;
    expect(cobrancaUpdate).not.toHaveProperty(dbField);
    expect(chargeUpdate).not.toHaveProperty(dbField);
    if (field === 'creditDate') {
      expect(cobrancaUpdate).not.toHaveProperty('liquidacaoStatus');
      expect(cobrancaUpdate).not.toHaveProperty('liquidadoEm');
      expect(chargeUpdate).not.toHaveProperty('liquidacaoStatus');
      expect(chargeUpdate).not.toHaveProperty('liquidadoEm');
      expect(mocks.resolveLiquidacao).not.toHaveBeenCalled();
    }
  });
});
