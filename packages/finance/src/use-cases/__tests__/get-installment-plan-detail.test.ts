import { describe, it, expect, vi } from 'vitest';
import { getInstallmentPlanDetail } from '../get-installment-plan-detail';

// ---------------------------------------------------------------------------
// Mock Prisma via DI
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    installmentPlan: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    standaloneInstallmentPlan: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    charge: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    responsavel: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    aluno: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeAcademicPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ip_1',
    contaId: 'ct_1',
    externalReference: 'alusa:installment:ip_1:sub_1',
    status: 'ACTIVE',
    installmentCount: 4,
    billingType: 'BOLETO',
    value: 250,
    firstDueDate: new Date('2025-01-15'),
    createdAt: new Date('2025-01-01'),
    contratoId: 'ctr_1',
    matriculaId: 'mat_1',
    matricula: {
      id: 'mat_1',
      aluno: { nome: 'João Silva', email: 'joao@test.com', telefone: '11999999999' },
      responsavelFinanceiro: { nome: 'Ana Silva', email: 'ana@test.com', telefone: '11888888888' },
    },
    ...overrides,
  };
}

function makeStandalonePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sip_1',
    contaId: 'ct_1',
    status: 'ACTIVE',
    installmentCount: 3,
    billingType: 'PIX',
    value: 900,
    firstDueDate: new Date('2025-02-15'),
    createdAt: new Date('2025-02-01'),
    asaasInstallmentId: null,
    customer: { payerType: 'RESPONSAVEL', payerId: 'resp_1' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getInstallmentPlanDetail', () => {
  it('retorna null quando plano não existe', async () => {
    const db = createMockDb();
    const result = await getInstallmentPlanDetail({ planId: 'nope', contaId: 'ct_1' }, db);
    expect(result).toBeNull();
  });

  it('retorna detalhe acadêmico com parcelas reais', async () => {
    const db = createMockDb();
    db.installmentPlan.findFirst.mockResolvedValue(makeAcademicPlan());
    db.charge.findMany.mockResolvedValue([
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:1',
        cobranca: {
          id: 'cob_1',
          valor: 250,
          vencimento: new Date('2025-01-15'),
          status: 'PAGO',
          dataPagamento: new Date('2025-01-14'),
          asaasPaymentId: 'pay_abc',
        },
      },
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:2',
        cobranca: {
          id: 'cob_2',
          valor: 250,
          vencimento: new Date('2025-02-15'),
          status: 'PENDENTE',
          dataPagamento: null,
          asaasPaymentId: null,
        },
      },
    ]);

    const result = await getInstallmentPlanDetail({ planId: 'ip_1', contaId: 'ct_1' }, db);

    expect(result).not.toBeNull();
    expect(result!.origin).toBe('ACADEMIC');
    expect(result!.cliente).toBe('João Silva');
    expect(result!.clienteEmail).toBe('joao@test.com');
    expect(result!.numeroParcelas).toBe(4);
    expect(result!.parcelasPagas).toBe(1);
    expect(result!.parcelas).toHaveLength(2);
    expect(result!.parcelas[0].status).toBe('PAGO');
    expect(result!.parcelas[0].dataPagamento).toBeTruthy();
    expect(result!.parcelas[0].invoiceUrl).toContain('abc');
    expect(result!.parcelas[1].status).toBe('PENDENTE');
    expect(result!.matriculaId).toBe('mat_1');
    expect(result!.contratoId).toBe('ctr_1');
  });

  it('gera parcelas virtuais quando não há charges reais (acadêmico)', async () => {
    const db = createMockDb();
    db.installmentPlan.findFirst.mockResolvedValue(makeAcademicPlan({ installmentCount: 3 }));
    // charge.findMany retorna [] (default)

    const result = await getInstallmentPlanDetail({ planId: 'ip_1', contaId: 'ct_1' }, db);

    expect(result).not.toBeNull();
    expect(result!.parcelas).toHaveLength(3);
    expect(result!.parcelas[0].id).toMatch(/^virtual-/);
    expect(result!.parcelas[0].valor).toBe(250);
  });

  it('retorna detalhe standalone com parcelas reais', async () => {
    const db = createMockDb();
    // installmentPlan.findFirst retorna null (fallback para standalone)
    db.standaloneInstallmentPlan.findFirst.mockResolvedValue(makeStandalonePlan());
    db.charge.findMany.mockResolvedValue([
      { id: 'ch_1', payerName: 'Keison Alencar', value: 300, dueDate: new Date('2025-02-15'), status: 'PAID', invoiceUrl: 'https://pay.example/1' },
      { id: 'ch_2', payerName: 'Keison Alencar', value: 300, dueDate: new Date('2025-03-15'), status: 'OPEN', invoiceUrl: null },
      { id: 'ch_3', payerName: 'Keison Alencar', value: 300, dueDate: new Date('2026-04-15'), status: 'CREATED', invoiceUrl: null },
    ]);
    db.responsavel.findFirst.mockResolvedValue({
      nome: 'Carlos Lima',
      email: 'carlos@test.com',
      telefone: '11777777777',
    });

    const result = await getInstallmentPlanDetail({ planId: 'sip_1', contaId: 'ct_1' }, db);

    expect(result).not.toBeNull();
    expect(result!.origin).toBe('STANDALONE');
    expect(result!.cliente).toBe('Keison Alencar');
    expect(result!.clienteEmail).toBe('carlos@test.com');
    expect(result!.valorTotal).toBe(900);
    expect(result!.parcelasPagas).toBe(1);
    expect(result!.parcelas).toHaveLength(3);
    expect(result!.parcelas[0].status).toBe('PAGO');
    expect(result!.parcelas[1].status).toBe('PENDENTE');
    expect(result!.parcelas[2].status).toBe('PENDENTE');
    expect(result!.matriculaId).toBeNull();
  });

  it('gera parcelas virtuais quando não há charges reais (standalone)', async () => {
    const db = createMockDb();
    db.standaloneInstallmentPlan.findFirst.mockResolvedValue(
      makeStandalonePlan({ installmentCount: 4, value: 1200 }),
    );
    db.responsavel.findFirst.mockResolvedValue({ nome: 'Carlos' });

    const result = await getInstallmentPlanDetail({ planId: 'sip_1', contaId: 'ct_1' }, db);

    expect(result).not.toBeNull();
    expect(result!.parcelas).toHaveLength(4);
    expect(result!.parcelas[0].id).toMatch(/^virtual-/);
    expect(result!.parcelas[0].valor).toBe(300); // 1200 / 4
  });

  it('deriva statusConsolidado ATRASADO', async () => {
    const db = createMockDb();
    db.installmentPlan.findFirst.mockResolvedValue(makeAcademicPlan());
    db.charge.findMany.mockResolvedValue([
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:1',
        cobranca: {
          id: 'cob_1', valor: 250,
          vencimento: new Date('2024-01-15'), // passado
          status: 'PENDENTE',
          dataPagamento: null,
          asaasPaymentId: null,
        },
      },
    ]);

    const result = await getInstallmentPlanDetail({ planId: 'ip_1', contaId: 'ct_1' }, db);

    expect(result!.status).toBe('ATRASADO');
  });

  it('deriva statusConsolidado QUITADO quando tudo pago', async () => {
    const db = createMockDb();
    db.installmentPlan.findFirst.mockResolvedValue(
      makeAcademicPlan({ status: 'COMPLETED', installmentCount: 2 }),
    );
    db.charge.findMany.mockResolvedValue([
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:1',
        cobranca: { id: 'c1', valor: 250, vencimento: new Date('2025-01-15'), status: 'PAGO', dataPagamento: new Date(), asaasPaymentId: null },
      },
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:2',
        cobranca: { id: 'c2', valor: 250, vencimento: new Date('2025-02-15'), status: 'PAGO', dataPagamento: new Date(), asaasPaymentId: null },
      },
    ]);

    const result = await getInstallmentPlanDetail({ planId: 'ip_1', contaId: 'ct_1' }, db);

    expect(result!.status).toBe('QUITADO');
    expect(result!.parcelasPagas).toBe(2);
  });

  it('deriva statusConsolidado CANCELADO', async () => {
    const db = createMockDb();
    db.installmentPlan.findFirst.mockResolvedValue(
      makeAcademicPlan({ status: 'CANCELED' }),
    );

    const result = await getInstallmentPlanDetail({ planId: 'ip_1', contaId: 'ct_1' }, db);

    expect(result!.status).toBe('CANCELADO');
  });

  it('usa nome do aluno quando não tem responsável financeiro', async () => {
    const db = createMockDb();
    db.installmentPlan.findFirst.mockResolvedValue(
      makeAcademicPlan({
        matricula: {
          id: 'mat_1',
          aluno: { nome: 'Pedro Santos', email: 'pedro@test.com', telefone: null },
          responsavelFinanceiro: null,
        },
      }),
    );

    const result = await getInstallmentPlanDetail({ planId: 'ip_1', contaId: 'ct_1' }, db);

    expect(result!.cliente).toBe('Pedro Santos');
    expect(result!.clienteEmail).toBe('pedro@test.com');
  });

  it('resolve aluno como pagador em standalone', async () => {
    const db = createMockDb();
    db.standaloneInstallmentPlan.findFirst.mockResolvedValue(
      makeStandalonePlan({ customer: { payerType: 'ALUNO', payerId: 'alu_1' } }),
    );
    db.aluno.findFirst.mockResolvedValue({
      nome: 'Maria Souza',
      email: 'maria@test.com',
      telefone: null,
    });

    const result = await getInstallmentPlanDetail({ planId: 'sip_1', contaId: 'ct_1' }, db);

    expect(result!.cliente).toBe('Maria Souza');
    expect(result!.clienteEmail).toBe('maria@test.com');
  });

  it('valor acadêmico é por parcela, total = soma das cobranças', async () => {
    const db = createMockDb();
    db.installmentPlan.findFirst.mockResolvedValue(
      makeAcademicPlan({ value: 200, installmentCount: 3 }),
    );
    db.charge.findMany.mockResolvedValue([
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:1',
        cobranca: { id: 'c1', valor: 200, vencimento: new Date('2025-01-15'), status: 'PAGO', dataPagamento: new Date(), asaasPaymentId: null },
      },
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:2',
        cobranca: { id: 'c2', valor: 200, vencimento: new Date('2025-02-15'), status: 'PENDENTE', dataPagamento: null, asaasPaymentId: null },
      },
    ]);

    const result = await getInstallmentPlanDetail({ planId: 'ip_1', contaId: 'ct_1' }, db);

    // valorTotal = soma das cobranças reais (não installmentCount * value)
    expect(result!.valorTotal).toBe(400);
  });
});
