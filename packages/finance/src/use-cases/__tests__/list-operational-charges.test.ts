import { beforeEach, describe, it, expect, vi } from 'vitest';

const { getPaymentMock, isAsaasEnabledMock } = vi.hoisted(() => ({
  getPaymentMock: vi.fn(),
  isAsaasEnabledMock: vi.fn(() => false),
}));

vi.mock('../asaas-ops', () => ({
  getPayment: getPaymentMock,
  isAsaasEnabled: isAsaasEnabledMock,
}));

import { getOperationalChargesSummary, listOperationalCharges } from '../list-operational-charges';

// ---------------------------------------------------------------------------
// Mock do Prisma via DI (o use-case aceita `db` como 2o argumento)
// ---------------------------------------------------------------------------

function createMockDb() {
  return {
    cobranca: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    charge: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    installmentPlan: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    standaloneInstallmentPlan: {
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

function makeCobranca(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cob_1',
    descricao: 'Mensalidade Jan',
    valor: 500,
    vencimento: new Date('2025-06-15'),
    formaPagamento: 'BOLETO',
    status: 'PENDENTE',
    asaasPaymentId: 'pay_asaas_1',
    tipo: 'MENSALIDADE',
    createdAt: new Date('2025-01-01'),
    matriculaId: 'mat_1',
    matricula: {
      id: 'mat_1',
      aluno: { id: 'alu_1', nome: 'João Silva' },
      responsavelFinanceiro: null,
      matriculaFamiliarId: null,
    },
    ...overrides,
  };
}

function makeCharge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch_1',
    contaId: 'ct_1',
    externalReference: 'alusa:ct_1:charge:ch_1',
    status: 'OPEN',
    asaasPaymentId: 'pay_asaas_2',
    createdAt: new Date('2025-01-05'),
    updatedAt: new Date('2025-06-15T11:59:00.000Z'),
    statusUpdatedAt: new Date('2025-06-15T11:59:00.000Z'),
    payerName: 'Maria Resp',
    description: 'Taxa extra',
    value: 200,
    dueDate: new Date('2025-06-20'),
    billingType: 'PIX',
    standaloneInstallmentPlanId: null,
    standaloneSubscriptionId: null,
    familyGroupId: null,
    invoiceUrl: null,
    customer: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('listOperationalCharges', () => {
  const NOW = new Date(2025, 5, 15); // 15 de junho de 2025
  const BASE_INPUT = { contaId: 'ct_1', now: NOW };

  beforeEach(() => {
    getPaymentMock.mockReset();
    isAsaasEnabledMock.mockReset();
    isAsaasEnabledMock.mockReturnValue(false);
  });

  // ===== Regra: apenas PENDING/OVERDUE =====
  it('retorna cobranças pendentes e vencidas, exclui pagas', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([
      makeCobranca({ id: 'cob_1', status: 'PENDENTE', vencimento: new Date('2025-06-10') }),
      makeCobranca({ id: 'cob_2', status: 'ATRASADO', vencimento: new Date('2025-05-01') }),
    ]);
    // 3a call de charge.findMany é para linkedCharges (retorna vazio)

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.status)).toEqual(
      expect.arrayContaining(['PENDING', 'OVERDUE']),
    );
  });

  it('retorna lista vazia quando não há itens operacionais', async () => {
    const db = createMockDb();
    const result = await listOperationalCharges(BASE_INPUT, db);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  // ===== Regra: vencimento <= fim do mês =====
  it('filtragem por data é feita na query (WHERE do Prisma)', async () => {
    const db = createMockDb();
    await listOperationalCharges(BASE_INPUT, db);

    const academicCall = db.cobranca.findMany.mock.calls[0][0];
    expect(academicCall.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO'] },
        }),
        expect.objectContaining({
          OR: expect.arrayContaining([
            { vencimento: { lte: expect.any(Date) } },
            { tipo: 'MENSALIDADE' },
            { createdAt: { gte: expect.any(Date) } },
          ]),
        }),
      ]),
    );
  });

  // ===== Regra: standalone avulsas =====
  it('inclui cobranças standalone avulsas (sem plano)', async () => {
    const db = createMockDb();
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({ id: 'ch_1', status: 'OPEN', dueDate: new Date('2025-06-20') }),
      ])
      .mockResolvedValueOnce([]); // linkedCharges

    // reorder: cobranca, charge (standalone), charge (linked)
    // Na verdade Promise.all resolve na ordem declarada
    db.cobranca.findMany.mockResolvedValue([]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].origin).toBe('STANDALONE');
    expect(result.items[0].isGroup).toBe(false);
  });

  it('mantém cobrança acadêmica familiar clicável como cobrança normal e resolve pagador responsável', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([
      makeCobranca({
        id: 'cob_family_1',
        matricula: {
          id: 'mat_family_1',
          aluno: { id: 'alu_family_1', nome: 'Aluno Filho' },
          responsavelFinanceiro: { nome: 'Maria Família' },
          matriculaFamiliarId: 'fam_1',
        },
      }),
    ]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'cob_family_1',
      payerName: 'Maria Família',
      isGroup: false,
      groupType: null,
      groupId: null,
    });
  });

  it('mantém cobrança standalone consolidada por família clicável como cobrança normal', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([]);
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({
          id: 'ch_family_1',
          familyGroupId: 'fam_1',
          payerName: 'Maria Família',
        }),
      ])
      .mockResolvedValueOnce([]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'ch_family_1',
      isGroup: false,
      groupType: null,
      groupId: null,
    });
  });

  it('inclui fatura acadêmica recém-gerada mesmo com vencimento no próximo mês', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([
      makeCobranca({
        id: 'cob_recent_subscription',
        descricao: 'Mensalidade abril',
        tipo: 'MENSALIDADE',
        status: 'A_VENCER',
        vencimento: new Date('2025-07-05T12:00:00.000Z'),
        createdAt: new Date('2025-06-12T09:00:00.000Z'),
      }),
    ]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('cob_recent_subscription');
    expect(result.items[0].status).toBe('PENDING');
  });

  it('expõe a próxima cobrança aberta de assinatura mesmo fora do mês corrente', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([
      makeCobranca({
        id: 'cob_sub_next',
        descricao: 'Mensalidade - Plano Mensal',
        tipo: 'MENSALIDADE',
        status: 'A_VENCER',
        vencimento: new Date('2025-08-05T12:00:00.000Z'),
        createdAt: new Date('2025-03-27T09:00:00.000Z'),
      }),
    ]);
    db.charge.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cobrancaId: 'cob_sub_next',
          externalReference: 'alusa:subscription:mat_1:plan_1:payment:pay_sub_next',
          status: 'OPEN',
        },
      ]);

    const result = await listOperationalCharges({ ...BASE_INPUT, now: new Date('2025-03-31T12:00:00.000Z') }, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('cob_sub_next');
    expect(result.items[0].chargeType).toBe('SUBSCRIPTION');
  });

  it('expõe apenas a próxima cobrança aberta por assinatura', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([
      makeCobranca({
        id: 'cob_sub_apr',
        descricao: 'Mensalidade abril',
        tipo: 'MENSALIDADE',
        status: 'A_VENCER',
        vencimento: new Date('2025-04-05T12:00:00.000Z'),
        createdAt: new Date('2025-03-27T09:00:00.000Z'),
      }),
      makeCobranca({
        id: 'cob_sub_may',
        descricao: 'Mensalidade maio',
        tipo: 'MENSALIDADE',
        status: 'A_VENCER',
        vencimento: new Date('2025-05-05T12:00:00.000Z'),
        createdAt: new Date('2025-03-27T09:00:00.000Z'),
      }),
    ]);
    db.charge.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          cobrancaId: 'cob_sub_apr',
          externalReference: 'alusa:subscription:mat_1:plan_1:payment:pay_sub_apr',
          status: 'OPEN',
        },
        {
          cobrancaId: 'cob_sub_may',
          externalReference: 'alusa:subscription:mat_1:plan_1:payment:pay_sub_may',
          status: 'OPEN',
        },
      ]);

    const result = await listOperationalCharges({ ...BASE_INPUT, now: new Date('2025-03-31T12:00:00.000Z') }, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('cob_sub_apr');
  });

  it('inclui cobrança avulsa recém-gerada mesmo com vencimento no próximo mês', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([]);
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({
          id: 'ch_recent_future',
          description: 'Taxa recém-gerada',
          dueDate: new Date('2025-07-05T12:00:00.000Z'),
          createdAt: new Date('2025-06-14T09:00:00.000Z'),
          standaloneInstallmentPlanId: null,
        }),
      ])
      .mockResolvedValueOnce([]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('ch_recent_future');
    expect(result.items[0].tipo).toBe('AVULSA');
  });

  it('expõe a parcela standalone do mês vigente como parcelamento', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([]);
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({
          id: 'ch_installment_current',
          externalReference: 'alusa:installment:sip_123:payment:pay_123',
          standaloneInstallmentPlanId: null,
          dueDate: new Date('2025-06-25T12:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'ch_installment_current',
      tipo: 'PARCELADA',
      chargeType: 'INSTALLMENT',
    });
  });

  it('classifica assinatura standalone como recorrente e resolve nome do pagador pelo customer local', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([]);
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({
          id: 'ch_subscription',
          externalReference: 'alusa:standalone-subscription:sub_123:payment:pay_123',
          payerName: 'Cliente',
          customer: { payerType: 'ALUNO', payerId: 'alu_123' },
          dueDate: new Date('2025-07-05T12:00:00.000Z'),
          createdAt: new Date('2025-06-14T09:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([]);
    db.aluno.findMany.mockResolvedValue([{ id: 'alu_123', nome: 'Lara Bianca de Alencar' }]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'ch_subscription',
      tipo: 'RECORRENTE',
      chargeType: 'SUBSCRIPTION',
      payerName: 'Lara Bianca de Alencar',
    });
  });

  it('reconcilia standalone ligada com estado oficial do Asaas antes de filtrar a fila operacional', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([]);
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({
          id: 'ch_cash',
          status: 'PAID',
          dueDate: new Date('2025-06-20T12:00:00.000Z'),
          asaasPaymentId: 'pay_cash',
          updatedAt: new Date('2025-06-15T12:00:00.000Z'),
          statusUpdatedAt: new Date('2025-06-15T12:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([]);

    isAsaasEnabledMock.mockReturnValue(true);
    getPaymentMock.mockResolvedValue({
      id: 'pay_cash',
      status: 'PENDING',
      dueDate: '2025-06-20',
    });

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(getPaymentMock).toHaveBeenCalledWith('pay_cash', { contaId: 'ct_1' });
    expect(db.charge.updateMany).toHaveBeenCalledWith({
      where: { id: 'ch_cash' },
      data: {
        status: 'OPEN',
        dueDate: new Date('2025-06-20T12:00:00.000Z'),
        statusUpdatedAt: expect.any(Date),
      },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('ch_cash');
    expect(result.items[0].status).toBe('PENDING');
  });

  it('não reconsulta o Asaas para standalone estável fora da janela operacional', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([]);
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({
          id: 'ch_stable',
          status: 'OPEN',
          dueDate: new Date('2025-06-20T12:00:00.000Z'),
          updatedAt: new Date('2025-05-01T12:00:00.000Z'),
          statusUpdatedAt: new Date('2025-05-01T12:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([]);

    isAsaasEnabledMock.mockReturnValue(true);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(getPaymentMock).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('ch_stable');
    expect(result.items[0].status).toBe('PENDING');
  });

  it('desvincula pagamento standalone quando o Asaas retorna 404 e mantém a cobrança na fila sem erro repetitivo', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([]);
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({
          id: 'ch_missing',
          status: 'OPEN',
          dueDate: new Date('2025-06-20T12:00:00.000Z'),
          asaasPaymentId: 'pay_missing',
        }),
      ])
      .mockResolvedValueOnce([]);

    isAsaasEnabledMock.mockReturnValue(true);
    getPaymentMock.mockRejectedValue({ status: 404, message: 'Asaas API error: 404' });

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(db.charge.updateMany).toHaveBeenCalledWith({
      where: { id: 'ch_missing' },
      data: {
        asaasPaymentId: null,
      },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('ch_missing');
    expect(result.items[0].asaasPaymentId).toBeNull();
    expect(result.items[0].linkStatus).toBe('NEEDS_REVIEW');
  });

  // ===== Regra: parcelamento expõe parcelas relevantes, sem agrupador =====
  it('expõe parcelas acadêmicas vencidas e da competência atual sem agrupar o plano inteiro', async () => {
    const db = createMockDb();

    db.cobranca.findMany.mockResolvedValue([
      makeCobranca({ id: 'cob_p1', status: 'PENDENTE', vencimento: new Date('2025-06-10'), tipo: 'PARCELADA' }),
      makeCobranca({ id: 'cob_p2', status: 'ATRASADO', vencimento: new Date('2025-05-10'), tipo: 'PARCELADA' }),
    ]);

    db.charge.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { cobrancaId: 'cob_p1', externalReference: 'installmentPlan:plan_1:payment:1', status: 'OPEN' },
        { cobrancaId: 'cob_p2', externalReference: 'installmentPlan:plan_1:payment:2', status: 'OVERDUE' },
      ]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.id)).toEqual(['cob_p2', 'cob_p1']);
    expect(result.items.every((item) => item.isGroup === false)).toBe(true);
    expect(result.items.every((item) => item.groupType === null)).toBe(true);
    expect(result.items.every((item) => item.tipo === 'PARCELADA')).toBe(true);
    expect(db.installmentPlan.findMany).not.toHaveBeenCalled();
  });

  // ===== Regra: standalone parcelado expõe parcelas relevantes, sem agrupador =====
  it('expõe parcelas standalone vencidas e atuais sem agrupar o plano inteiro', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([]);

    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({
          id: 'ch_s1', status: 'OPEN', dueDate: new Date('2025-06-15'),
          standaloneInstallmentPlanId: 'splan_1',
        }),
        makeCharge({
          id: 'ch_s2', status: 'OVERDUE', dueDate: new Date('2025-05-15'),
          standaloneInstallmentPlanId: 'splan_1',
        }),
      ])
      .mockResolvedValueOnce([]); // linkedCharges

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.id)).toEqual(['ch_s2', 'ch_s1']);
    expect(result.items.every((item) => item.isGroup === false)).toBe(true);
    expect(result.items.every((item) => item.groupType === null)).toBe(true);
    expect(result.items.every((item) => item.tipo === 'PARCELADA')).toBe(true);
    expect(db.standaloneInstallmentPlan.findMany).not.toHaveBeenCalled();
    expect(db.aluno.findMany).not.toHaveBeenCalled();
  });

  it('não expõe parcela futura recém-gerada de parcelamento standalone', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([]);
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({
          id: 'ch_installment_future',
          description: 'Parcela 2/2',
          status: 'OPEN',
          dueDate: new Date('2025-07-05T12:00:00.000Z'),
          createdAt: new Date('2025-06-14T09:00:00.000Z'),
          standaloneInstallmentPlanId: 'splan_1',
        }),
      ])
      .mockResolvedValueOnce([]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items).toHaveLength(0);
  });

  // ===== Regra: ordenação — overdue primeiro, depois por vencimento ASC =====
  it('ordena overdue primeiro, depois por vencimento ASC', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([
      makeCobranca({ id: 'cob_1', status: 'PENDENTE', vencimento: new Date('2025-06-25') }),
      makeCobranca({ id: 'cob_2', status: 'ATRASADO', vencimento: new Date('2025-06-01') }),
      makeCobranca({ id: 'cob_3', status: 'PENDENTE', vencimento: new Date('2025-06-10') }),
    ]);

    const result = await listOperationalCharges(BASE_INPUT, db);

    expect(result.items[0].id).toBe('cob_2'); // OVERDUE, vem primeiro
    expect(result.items[1].id).toBe('cob_3'); // PENDING, dia 10
    expect(result.items[2].id).toBe('cob_1'); // PENDING, dia 25
  });

  // ===== Paginação =====
  it('pagina corretamente', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([
      makeCobranca({ id: 'cob_1', status: 'PENDENTE', vencimento: new Date('2025-06-01') }),
      makeCobranca({ id: 'cob_2', status: 'PENDENTE', vencimento: new Date('2025-06-02') }),
      makeCobranca({ id: 'cob_3', status: 'PENDENTE', vencimento: new Date('2025-06-03') }),
    ]);

    const result = await listOperationalCharges({ ...BASE_INPUT, page: 1, pageSize: 2 }, db);

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(2);
    expect(result.page).toBe(1);
  });

  it('resume o mesmo conjunto da fila operacional para uso em KPI', async () => {
    const db = createMockDb();
    db.cobranca.findMany.mockResolvedValue([
      makeCobranca({ id: 'cob_1', valor: 80, status: 'PENDENTE', vencimento: new Date('2025-06-10') }),
    ]);
    db.charge.findMany
      .mockResolvedValueOnce([
        makeCharge({ id: 'ch_1', value: 150, status: 'OPEN', dueDate: new Date('2025-06-12') }),
        makeCharge({ id: 'ch_2', value: 30, status: 'OVERDUE', dueDate: new Date('2025-05-31') }),
      ])
      .mockResolvedValueOnce([]);

    const result = await getOperationalChargesSummary(BASE_INPUT, db);

    expect(result).toEqual({
      total: 3,
      valorBruto: 260,
    });
  });

  // ===== Search =====
  it('passa search para o WHERE do Prisma', async () => {
    const db = createMockDb();
    await listOperationalCharges({ ...BASE_INPUT, search: 'João' }, db);

    const call = db.cobranca.findMany.mock.calls[0][0];
    expect(call.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: [
            { matricula: { aluno: { nome: { contains: 'João', mode: 'insensitive' } } } },
            { descricao: { contains: 'João', mode: 'insensitive' } },
          ],
        }),
      ]),
    );
  });
});
