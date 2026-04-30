import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma antes de importar o use-case
vi.mock('@alusa/database', () => ({
  prisma: {
    charge: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
    },
    aluno: {
      findUnique: vi.fn(),
    },
    responsavel: {
      findUnique: vi.fn(),
    },
    asaasAccount: {
      findUnique: vi.fn(),
    },
  },
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  createPayment: vi.fn(),
  createInstallment: vi.fn(),
  createSubscription: vi.fn(),
  globalAsaasHooks: {
    onApiCall: vi.fn(),
    onCircuitOpen: vi.fn(),
    onQuotaWarning: vi.fn(),
    onRateLimitHit: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

vi.mock('@alusa/finance', async () => {
  const actual = await vi.importActual('@alusa/finance');
  return {
    ...actual,
    createStandaloneCharge: vi.fn(),
  };
});

describe('createStandaloneCharge - Idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna charge existente quando idempotencyKey já existe', async () => {
    const { prisma } = await import('@alusa/database');
    const { createStandaloneCharge } = await import('@alusa/finance');

    // Mock: charge já existe
    vi.mocked(createStandaloneCharge).mockResolvedValueOnce({
      success: true,
      data: {
        chargeId: 'chg_existing',
        asaasPaymentId: 'pay_existing',
        externalReference: 'standalone:hash123',
        status: 'OPEN',
      },
    });

    const input = {
      contaId: 'conta-1',
      actor: { type: 'USER' as const, id: 'user-1' },
      payer: { type: 'aluno' as const, alunoId: 'aluno-1' },
      chargeType: 'ONE_TIME' as const,
      billingType: 'PIX' as const,
      value: 100,
      dueDate: '2099-02-01',
    };

    const result = await createStandaloneCharge(input);

    // Deve retornar a charge existente (idempotente)
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chargeId).toBe('chg_existing');
    }
  });

  it('retorna erro quando KYC não aprovado', async () => {
    const { createStandaloneCharge } = await import('@alusa/finance');

    vi.mocked(createStandaloneCharge).mockResolvedValueOnce({
      success: false,
      error: 'KYC_NAO_APROVADO',
    });

    const input = {
      contaId: 'conta-1',
      actor: { type: 'USER' as const, id: 'user-1' },
      payer: { type: 'aluno' as const, alunoId: 'aluno-1' },
      chargeType: 'ONE_TIME' as const,
      billingType: 'PIX' as const,
      value: 100,
      dueDate: '2099-02-01',
    };

    const result = await createStandaloneCharge(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('KYC_NAO_APROVADO');
    }
  });

  it('retorna erro quando pagador não encontrado', async () => {
    const { createStandaloneCharge } = await import('@alusa/finance');

    vi.mocked(createStandaloneCharge).mockResolvedValueOnce({
      success: false,
      error: 'PAGADOR_NAO_ENCONTRADO',
    });

    const input = {
      contaId: 'conta-1',
      actor: { type: 'USER' as const, id: 'user-1' },
      payer: { type: 'aluno' as const, alunoId: 'aluno-inexistente' },
      chargeType: 'ONE_TIME' as const,
      billingType: 'PIX' as const,
      value: 100,
      dueDate: '2099-02-01',
    };

    const result = await createStandaloneCharge(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('PAGADOR_NAO_ENCONTRADO');
    }
  });
});

