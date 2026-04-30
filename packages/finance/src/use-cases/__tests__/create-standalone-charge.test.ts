import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createStandaloneCharge } from '../create-standalone-charge';

// Mock database
vi.mock('@alusa/database', () => {
  const mockPrisma = {
    aluno: {
      findFirst: vi.fn(),
    },
    responsavel: {
      findFirst: vi.fn(),
    },
    matricula: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    cobranca: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    installmentPlan: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
    // $transaction executa o callback passando o próprio prisma como tx
    $transaction: vi.fn(async (fn: (_tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
  };
  return { prisma: mockPrisma, loadAsaasCredentials: vi.fn() };
});

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');
  return {
    ...actual,
    createSubscription: vi.fn(),
    listSubscriptionPayments: vi.fn(),
  };
});

// Mock use-cases
vi.mock('../ensure-customer', () => ({
  ensureCustomer: vi.fn(),
}));

vi.mock('../create-payment', () => ({
  createAsaasPayment: vi.fn(),
}));

vi.mock('../../services/customer-notification.service', () => ({
  syncCustomerNotificationChannels: vi.fn(),
}));

// Mock foundation
vi.mock('../../foundation/kyc-guard', () => ({
  requireKycApproved: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(),
  },
}));

describe('createStandaloneCharge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Resolução de pagador para aluno', () => {
    it('deve retornar erro quando aluno menor não tem responsável financeiro', async () => {
      const { prisma } = await import('@alusa/database');

      // Aluno menor sem responsável
      vi.mocked(prisma.aluno.findFirst).mockResolvedValueOnce({
        id: 'aluno-1',
        dataNasc: new Date('2015-01-01'), // menor de idade
        responsaveis: [], // sem responsável
      } as never);

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'aluno', alunoId: 'aluno-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('RESPONSAVEL_OBRIGATORIO_MENOR');
      }
    });

    it('deve resolver pagador para responsável quando aluno é menor', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');

      // Aluno menor COM responsável
      vi.mocked(prisma.aluno.findFirst).mockResolvedValueOnce({
        id: 'aluno-1',
        nome: 'Keison Alencar',
        dataNasc: new Date('2015-01-01'), // menor de idade
        responsaveis: [{ responsavelId: 'resp-1' }],
      } as never);

      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Vera Lucia',
      } as never);

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);

      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_1', externalReference: 'ref' },
      } as never);

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);

      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_123' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'aluno', alunoId: 'aluno-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(true);

      // Verificar que ensureCustomer foi chamado com RESPONSAVEL
      expect(ensureCustomer).toHaveBeenCalledWith({
        contaId: 'conta-1',
        payer: { type: 'RESPONSAVEL', id: 'resp-1' },
      });

      expect(prisma.charge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payerName: 'Keison Alencar',
          }),
        }),
      );
    });

    it('deve usar o próprio aluno como pagador quando maior de idade', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');

      // Aluno maior de idade
      vi.mocked(prisma.aluno.findFirst)
        .mockResolvedValueOnce({
        id: 'aluno-1',
        dataNasc: new Date('2000-01-01'), // maior de idade
        responsaveis: [],
      } as never)
        .mockResolvedValueOnce({
          nome: 'Aluno 1',
        } as never);

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);

      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_aluno', localCustomerId: 'cust_local_2', externalReference: 'ref' },
      } as never);

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);

      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_123' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'aluno', alunoId: 'aluno-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(true);

      // Verificar que ensureCustomer foi chamado com ALUNO
      expect(ensureCustomer).toHaveBeenCalledWith({
        contaId: 'conta-1',
        payer: { type: 'ALUNO', id: 'aluno-1' },
      });
    });
  });

  describe('Validações de entrada', () => {
    it('deve aceitar billingType UNDEFINED para ONE_TIME sem enfileirar', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_3', externalReference: 'ref' },
      } as never);

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_123' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'UNDEFINED',
        value: 100,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('OPEN');
      }
    });

    it('deve retornar erro quando valor é inválido para ONE_TIME', async () => {
      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 0,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('VALOR_INVALIDO');
      }
    });

    it('deve retornar erro quando falta data de vencimento', async () => {
      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        // dueDate ausente
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('DATA_INVALIDA');
      }
    });

    it('deve retornar erro quando falta ciclo para SUBSCRIPTION', async () => {
      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'SUBSCRIPTION',
        billingType: 'PIX',
        value: 100,
        nextDueDate: '2099-12-01',
        endDate: '2100-12-01',
        // cycle ausente
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('CICLO_OBRIGATORIO');
      }
    });

    it('deve aceitar UNDEFINED para SUBSCRIPTION (segue validação de ciclo)', async () => {
      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'SUBSCRIPTION',
        billingType: 'UNDEFINED',
        value: 120,
        nextDueDate: '2099-12-01',
        endDate: '2100-12-01',
        // cycle ausente
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('CICLO_OBRIGATORIO');
      }
    });
  });

  describe('Notificações (best-effort)', () => {
    it('deve retornar sucesso mesmo com WhatsApp invalid_action', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');
      const { syncCustomerNotificationChannels } = await import('../../services/customer-notification.service');

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_4', externalReference: 'ref' },
      } as never);

      vi.mocked(syncCustomerNotificationChannels).mockResolvedValueOnce({
        success: false,
        applied: { email: true, sms: true, whatsapp: false },
        warnings: [
          {
            notificationId: 'not_1',
            event: 'PAYMENT_CREATED',
            channel: 'whatsapp',
            code: 'invalid_action',
            message: 'Evento não suporta notificação por WhatsApp',
          },
        ],
      });

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_123' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
        notificationChannels: ['EMAIL', 'SMS', 'WHATSAPP'],
        notificationChannelsConfigured: true,
      });

      expect(result.success).toBe(true);
      expect(syncCustomerNotificationChannels).toHaveBeenCalled();
      if (result.success) {
        expect(result.data.notificationSync?.applied.whatsapp).toBe(false);
        expect(result.data.notificationSync?.warnings.length).toBeGreaterThan(0);
      }
    });

    it('deve permitir desabilitar todos os canais quando a configuração foi confirmada', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');
      const { syncCustomerNotificationChannels } = await import('../../services/customer-notification.service');

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_5', externalReference: 'ref' },
      } as never);

      vi.mocked(syncCustomerNotificationChannels).mockResolvedValueOnce({
        success: true,
        applied: { email: false, sms: false, whatsapp: false },
        warnings: [],
      });

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_456' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
        notificationChannels: [],
        notificationChannelsConfigured: true,
      });

      expect(result.success).toBe(true);
      expect(syncCustomerNotificationChannels).toHaveBeenCalledWith('conta-1', 'cust_asaas_123', {
        email: false,
        sms: false,
        whatsapp: false,
      });
    });
  });

  describe('Assinatura manual', () => {
    it('deve criar assinatura mesmo sem delegate standaloneSubscription no runtime', async () => {
      const { prisma, loadAsaasCredentials } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createSubscription, listSubscriptionPayments } = await import('@alusa/asaas');

      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);

      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_4', externalReference: 'ref' },
      } as never);

      vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);
      vi.mocked(createSubscription).mockResolvedValueOnce({
        id: 'sub_asaas_123',
        status: 'ACTIVE',
        deleted: false,
      } as never);

      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([
          {
            id: 'sub_manual_1',
            status: 'ACTIVE',
            asaasSubscriptionId: 'sub_asaas_123',
            externalReference: 'alusa:standalone-subscription:sub_manual_1',
            description: 'Mensalidade manual',
            billingType: 'CREDIT_CARD',
            customerId: 'cust_local_4',
          },
        ] as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'SUBSCRIPTION',
        billingType: 'CREDIT_CARD',
        value: 65.55,
        nextDueDate: '2099-12-01',
        endDate: '2100-12-01',
        cycle: 'MONTHLY',
        description: 'Mensalidade manual',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.asaasSubscriptionId).toBe('sub_asaas_123');
      expect(result.data.status).toBe('ACTIVE');
      expect(result.data.expectedWebhooks).toEqual(['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED']);
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(listSubscriptionPayments).not.toHaveBeenCalled();
      expect(prisma.charge.upsert).not.toHaveBeenCalled();
    });
  });
});
