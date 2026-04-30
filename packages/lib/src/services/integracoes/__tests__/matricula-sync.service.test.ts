import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  resendTaxaMatricula,
  syncMatriculaStatus,
  type ResendTaxaMatriculaResult,
  type SyncMatriculaStatusResult,
} from '../matricula-sync.service';

const {
  inactivateSubscriptionMock,
  reactivateSubscriptionMock,
  deleteSubscriptionMock,
  gerarSegundaViaMock,
  getPaymentMock,
  isAsaasEnabledMock,
  registrarLogFinanceiroMock,
} = vi.hoisted(() => ({
  inactivateSubscriptionMock: vi.fn(async () => ({ id: 'sub_123', status: 'INACTIVE' })),
  reactivateSubscriptionMock: vi.fn(async () => ({ id: 'sub_123', status: 'ACTIVE' })),
  deleteSubscriptionMock: vi.fn(async () => ({ id: 'sub_123', status: 'DELETED' })),
  gerarSegundaViaMock: vi.fn(async () => ({
    success: true,
    message: 'Segunda via gerada',
    data: {
      invoiceUrl: 'https://asaas.test/invoice.pdf',
      bankSlipUrl: 'https://asaas.test/boleto.pdf',
      pixQrCodeUrl: 'data:image/png;base64,abc',
      pixCopyPaste: '000201010212...',
    },
  })),
  getPaymentMock: vi.fn(async () => ({
    id: 'pay_123',
    status: 'RECEIVED',
    invoiceUrl: 'https://asaas.test/invoice.pdf',
    bankSlipUrl: 'https://asaas.test/boleto.pdf',
    pixTransaction: 'pix://qr-code',
  })),
  isAsaasEnabledMock: vi.fn(() => true),
  registrarLogFinanceiroMock: vi.fn(async () => undefined),
}));

vi.mock('../../../asaas', async () => {
  const actual = await vi.importActual<typeof import('../../../asaas')>('../../../asaas');
  return {
    ...actual,
    inactivateSubscription: inactivateSubscriptionMock,
    reactivateSubscription: reactivateSubscriptionMock,
    deleteSubscription: deleteSubscriptionMock,
    getPayment: getPaymentMock,
    isAsaasEnabled: isAsaasEnabledMock,
  };
});

vi.mock('../../../asaas/financeiroService', async () => {
  const actual = await vi.importActual<typeof import('../../../asaas/financeiroService')>(
    '../../../asaas/financeiroService',
  );
  return {
    ...actual,
    gerarSegundaVia: gerarSegundaViaMock,
  };
});

vi.mock('../../../asaas/logFinanceiro', async () => {
  const actual = await vi.importActual<typeof import('../../../asaas/logFinanceiro')>(
    '../../../asaas/logFinanceiro',
  );
  return {
    ...actual,
    registrarLogFinanceiro: registrarLogFinanceiroMock,
  };
});

function createPrismaMock() {
  const tx = {
    matricula: {
      update: vi.fn(async () => ({ id: 'matricula-1', status: 'PAUSADA' })),
    },
    cobranca: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({ id: 'cobranca-1' })),
    },
    matriculaLog: {
      create: vi.fn(async () => ({ id: 'matricula-log-1' })),
    },
    webhookAsaas: {
      create: vi.fn(async () => ({ id: 'log-1' })),
    },
  };

  const root = {
    matricula: {
      findFirst: vi.fn(),
    },
    cobranca: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (_client: typeof tx) => unknown) => fn(tx)),
  };

  return { root, tx };
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

let prismaMock: PrismaMock;

