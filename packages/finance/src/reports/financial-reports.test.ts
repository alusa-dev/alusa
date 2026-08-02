import { describe, expect, it, vi } from 'vitest';

import {
  FinancialReportRowLimitError,
  financialReportQuerySchema,
  getFinancialOverviewReport,
  getReceiptsReport,
  loadFinancialReportProjections,
  validateFinancialReportDimensions,
  zonedDayStart,
} from './financial-reports';

const query = financialReportQuerySchema.parse({
  startDate: '2026-07-01',
  endDate: '2026-07-31',
});

function dbFixture() {
  return {
    conta: {
      findFirst: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }),
    },
    turma: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    plano: { findFirst: vi.fn(), findMany: vi.fn() },
    matricula: { findMany: vi.fn().mockResolvedValue([]) },
    pagamento: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    cobranca: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'c-a',
          contaId: 'tenant-a',
          asaasPaymentId: null,
          tipo: 'MENSALIDADE',
          descricao: 'Julho',
          valor: 100,
          valorFinal: 100,
          vencimento: new Date('2026-07-05T04:00:00.000Z'),
          dataPagamento: null,
          pagoEm: null,
          formaPagamento: 'PIX',
          pagoPor: null,
          status: 'ATRASADO',
          estornadoValor: null,
          asaasValue: null,
          asaasNetValue: null,
          asaasFeeValue: null,
          liquidacaoStatus: 'NAO_APLICAVEL',
          liquidadoEm: null,
          asaasCreditDate: null,
          competenciaInicio: new Date('2026-07-01T04:00:00.000Z'),
          pagamentos: [],
          matricula: {
            id: 'm-a',
            contaId: 'tenant-a',
            aluno: { id: 'a-a', contaId: 'tenant-a', nome: 'Aluno A' },
            responsavelFinanceiro: {
              id: 'r-a',
              contaId: 'tenant-a',
              nome: 'Responsável A',
              email: 'a@example.test',
              telefone: '92999990000',
            },
            turma: { id: 't-a', contaId: 'tenant-a', nome: 'Turma A' },
            plano: { id: 'p-a', contaId: 'tenant-a', nome: 'Plano A' },
          },
        },
      ]),
    },
    charge: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 's-a',
          contaId: 'tenant-a',
          asaasPaymentId: null,
          description: 'Avulsa',
          value: 50,
          dueDate: new Date('2026-07-10T04:00:00.000Z'),
          billingType: 'BOLETO',
          payerName: 'Pagador avulso',
          status: 'PAID',
          asaasValue: 50,
          asaasNetValue: 48,
          asaasFeeValue: 2,
          liquidacaoStatus: 'DISPONIVEL',
          liquidadoEm: new Date('2026-07-12T12:00:00.000Z'),
          asaasCreditDate: null,
          customer: { contaId: 'tenant-a', payerType: 'RESPONSAVEL', payerId: 'r-s' },
        },
      ]),
    },
  };
}