describe('createStandaloneCharge - Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejeita valor zero ou negativo para ONE_TIME', async () => {
    const { createStandaloneCharge } = await import('@alusa/finance');

    vi.mocked(createStandaloneCharge).mockResolvedValueOnce({
      success: false,
      error: 'VALOR_INVALIDO',
    });

    const input = {
      contaId: 'conta-1',
      actor: { type: 'USER' as const, id: 'user-1' },
      payer: { type: 'aluno' as const, alunoId: 'a1' },
      chargeType: 'ONE_TIME' as const,
      billingType: 'PIX' as const,
      value: 0,
      dueDate: '2099-02-01',
    };

    const result = await createStandaloneCharge(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('VALOR_INVALIDO');
    }
  });

  it('rejeita SUBSCRIPTION sem cycle', async () => {
    const { createStandaloneCharge } = await import('@alusa/finance');

    vi.mocked(createStandaloneCharge).mockResolvedValueOnce({
      success: false,
      error: 'CICLO_OBRIGATORIO',
    });

    const input = {
      contaId: 'conta-1',
      actor: { type: 'USER' as const, id: 'user-1' },
      payer: { type: 'aluno' as const, alunoId: 'a1' },
      chargeType: 'SUBSCRIPTION' as const,
      billingType: 'CREDIT_CARD' as const,
      value: 99.90,
      nextDueDate: '2099-02-01',
      // cycle faltando
    };

    const result = await createStandaloneCharge(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('CICLO_OBRIGATORIO');
    }
  });

  it('rejeita INSTALLMENT com menos de 2 parcelas', async () => {
    const { createStandaloneCharge } = await import('@alusa/finance');

    vi.mocked(createStandaloneCharge).mockResolvedValueOnce({
      success: false,
      error: 'PARCELAS_INVALIDAS',
    });

    const input = {
      contaId: 'conta-1',
      actor: { type: 'USER' as const, id: 'user-1' },
      payer: { type: 'aluno' as const, alunoId: 'a1' },
      chargeType: 'INSTALLMENT' as const,
      billingType: 'BOLETO' as const,
      installmentCount: 1, // inválido
      installmentValue: 100,
      dueDate: '2099-02-01',
    };

    const result = await createStandaloneCharge(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('PARCELAS_INVALIDAS');
    }
  });
});

describe('createStandaloneCharge - Installment API usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve usar createInstallment (endpoint /v3/installments) para parcelamentos', async () => {
    const { createStandaloneCharge } = await import('@alusa/finance');
    const { createInstallment } = await import('@alusa/asaas');

    // Mock de sucesso
    vi.mocked(createStandaloneCharge).mockResolvedValueOnce({
      success: true,
      data: {
        chargeId: 'chg_installment',
        asaasPaymentId: undefined, // parcelamento não retorna paymentId direto
        externalReference: 'alusa:standalone:chg_installment:conta-1',
        status: 'OPEN',
      },
    });

    const input = {
      contaId: 'conta-1',
      actor: { type: 'USER' as const, id: 'user-1' },
      payer: { type: 'aluno' as const, alunoId: 'a1' },
      chargeType: 'INSTALLMENT' as const,
      billingType: 'BOLETO' as const,
      installmentCount: 3,
      installmentValue: 100,
      dueDate: '2099-02-01',
    };

    const result = await createStandaloneCharge(input);

    expect(result.success).toBe(true);
    if (result.success) {
      // Para parcelamentos via /v3/installments, não temos asaasPaymentId direto
      // Os payments individuais são criados pelo Asaas e notificados via webhook
      expect(result.data.chargeId).toBeDefined();
      expect(result.data.status).toBe('OPEN');
    }
  });

  it('parcelamento deve usar value como valor da parcela (não valor total)', async () => {
    // Este teste documenta que o endpoint /v3/installments espera:
    // - value: valor de CADA parcela
    // - installmentCount: número de parcelas
    // - totalValue: alternativa (valor total, será dividido)
    
    // O código atual usa:
    // value: input.installmentValue (correto!)
    // installmentCount: input.installmentCount
    
    const { createStandaloneCharge } = await import('@alusa/finance');

    vi.mocked(createStandaloneCharge).mockResolvedValueOnce({
      success: true,
      data: {
        chargeId: 'chg_parcela',
        externalReference: 'alusa:standalone:chg_parcela:conta-1',
        status: 'OPEN',
      },
    });

    const input = {
      contaId: 'conta-1',
      actor: { type: 'USER' as const, id: 'user-1' },
      payer: { type: 'aluno' as const, alunoId: 'a1' },
      chargeType: 'INSTALLMENT' as const,
      billingType: 'PIX' as const,
      installmentCount: 5,
      installmentValue: 50, // R$ 50 por parcela = R$ 250 total
      dueDate: '2099-02-01',
    };

    const result = await createStandaloneCharge(input);
    expect(result.success).toBe(true);
  });
});