describe('matricula-sync.service', () => {
  beforeEach(() => {
    prismaMock = createPrismaMock();
    inactivateSubscriptionMock.mockClear();
    reactivateSubscriptionMock.mockClear();
    deleteSubscriptionMock.mockClear();
    gerarSegundaViaMock.mockClear();
    getPaymentMock.mockClear();
    isAsaasEnabledMock.mockReturnValue(true);
    registrarLogFinanceiroMock.mockClear();
    process.env.FEATURE_ASAAS = 'true';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.FEATURE_ASAAS;
  });

  describe('syncMatriculaStatus', () => {
    it('pausa matrícula ativa sincronizando com o Asaas', async () => {
      prismaMock.root.matricula.findFirst.mockResolvedValue({
        id: 'matricula-1',
        status: 'ATIVA',
        taxaStatus: 'PENDENTE',
        asaasSubscriptionId: 'sub_123',
        vencimentoDia: 10,
      });

      const result = (await syncMatriculaStatus({
        prisma: prismaMock.root as unknown as PrismaClient,
        matriculaId: 'matricula-1',
        contaId: 'conta-1',
        targetStatus: 'PAUSADA',
        actorId: 'user-1',
      })) as SyncMatriculaStatusResult;

      expect(inactivateSubscriptionMock).toHaveBeenCalledWith('sub_123', { contaId: 'conta-1' });
      expect(prismaMock.tx.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'matricula-1' },
          data: expect.objectContaining({ status: 'PAUSADA' }),
        }),
      );
      expect(result.asaasAction).toBe('SUSPEND');
      expect(result.cobrancasAtualizadas).toBe(0);
      expect(result.paymentSync.updated).toBe(0);
      expect(result.paymentSync.expectedWebhooks).toContain('SUBSCRIPTION_INACTIVATED');
      expect(result.paymentSync.warnings).toContain(
        'Status das cobranças será atualizado automaticamente via webhooks oficiais do Asaas.',
      );
      expect(result.nextDueDate).toBeNull();
      expect(registrarLogFinanceiroMock).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'PAUSAR',
          contaId: 'conta-1',
          usuarioId: 'user-1',
        }),
      );
    });

    it('rejeita cancelamento de matrícula sem assinatura Asaas', async () => {
      prismaMock.root.matricula.findFirst.mockResolvedValue({
        id: 'matricula-1',
        status: 'ATIVA',
        taxaStatus: 'PENDENTE',
        asaasSubscriptionId: null,
        vencimentoDia: 12,
      });

      await expect(
        syncMatriculaStatus({
          prisma: prismaMock.root as unknown as PrismaClient,
          matriculaId: 'matricula-1',
          contaId: 'conta-1',
          targetStatus: 'CANCELADA',
        }),
      ).rejects.toThrow('Esta matrícula não possui assinatura no Asaas');

      expect(inactivateSubscriptionMock).not.toHaveBeenCalled();
      expect(deleteSubscriptionMock).not.toHaveBeenCalled();
    });

    it('impede transição inválida', async () => {
      prismaMock.root.matricula.findFirst.mockResolvedValue({
        id: 'matricula-1',
        status: 'PAUSADA',
        taxaStatus: 'PENDENTE',
        asaasSubscriptionId: 'sub_123',
        vencimentoDia: 8,
      });

      const result = await syncMatriculaStatus({
        prisma: prismaMock.root as unknown as PrismaClient,
        matriculaId: 'matricula-1',
        contaId: 'conta-1',
        targetStatus: 'PAUSADA',
      });

      expect(result.newStatus).toBe('PAUSADA');
      expect(result.paymentSync.warnings).toContain('Status atual já corresponde ao solicitado.');
      expect(inactivateSubscriptionMock).not.toHaveBeenCalled();
    });
  });

  describe('resendTaxaMatricula', () => {
    it('gera segunda via da taxa e registra logs', async () => {
      prismaMock.root.cobranca.findFirst.mockResolvedValue({
        id: 'cobranca-1',
        status: 'PENDENTE',
        tipo: 'TAXA_MATRICULA',
        asaasPaymentId: 'pay_123',
        matriculaId: 'matricula-1',
        matricula: {
          id: 'matricula-1',
          taxaStatus: 'PENDENTE',
        },
      });

      const result = (await resendTaxaMatricula({
        prisma: prismaMock.root as unknown as PrismaClient,
        cobrancaId: 'cobranca-1',
        contaId: 'conta-1',
        actorId: 'user-1',
      })) as ResendTaxaMatriculaResult;

      expect(gerarSegundaViaMock).toHaveBeenCalledWith({
        paymentId: 'pay_123',
        contaId: 'conta-1',
      });
      expect(getPaymentMock).toHaveBeenCalledWith('pay_123', { contaId: 'conta-1' });
      expect(prismaMock.tx.cobranca.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cobranca-1' },
          data: expect.objectContaining({ status: 'PAGO' }),
        }),
      );
      expect(prismaMock.tx.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'matricula-1' },
          data: expect.objectContaining({ taxaStatus: 'PAGO' }),
        }),
      );
      expect(prismaMock.tx.matriculaLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            matriculaId: 'matricula-1',
            action: 'TAXA_REENVIADA',
          }),
        }),
      );
      expect(prismaMock.tx.webhookAsaas.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            evento: 'SYNC_MANUAL_RESEND_PAYMENT',
            contaId: 'conta-1',
          }),
        }),
      );
      expect(registrarLogFinanceiroMock).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'REENVIAR',
          cobrancaId: 'cobranca-1',
          contaId: 'conta-1',
          usuarioId: 'user-1',
        }),
      );
      expect(result.newStatus).toBe('PAGO');
      expect(result.invoiceUrl).toBe('https://asaas.test/invoice.pdf');
      expect(result.bankSlipUrl).toBe('https://asaas.test/boleto.pdf');
      expect(result.pixQrCode).toBe('data:image/png;base64,abc');
      expect(result.pixCopyPaste).toBe('000201010212...');
      expect(result.newTaxaStatus).toBe('PAGO');
    });
  });
});