describe('financial reports', () => {
  it('respeita a meia-noite do timezone da Conta', () => {
    expect(zonedDayStart('2026-07-01', 'America/Manaus').toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
  });

  it('projeta Cobranca e somente Charge standalone sem dupla contagem', async () => {
    const db = dbFixture();
    const result = await loadFinancialReportProjections({
      contaId: 'tenant-a',
      query,
      db: db as never,
      now: new Date('2026-07-30T12:00:00.000Z'),
    });

    expect(result.rows.map((row) => row.id)).toEqual(['COBRANCA:c-a', 'CHARGE:s-a']);
    expect(db.charge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contaId: 'tenant-a', cobrancaId: null }),
      }),
    );
    expect(db.cobranca.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contaId: 'tenant-a' }),
      }),
    );
  });

  it('calcula inadimplência por valor e líquido após taxas', async () => {
    const result = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query,
      db: dbFixture() as never,
      now: new Date('2026-07-30T12:00:00.000Z'),
    });

    expect(result.summary.overdue).toBe(100);
    expect(result.summary.received).toBe(50);
    expect(result.summary.net).toBe(48);
    expect(result.summary.delinquencyRate).toBeCloseTo(66.67);
  });

  it('calcula ocupação atual das turmas com a regra canônica de vagas e escopo tenant', async () => {
    const db = dbFixture();
    db.turma.findMany.mockResolvedValue([
      { id: 't-a', nome: 'Ballet Infantil', capacidade: 10 },
      { id: 't-b', nome: 'Jazz Intermediário', capacidade: 20 },
    ]);
    db.matricula.findMany.mockResolvedValue([
      { id: 'm-1', turmaId: 't-a', matriculaTurmas: [] },
      { id: 'm-2', turmaId: null, matriculaTurmas: [{ turmaId: 't-a' }, { turmaId: 't-b' }] },
    ]);

    const result = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query,
      db: db as never,
      now: new Date('2026-07-30T12:00:00.000Z'),
    });

    expect(db.matricula.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ contaId: 'tenant-a' }) }),
    );
    expect(result.classOccupancy).toEqual([
      expect.objectContaining({ id: 't-a', occupiedSeats: 2, capacity: 10, occupancyRate: 20 }),
      expect.objectContaining({ id: 't-b', occupiedSeats: 1, capacity: 20, occupancyRate: 5 }),
    ]);
  });

  it('agrupa matrículas e cancelamentos por mês preservando filtros e escopo tenant', async () => {
    const db = dbFixture();
    db.matricula.findMany.mockResolvedValueOnce([
      {
        id: 'm-new',
        status: 'ATIVA',
        createdAt: new Date('2026-07-10T12:00:00.000Z'),
        updatedAt: new Date('2026-07-10T12:00:00.000Z'),
      },
      {
        id: 'm-canceled',
        status: 'CANCELADA',
        createdAt: new Date('2026-06-10T12:00:00.000Z'),
        updatedAt: new Date('2026-07-15T12:00:00.000Z'),
      },
    ]);

    const result = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query: { ...query, turmaId: 't-a', planoId: 'p-a' },
      db: db as never,
      now: new Date('2026-07-30T12:00:00.000Z'),
    });

    expect(db.matricula.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'tenant-a',
          AND: expect.arrayContaining([
            expect.objectContaining({ planoId: 'p-a', OR: expect.any(Array) }),
          ]),
        }),
      }),
    );
    expect(result.enrollmentSeries).toEqual([
      expect.objectContaining({ key: '2026-07', enrollments: 1, cancellations: 1 }),
    ]);
    expect(result.enrollmentHealth).toEqual({
      activeEnrollments: 1,
      enrollmentsInPeriod: 1,
      cancellationsInPeriod: 1,
      openingActiveEnrollments: 1,
      retentionRate: 0,
    });
  });

  it('calcula o ticket médio atual sem depender do período do relatório', async () => {
    const db = dbFixture();
    db.matricula.findMany.mockImplementation(async (args: unknown) => {
      const queryArgs = args as { select?: { billingAllocations?: unknown } };
      if (!queryArgs.select?.billingAllocations) return [];
      return [
        {
          id: 'm-monthly',
          plano: { valor: 300, periodicidade: 'MENSAL' },
          combo: null,
          billingAllocations: [],
        },
        {
          id: 'm-annual',
          plano: { valor: 1200, periodicidade: 'ANUAL' },
          combo: null,
          billingAllocations: [],
        },
        {
          id: 'm-canonical',
          plano: { valor: 999, periodicidade: 'MENSAL' },
          combo: null,
          billingAllocations: [{ netAmount: 200, agreement: { cycle: 'MONTHLY' } }],
        },
      ];
    });

    const result = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query: { ...query, startDate: '2025-01-01', endDate: '2025-01-31' },
      db: db as never,
      now: new Date('2026-07-30T12:00:00.000Z'),
    });

    expect(result.summary.averageTicket).toBe(200);
    expect(db.matricula.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contaId: 'tenant-a' }),
        select: expect.objectContaining({ billingAllocations: expect.any(Object) }),
      }),
    );
  });

  it('exclui canceladas dos totais e usa somente valores vencidos no denominador do ranking', async () => {
    const db = dbFixture();
    const base = (await db.cobranca.findMany())[0];
    const overdue = {
      ...base,
      id: 'c-overdue',
      valor: 50,
      valorFinal: 50,
      status: 'ATRASADO',
      vencimento: new Date('2026-07-05T04:00:00.000Z'),
    };
    const future = {
      ...base,
      id: 'c-future',
      valor: 100,
      valorFinal: 100,
      status: 'PENDENTE',
      vencimento: new Date('2026-08-05T04:00:00.000Z'),
    };
    const canceled = {
      ...base,
      id: 'c-canceled',
      valor: 500,
      valorFinal: 500,
      status: 'CANCELADO',
    };
    db.cobranca.findMany.mockResolvedValue([overdue, future, canceled]);

    const result = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query: { ...query, origin: ['ACADEMIC'] },
      db: db as never,
      now: new Date('2026-07-30T12:00:00.000Z'),
    });

    expect(result.summary.totalCharges).toBe(150);
    expect(result.summary.overdue).toBe(50);
    expect(result.rankingByClass[0]?.delinquencyRate).toBe(100);
  });

  it('usa liquidação e competência como eixos independentes da série', async () => {
    const settledDb = dbFixture();
    const settled = (await settledDb.cobranca.findMany())[0];
    settled.status = 'PAGO';
    settled.pagoEm = new Date('2026-06-15T12:00:00.000Z');
    settled.liquidadoEm = new Date('2026-07-20T12:00:00.000Z');
    settled.competenciaInicio = new Date('2026-05-01T12:00:00.000Z');
    settledDb.cobranca.findMany.mockResolvedValue([settled]);

    const settledReport = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query: { ...query, dateBasis: 'SETTLED_AT', origin: ['ACADEMIC'] },
      db: settledDb as never,
    });
    expect(settledReport.series.map((item) => item.key)).toEqual(['2026-07']);

    const competenceDb = dbFixture();
    const competence = (await competenceDb.cobranca.findMany())[0];
    competence.status = 'PAGO';
    competence.pagoEm = new Date('2026-07-15T12:00:00.000Z');
    competence.competenciaInicio = new Date('2026-05-01T12:00:00.000Z');
    competenceDb.cobranca.findMany.mockResolvedValue([competence]);
    const competenceReport = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query: {
        ...query,
        startDate: '2026-05-01',
        dateBasis: 'COMPETENCE',
        origin: ['ACADEMIC'],
      },
      db: competenceDb as never,
    });
    expect(competenceReport.series.map((item) => item.key)).toEqual(['2026-05']);
  });

  it('pagina a última página e retorna vazio quando a página excede o total', async () => {
    const db = dbFixture();
    const base = (await db.cobranca.findMany())[0];
    db.cobranca.findMany.mockResolvedValue([
      { ...base, id: 'c-1' },
      { ...base, id: 'c-2' },
    ]);
    const lastPage = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query: {
        ...query,
        origin: ['ACADEMIC'],
        page: 2,
        pageSize: 1,
      },
      db: db as never,
    });
    const exceededPage = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query: {
        ...query,
        origin: ['ACADEMIC'],
        page: 3,
        pageSize: 1,
      },
      db: db as never,
    });

    expect(lastPage.details).toMatchObject({
      total: 2,
      totalPages: 2,
      page: 2,
    });
    expect(lastPage.details.items).toHaveLength(1);
    expect(exceededPage.details.items).toEqual([]);
    expect(exceededPage.details.totalPages).toBe(2);
  });

  it('impõe janela máxima de 24 meses', () => {
    expect(
      financialReportQuerySchema.safeParse({
        startDate: '2024-01-01',
        endDate: '2026-07-31',
      }).success,
    ).toBe(false);
  });

  it('rejeita datas civis impossíveis', () => {
    expect(
      financialReportQuerySchema.safeParse({
        startDate: '2026-02-30',
        endDate: '2026-03-01',
      }).success,
    ).toBe(false);
  });

  it('usa saldo remanescente em pagamento parcial para atraso e inadimplência', async () => {
    const db = dbFixture();
    const academic = (await db.cobranca.findMany())[0];
    academic.pagamentos = [
      {
        id: 'pg-partial',
        contaId: 'tenant-a',
        valorPago: 40,
        status: 'CONFIRMADO',
        dataPagamento: new Date('2026-07-06T12:00:00.000Z'),
        formaPagamento: 'PIX',
        asaasPaymentId: 'asaas-partial',
      },
    ];
    db.cobranca.findMany.mockResolvedValue([academic]);
    const result = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query: { ...query, origin: ['ACADEMIC'] },
      db: db as never,
      now: new Date('2026-07-30T12:00:00.000Z'),
    });

    expect(result.summary.received).toBe(40);
    expect(result.summary.overdue).toBe(60);
    expect(result.summary.delinquencyRate).toBe(60);
    expect(result.details.items[0]?.outstandingAmount).toBe(60);
  });

  it('projeta somente os eventos Pagamento dentro de PAID_AT sem repetir o total da cobrança', async () => {
    const db = dbFixture();
    const academic = (await db.cobranca.findMany())[0];
    academic.status = 'PAGO';
    academic.pagamentos = [
      {
        id: 'pg-june',
        contaId: 'tenant-a',
        valorPago: 50,
        status: 'CONFIRMADO',
        dataPagamento: new Date('2026-06-20T12:00:00.000Z'),
        formaPagamento: 'BOLETO',
        asaasPaymentId: 'pay-june',
      },
      {
        id: 'pg-july-a',
        contaId: 'tenant-a',
        valorPago: 30,
        status: 'CONFIRMADO',
        dataPagamento: new Date('2026-07-10T12:00:00.000Z'),
        formaPagamento: 'PIX',
        asaasPaymentId: 'pay-july-a',
      },
      {
        id: 'pg-july-b',
        contaId: 'tenant-a',
        valorPago: 20,
        status: 'CONFIRMADO',
        dataPagamento: new Date('2026-07-20T12:00:00.000Z'),
        formaPagamento: 'CARTAO_CREDITO',
        asaasPaymentId: 'pay-july-b',
      },
    ];
    db.pagamento.findMany.mockResolvedValue([
      { ...academic.pagamentos[1], cobranca: academic },
      { ...academic.pagamentos[2], cobranca: academic },
    ]);
    db.charge.count.mockResolvedValue(3);
    const paidQuery = financialReportQuerySchema.parse({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      dateBasis: 'PAID_AT',
      origin: ['ACADEMIC'],
    });
    const result = await getFinancialOverviewReport({
      contaId: 'tenant-a',
      query: paidQuery,
      db: db as never,
      now: new Date('2026-07-30T12:00:00.000Z'),
    });

    expect(result.details.items.map((item) => item.id)).toEqual([
      'COBRANCA:c-a:PAGAMENTO:pg-july-a',
      'COBRANCA:c-a:PAGAMENTO:pg-july-b',
    ]);
    expect(result.summary.totalCharges).toBe(100);
    expect(result.summary.received).toBe(50);
    expect(result.paymentMethodBreakdown.map((item) => [item.key, item.amount])).toEqual([
      ['PIX', 30],
      ['CARTAO_CREDITO', 20],
    ]);
    expect(db.pagamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'tenant-a',
          dataPagamento: {
            gte: new Date('2026-07-01T04:00:00.000Z'),
            lt: new Date('2026-08-01T04:00:00.000Z'),
          },
        }),
        orderBy: [{ dataPagamento: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it.each([
    {
      status: 'PAGO',
      refunded: 0,
      expectedStatus: 'PAID',
      net: 98,
    },
    {
      status: 'ESTORNADO',
      refunded: 100,
      expectedStatus: 'REFUNDED',
      net: -2,
    },
    {
      status: 'ESTORNADO_PARCIAL',
      refunded: 25,
      expectedStatus: 'REFUNDED',
      net: 73,
    },
  ])(
    'projeta legado $status sem Pagamento usando somente data canônica da Cobranca',
    async ({ status, refunded, expectedStatus, net }) => {
      const db = dbFixture();
      const academic = (await db.cobranca.findMany())[0];
      academic.status = status;
      academic.pagoEm = new Date('2026-07-18T12:00:00.000Z');
      academic.dataPagamento = new Date('2026-07-17T12:00:00.000Z');
      academic.asaasFeeValue = 2;
      academic.estornadoValor = status === 'ESTORNADO_PARCIAL' ? 25 : null;
      academic.pagamentos = [];
      db.cobranca.findMany.mockResolvedValue([academic]);

      const result = await loadFinancialReportProjections({
        contaId: 'tenant-a',
        query: {
          ...query,
          dateBasis: 'PAID_AT',
          origin: ['ACADEMIC'],
        },
        db: db as never,
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        status: expectedStatus,
        receivedAmount: 100,
        refundedAmount: refunded,
        feeAmount: 2,
        netAmount: net,
      });
      expect(result.rows[0]?.paidAt?.toISOString()).toBe('2026-07-18T12:00:00.000Z');
    },
  );

  it('exclui e sinaliza legado recebido sem pagoEm nem dataPagamento', async () => {
    const db = dbFixture();
    db.cobranca.count.mockResolvedValue(1);
    db.cobranca.findMany.mockResolvedValue([]);

    const result = await loadFinancialReportProjections({
      contaId: 'tenant-a',
      query: { ...query, dateBasis: 'PAID_AT', origin: ['ACADEMIC'] },
      db: db as never,
    });

    expect(result.rows).toEqual([]);
    expect(result.dataQuality.excludedRecords).toBe(1);
    expect(result.dataQuality.warnings.join(' ')).toContain('pagoEm nem dataPagamento');
  });

  it('mantém forma efetiva e rateio exato por evento nos recebimentos por liquidação', async () => {
    const db = dbFixture();
    const academic = (await db.cobranca.findMany())[0];
    academic.status = 'PAGO';
    academic.liquidacaoStatus = 'DISPONIVEL';
    academic.liquidadoEm = new Date('2026-07-25T12:00:00.000Z');
    academic.asaasFeeValue = 1;
    academic.pagamentos = [
      {
        id: 'pg-a',
        contaId: 'tenant-a',
        valorPago: 33.33,
        status: 'CONFIRMADO',
        dataPagamento: new Date('2026-07-10T12:00:00.000Z'),
        formaPagamento: 'PIX',
        asaasPaymentId: 'pay-a',
      },
      {
        id: 'pg-b',
        contaId: 'tenant-a',
        valorPago: 33.33,
        status: 'CONFIRMADO',
        dataPagamento: new Date('2026-07-11T12:00:00.000Z'),
        formaPagamento: 'BOLETO',
        asaasPaymentId: 'pay-b',
      },
      {
        id: 'pg-c',
        contaId: 'tenant-a',
        valorPago: 33.34,
        status: 'CONFIRMADO',
        dataPagamento: new Date('2026-07-12T12:00:00.000Z'),
        formaPagamento: 'CARTAO_CREDITO',
        asaasPaymentId: 'pay-c',
      },
    ];
    db.pagamento.findMany.mockResolvedValue(
      academic.pagamentos.map((payment) => ({ ...payment, cobranca: academic })),
    );

    const result = await getReceiptsReport({
      contaId: 'tenant-a',
      query: { ...query, dateBasis: 'SETTLED_AT', origin: ['ACADEMIC'] },
      db: db as never,
    });

    expect(result.details.items.map((item) => item.paymentMethod).sort()).toEqual([
      'BOLETO',
      'CARTAO_CREDITO',
      'PIX',
    ]);
    expect(result.summary.fees).toBe(1);
    expect(db.pagamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cobranca: {
            is: expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({ liquidadoEm: expect.anything() }),
              ]),
            }),
          },
        }),
      }),
    );
  });

  it('interrompe antes de materializar exportações acima do limite', async () => {
    const db = dbFixture();
    const academic = (await db.cobranca.findMany())[0];
    const payment = {
      id: 'pg-limit',
      contaId: 'tenant-a',
      valorPago: 10,
      status: 'CONFIRMADO',
      dataPagamento: new Date('2026-07-10T12:00:00.000Z'),
      formaPagamento: 'PIX',
      asaasPaymentId: 'pay-limit',
    };
    academic.pagamentos = [payment];
    db.pagamento.findMany.mockResolvedValue(
      [0, 1, 2].map((index) => ({
        ...payment,
        id: `${payment.id}-${index}`,
        cobranca: academic,
      })),
    );

    await expect(
      loadFinancialReportProjections({
        contaId: 'tenant-a',
        query: { ...query, dateBasis: 'PAID_AT', origin: ['ACADEMIC'] },
        db: db as never,
        maxRows: 2,
      }),
    ).rejects.toBeInstanceOf(FinancialReportRowLimitError);
    expect(db.pagamento.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
  });

  it('descarta joins cross-tenant sem expor IDs relacionados', async () => {
    const db = dbFixture();
    const academic = (await db.cobranca.findMany())[0];
    academic.matricula.aluno.contaId = 'tenant-b';
    db.cobranca.findMany.mockResolvedValue([academic]);
    const result = await loadFinancialReportProjections({
      contaId: 'tenant-a',
      query: { ...query, origin: ['ACADEMIC'] },
      db: db as never,
    });

    expect(result.rows).toEqual([]);
    expect(result.dataQuality.excludedRecords).toBe(1);
    expect(JSON.stringify(result)).not.toContain('a-a');
  });

  it('deduplica Charge standalone por asaasPaymentId já pertencente à Cobranca', async () => {
    const db = dbFixture();
    const academic = (await db.cobranca.findMany())[0];
    const standalone = (await db.charge.findMany())[0];
    standalone.asaasPaymentId = 'pay-duplicate';
    db.cobranca.findMany
      .mockResolvedValueOnce([academic])
      .mockResolvedValueOnce([{ asaasPaymentId: 'pay-duplicate', pagamentos: [] }]);
    db.charge.findMany.mockResolvedValue([standalone]);
    const result = await loadFinancialReportProjections({
      contaId: 'tenant-a',
      query,
      db: db as never,
    });

    expect(result.rows.map((row) => row.id)).toEqual(['COBRANCA:c-a']);
    expect(result.dataQuality.warnings.join(' ')).toContain('duplicadas');
  });

  it('não inventa paidAt standalone e preserva liquidação por creditDate', async () => {
    const paidDb = dbFixture();
    paidDb.pagamento.findMany.mockResolvedValue([]);
    paidDb.charge.count.mockResolvedValue(2);
    const paidResult = await loadFinancialReportProjections({
      contaId: 'tenant-a',
      query: { ...query, dateBasis: 'PAID_AT' },
      db: paidDb as never,
    });
    expect(paidResult.rows).toEqual([]);
    expect(paidResult.dataQuality.excludedRecords).toBe(2);

    const settledDb = dbFixture();
    const standalone = (await settledDb.charge.findMany())[0];
    standalone.liquidadoEm = null;
    standalone.asaasCreditDate = new Date('2026-07-12T12:00:00.000Z');
    settledDb.cobranca.findMany.mockResolvedValue([]);
    settledDb.charge.findMany.mockResolvedValue([standalone]);
    const settledResult = await loadFinancialReportProjections({
      contaId: 'tenant-a',
      query: { ...query, dateBasis: 'SETTLED_AT' },
      db: settledDb as never,
    });
    expect(settledResult.rows[0]?.paidAt).toBeNull();
    expect(settledResult.rows[0]?.settledAt?.toISOString()).toBe('2026-07-12T12:00:00.000Z');
  });

  it('rejeita turma de outro tenant antes do relatório', async () => {
    const db = dbFixture();
    db.turma.findFirst.mockResolvedValue(null);
    const result = await validateFinancialReportDimensions({
      contaId: 'tenant-a',
      query: { ...query, turmaId: 'turma-tenant-b' },
      db: db as never,
    });

    expect(result).toBe('TURMA_INVALIDA');
    expect(db.turma.findFirst).toHaveBeenCalledWith({
      where: { id: 'turma-tenant-b', contaId: 'tenant-a' },
      select: { id: true },
    });
  });
});
