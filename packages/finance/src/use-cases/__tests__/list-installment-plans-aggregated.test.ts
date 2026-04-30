import { describe, it, expect, vi } from 'vitest';
import { listInstallmentPlansAggregated } from '../list-installment-plans-aggregated';

// ---------------------------------------------------------------------------
// Mock Prisma via DI
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    installmentPlan: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    standaloneInstallmentPlan: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    charge: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    responsavel: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    aluno: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
    installmentCount: 6,
    billingType: 'BOLETO',
    value: 200, // per-installment
    firstDueDate: new Date('2025-01-15'),
    createdAt: new Date('2025-01-01'),
    contratoId: 'ctr_1',
    matriculaId: 'mat_1',
    asaasInstallmentId: 'asaas_inst_1',
    matricula: {
      id: 'mat_1',
      aluno: { nome: 'João Silva' },
      responsavelFinanceiro: { nome: 'Ana Silva' },
    },
    ...overrides,
  };
}

function makeStandalonePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sip_1',
    contaId: 'ct_1',
    externalReference: 'alusa:standalone:sip_1:sub_1',
    status: 'ACTIVE',
    installmentCount: 3,
    billingType: 'PIX',
    value: 900, // total value
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

describe('listInstallmentPlansAggregated', () => {
  it('retorna lista vazia quando não há planos', async () => {
    const db = createMockDb();
    const result = await listInstallmentPlansAggregated({ contaId: 'ct_1' }, db);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
  });

  it('retorna plano acadêmico com valor total = value * installmentCount', async () => {
    const db = createMockDb();
    db.installmentPlan.findMany.mockResolvedValue([makeAcademicPlan()]);

    const result = await listInstallmentPlansAggregated({ contaId: 'ct_1' }, db);

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.origin).toBe('ACADEMIC');
    expect(item.studentName).toBe('João Silva');
    expect(item.payerName).toBe('Ana Silva');
    expect(item.installmentValue).toBe(200);
    expect(item.totalValue).toBe(1200); // 200 * 6
    expect(item.installmentCount).toBe(6);
    expect(item.status).toBe('ACTIVE');
    expect(item.matriculaId).toBe('mat_1');
  });

  it('retorna plano standalone com valor total direto', async () => {
    const db = createMockDb();
    db.standaloneInstallmentPlan.findMany.mockResolvedValue([makeStandalonePlan()]);
    db.responsavel.findMany.mockResolvedValue([{ id: 'resp_1', nome: 'Carlos Lima' }]);
    db.charge.findMany.mockResolvedValue([
      {
        standaloneInstallmentPlanId: 'sip_1',
        payerName: 'Keison Alencar',
        status: 'OPEN',
        dueDate: new Date('2025-02-15'),
      },
    ]);

    const result = await listInstallmentPlansAggregated({ contaId: 'ct_1' }, db);

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.origin).toBe('STANDALONE');
    expect(item.studentName).toBe('Keison Alencar');
    expect(item.payerName).toBe('Carlos Lima');
    expect(item.totalValue).toBe(900); // valor direto
    expect(item.installmentValue).toBe(300); // 900 / 3
    expect(item.installmentCount).toBe(3);
    expect(item.matriculaId).toBeNull();
  });

  it('deriva statusConsolidado ATRASADO quando há parcela vencida', async () => {
    const db = createMockDb();
    db.installmentPlan.findMany.mockResolvedValue([makeAcademicPlan()]);
    db.charge.findMany.mockResolvedValue([
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:1',
        cobranca: { id: 'cob_1', status: 'ATRASADO', vencimento: new Date('2025-01-15') },
      },
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:2',
        cobranca: { id: 'cob_2', status: 'PENDENTE', vencimento: new Date('2025-07-15') },
      },
    ]);

    const result = await listInstallmentPlansAggregated({ contaId: 'ct_1' }, db);

    expect(result.items[0].statusConsolidado).toBe('ATRASADO');
  });

  it('deriva statusConsolidado QUITADO quando todas as parcelas são pagas', async () => {
    const db = createMockDb();
    db.installmentPlan.findMany.mockResolvedValue([
      makeAcademicPlan({ status: 'COMPLETED', installmentCount: 2 }),
    ]);
    db.charge.findMany.mockResolvedValue([
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:1',
        cobranca: { id: 'cob_1', status: 'PAGO', vencimento: new Date('2025-01-15') },
      },
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:2',
        cobranca: { id: 'cob_2', status: 'PAGO', vencimento: new Date('2025-02-15') },
      },
    ]);

    const result = await listInstallmentPlansAggregated({ contaId: 'ct_1' }, db);

    expect(result.items[0].statusConsolidado).toBe('QUITADO');
  });

  it('conta parcelas pagas corretamente', async () => {
    const db = createMockDb();
    db.installmentPlan.findMany.mockResolvedValue([
      makeAcademicPlan({ installmentCount: 4 }),
    ]);
    db.charge.findMany.mockResolvedValue([
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:1',
        cobranca: { id: 'cob_1', status: 'PAGO', vencimento: new Date('2025-01-15') },
      },
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:2',
        cobranca: { id: 'cob_2', status: 'PAGO', vencimento: new Date('2025-02-15') },
      },
      {
        externalReference: 'alusa:installment:ip_1:sub_1:payment:3',
        cobranca: { id: 'cob_3', status: 'PENDENTE', vencimento: new Date('2025-03-15') },
      },
    ]);

    const result = await listInstallmentPlansAggregated({ contaId: 'ct_1' }, db);

    expect(result.items[0].installmentsPaid).toBe(2);
  });

  it('filtra por busca textual usando o nome do aluno', async () => {
    const db = createMockDb();
    db.installmentPlan.findMany.mockResolvedValue([
      makeAcademicPlan(),
      makeAcademicPlan({
        id: 'ip_2',
        matricula: {
          id: 'mat_2',
          aluno: { nome: 'Pedro Santos' },
          responsavelFinanceiro: { nome: 'Pedro Santos' },
        },
      }),
    ]);

    const result = await listInstallmentPlansAggregated(
      { contaId: 'ct_1', search: 'João' },
      db,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].studentName).toBe('João Silva');
  });

  it('standaloneCountsByPlan: conta parcelas pagas de standalone', async () => {
    const db = createMockDb();
    db.standaloneInstallmentPlan.findMany.mockResolvedValue([
      makeStandalonePlan({ installmentCount: 3 }),
    ]);
    db.responsavel.findMany.mockResolvedValue([{ id: 'resp_1', nome: 'Carlos' }]);

    const chargesData = [
      { standaloneInstallmentPlanId: 'sip_1', status: 'PAID', dueDate: new Date('2025-02-15') },
      { standaloneInstallmentPlanId: 'sip_1', status: 'OPEN', dueDate: new Date('2026-03-15') },
      { standaloneInstallmentPlanId: 'sip_1', status: 'CREATED', dueDate: new Date('2026-04-15') },
    ];
    db.charge.findMany.mockResolvedValue(chargesData);

    const result = await listInstallmentPlansAggregated({ contaId: 'ct_1' }, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].installmentsPaid).toBe(1);
    expect(result.items[0].statusConsolidado).toBe('EM_DIA');
  });

  it('paginação funciona corretamente', async () => {
    const db = createMockDb();
    const plans = Array.from({ length: 5 }, (_, i) =>
      makeAcademicPlan({
        id: `ip_${i}`,
        externalReference: `alusa:installment:ip_${i}:sub_1`,
        matricula: {
          id: `mat_${i}`,
          aluno: { nome: `Aluno ${i}` },
          responsavelFinanceiro: null,
        },
      }),
    );
    db.installmentPlan.findMany.mockResolvedValue(plans);

    const result = await listInstallmentPlansAggregated(
      { contaId: 'ct_1', page: 2, pageSize: 2 },
      db,
    );

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('ip_2');
  });

  it('plano cancelado tem statusConsolidado CANCELADO', async () => {
    const db = createMockDb();
    db.installmentPlan.findMany.mockResolvedValue([
      makeAcademicPlan({ status: 'CANCELED' }),
    ]);

    const result = await listInstallmentPlansAggregated({ contaId: 'ct_1' }, db);

    expect(result.items[0].statusConsolidado).toBe('CANCELADO');
    expect(result.items[0].status).toBe('CANCELED');
  });
});
