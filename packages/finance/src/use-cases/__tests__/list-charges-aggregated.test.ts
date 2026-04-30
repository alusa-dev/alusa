import { describe, it, expect, vi, beforeEach } from 'vitest';

import { listChargesAggregated } from '../list-charges-aggregated';

vi.mock('@alusa/database', () => {
  return {
    prisma: {
      cobranca: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
      charge: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
      installmentPlan: {
        findMany: vi.fn(),
      },
    },
  };
});

describe('listChargesAggregated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAcademicCobranca = {
    id: 'cob1',
    matriculaId: 'm1',
    tipo: 'MENSALIDADE',
    descricao: 'Mensalidade Janeiro',
    valor: 150, // Prisma Decimal é convertido para number
    vencimento: new Date('2026-02-05T00:00:00.000Z'),
    formaPagamento: 'PIX',
    status: 'PENDENTE',
    liquidacaoStatus: 'NAO_APLICAVEL',
    asaasPaymentId: 'pay_123',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    matricula: {
      id: 'm1',
      aluno: { id: 'a1', nome: 'João Silva' },
    },
  };

  const mockStandaloneCharge = {
    id: 'chg1',
    contaId: 'c1',
    externalReference: 'standalone:abc123',
    status: 'OPEN',
    statusUpdatedAt: new Date('2026-01-02T00:00:00.000Z'),
    asaasPaymentId: 'pay_456',
    createdAt: new Date('2026-01-02T12:00:00.000Z'),
    payerName: 'Maria Santos',
    description: 'Taxa extra',
    value: 80, // Prisma Decimal é convertido para number
    dueDate: new Date('2026-01-15T00:00:00.000Z'),
    billingType: 'CREDIT_CARD',
  };

  it('deve listar cobranças acadêmicas e standalone juntas', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([mockAcademicCobranca] as never);
    vi.mocked(prisma.charge.findMany)
      .mockResolvedValueOnce([mockStandaloneCharge] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.cobranca.count).mockResolvedValueOnce(1 as never);
    vi.mocked(prisma.charge.count).mockResolvedValueOnce(1 as never);

    const result = await listChargesAggregated({ contaId: 'c1' });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);

    // Ordenado por createdAt desc - standalone é mais recente
    expect(result.items[0].origin).toBe('STANDALONE');
    expect(result.items[0].payerName).toBe('Maria Santos');
    expect(result.items[0].value).toBe(80);

    expect(result.items[1].origin).toBe('ACADEMIC');
    expect(result.items[1].payerName).toBe('João Silva');
    expect(result.items[1].value).toBe(150);
  });

  it('deve filtrar por tenant (contaId)', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.charge.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.cobranca.count).mockResolvedValueOnce(0 as never);
    vi.mocked(prisma.charge.count).mockResolvedValueOnce(0 as never);

    await listChargesAggregated({ contaId: 'tenant-123' });

    // Verifica filtro por contaId nas queries
    expect(prisma.cobranca.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matricula: { aluno: { contaId: 'tenant-123' } },
        }),
      }),
    );

    expect(prisma.charge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'tenant-123',
          cobrancaId: null,
        }),
      }),
    );
  });

  it('deve mapear status corretamente', async () => {
    const { prisma } = await import('@alusa/database');

    const academicPago = { ...mockAcademicCobranca, status: 'PAGO' };
    const standaloneOverdue = { ...mockStandaloneCharge, status: 'OVERDUE' };

    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([academicPago] as never);
    vi.mocked(prisma.charge.findMany)
      .mockResolvedValueOnce([standaloneOverdue] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.cobranca.count).mockResolvedValueOnce(1 as never);
    vi.mocked(prisma.charge.count).mockResolvedValueOnce(1 as never);

    const result = await listChargesAggregated({ contaId: 'c1', statusView: 'all' });

    const academicItem = result.items.find((i) => i.origin === 'ACADEMIC');
    const standaloneItem = result.items.find((i) => i.origin === 'STANDALONE');

    expect(academicItem?.status).toBe('PAID');
    expect(standaloneItem?.status).toBe('OVERDUE');
  });

  it('deve respeitar paginação', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([mockAcademicCobranca] as never);
    vi.mocked(prisma.charge.findMany)
      .mockResolvedValueOnce([mockStandaloneCharge] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.cobranca.count).mockResolvedValueOnce(10 as never);
    vi.mocked(prisma.charge.count).mockResolvedValueOnce(5 as never);

    const result = await listChargesAggregated({ contaId: 'c1', page: 1, pageSize: 2 });

    expect(result.total).toBe(15);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.totalPages).toBe(8);
    expect(result.items).toHaveLength(2);
  });

  it('deve retornar lista vazia quando não houver cobranças', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.charge.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.cobranca.count).mockResolvedValueOnce(0 as never);
    vi.mocked(prisma.charge.count).mockResolvedValueOnce(0 as never);

    const result = await listChargesAggregated({ contaId: 'c1' });

    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
    expect(result.totalPages).toBe(0);
  });

  it('deve incluir campos necessários para listagem', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([mockAcademicCobranca] as never);
    vi.mocked(prisma.charge.findMany)
      .mockResolvedValueOnce([mockStandaloneCharge] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.cobranca.count).mockResolvedValueOnce(1 as never);
    vi.mocked(prisma.charge.count).mockResolvedValueOnce(1 as never);

    const result = await listChargesAggregated({ contaId: 'c1' });

    const academicItem = result.items.find((i) => i.origin === 'ACADEMIC');
    const standaloneItem = result.items.find((i) => i.origin === 'STANDALONE');

    // Campos obrigatórios
    expect(academicItem).toMatchObject({
      id: 'cob1',
      origin: 'ACADEMIC',
      payerName: 'João Silva',
      value: 150,
      status: 'PENDING',
      matriculaId: 'm1',
      alunoId: 'a1',
      asaasPaymentId: 'pay_123',
      tipo: 'MENSALIDADE',
    });

    expect(standaloneItem).toMatchObject({
      id: 'chg1',
      origin: 'STANDALONE',
      payerName: 'Maria Santos',
      value: 80,
      status: 'PENDING',
      matriculaId: null,
      alunoId: null,
      asaasPaymentId: 'pay_456',
      tipo: 'AVULSA',
    });
  });

  it('deve resolver installmentPlanId em V1 e V2 com payment', async () => {
    const { prisma } = await import('@alusa/database');
    process.env.FINANCE_GROUP_INSTALLMENTS_V2 = 'true';

    const academicParcelada1 = {
      ...mockAcademicCobranca,
      id: 'cob-parc-1',
      tipo: 'PARCELADA',
      descricao: 'Parcela 1/2 - Plano',
    };
    const academicParcelada2 = {
      ...mockAcademicCobranca,
      id: 'cob-parc-2',
      tipo: 'PARCELADA',
      descricao: 'Parcela 2/2 - Plano',
    };

    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([academicParcelada1, academicParcelada2] as never);
    vi.mocked(prisma.cobranca.count).mockResolvedValueOnce(2 as never);
    vi.mocked(prisma.charge.count).mockResolvedValueOnce(0 as never);
    vi.mocked(prisma.charge.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          cobrancaId: 'cob-parc-1',
          externalReference: 'installmentPlan:ip1:payment:pay_1',
          status: 'OPEN',
        },
        {
          cobrancaId: 'cob-parc-2',
          externalReference: 'alusa:installment:ip1:c1:payment:pay_2',
          status: 'OPEN',
        },
      ] as never);

    vi.mocked(prisma.installmentPlan.findMany).mockResolvedValueOnce([
      {
        id: 'ip1',
        installmentCount: 2,
        value: 100,
        billingType: 'PIX',
        firstDueDate: new Date('2026-02-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-15T00:00:00.000Z'),
        matricula: { id: 'm1', aluno: { id: 'a1', nome: 'João Silva' } },
      },
    ] as never);

    const result = await listChargesAggregated({ contaId: 'c1' });

    expect(result.items.some((i) => i.isGroup && i.installmentPlanId === 'ip1')).toBe(true);
    delete process.env.FINANCE_GROUP_INSTALLMENTS_V2;
  });

  it('não deve listar placeholder PARCELADA sem installmentPlanId quando agrupado', async () => {
    const { prisma } = await import('@alusa/database');
    process.env.FINANCE_GROUP_INSTALLMENTS_V2 = 'true';

    const placeholder = {
      ...mockAcademicCobranca,
      id: 'cob-placeholder',
      tipo: 'PARCELADA',
      descricao: 'Parcelamento placeholder',
    };

    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([placeholder] as never);
    vi.mocked(prisma.charge.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.cobranca.count).mockResolvedValueOnce(1 as never);
    vi.mocked(prisma.charge.count).mockResolvedValueOnce(0 as never);

    const result = await listChargesAggregated({ contaId: 'c1' });
    const hasPlaceholder = result.items.some((i) => i.id === 'cob-placeholder');
    expect(hasPlaceholder).toBe(false);
    delete process.env.FINANCE_GROUP_INSTALLMENTS_V2;
  });
});
