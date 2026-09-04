import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMock = vi.hoisted(() => vi.fn());
const runWithTenantMock = vi.hoisted(() => vi.fn());
const getOverviewMock = vi.hoisted(() => vi.fn());
const validateDimensionsMock = vi.hoisted(() => vi.fn());
const loadProjectionsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: sessionMock,
}));

vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: runWithTenantMock,
}));

vi.mock('@alusa/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/finance')>();
  return {
    ...actual,
    getFinancialOverviewReport: getOverviewMock,
    validateFinancialReportDimensions: validateDimensionsMock,
    loadFinancialReportProjections: loadProjectionsMock,
  };
});

import { GET } from '@/app/api/financeiro/relatorios/overview/route';
import {
  GET as exportReport,
  sanitizeCsvCellValue,
} from '@/app/api/financeiro/relatorios/export/route';

const report = {
  view: 'overview',
  generatedAt: '2026-07-30T12:00:00.000Z',
  timeZone: 'America/Manaus',
  dateBasis: 'DUE_DATE',
  summary: {
    totalCharges: 100,
    received: 0,
    receivable: 0,
    overdue: 100,
    processing: 0,
    fees: 0,
    refunds: 0,
    net: 0,
    toSettle: 0,
    available: 0,
    averageTicket: 0,
    delinquencyRate: 100,
    chargeCount: 1,
    receivedCount: 0,
    overdueCount: 1,
  },
  series: [],
  statusBreakdown: [],
  typeBreakdown: [],
  paymentMethodBreakdown: [],
  rankingByClass: [],
  rankingByPlan: [],
  classOccupancy: [],
  enrollmentSeries: [],
  enrollmentHealth: {
    enrollmentsInPeriod: 0,
    cancellationsInPeriod: 0,
    openingActiveEnrollments: 0,
    activeEnrollments: 0,
    endingSoon: 0,
    overdue: 0,
    retentionRate: 0,
    renewalRate: 0,
  },
  cancellationsByClass: [],
  details: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 },
  dataQuality: { excludedRecords: 0, warnings: [] },
};

describe('GET /api/financeiro/relatorios/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateDimensionsMock.mockResolvedValue(null);
    getOverviewMock.mockResolvedValue(report);
    runWithTenantMock.mockImplementation(async (contaId, callback) =>
      callback({ tenantMarker: contaId }),
    );
  });

  it('rejeita acesso sem sessão', async () => {
    sessionMock.mockResolvedValue(null);
    const response = await GET(
      new NextRequest(
        'http://localhost/api/financeiro/relatorios/overview?startDate=2026-07-01&endDate=2026-07-31',
      ),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'NAO_AUTENTICADO' });
  });

  it('rejeita papel sem permissão financeira', async () => {
    sessionMock.mockResolvedValue({
      user: { id: 'user-a', contaId: 'tenant-a', role: 'PROFESSOR' },
    });
    const response = await GET(
      new NextRequest(
        'http://localhost/api/financeiro/relatorios/overview?startDate=2026-07-01&endDate=2026-07-31',
      ),
    );
    expect(response.status).toBe(403);
  });

  it('deriva o tenant da sessão e executa leitura dentro da transação RLS', async () => {
    sessionMock.mockResolvedValue({
      user: { id: 'user-a', contaId: 'tenant-a', role: 'FINANCEIRO' },
    });
    const response = await GET(
      new NextRequest(
        'http://localhost/api/financeiro/relatorios/overview?startDate=2026-07-01&endDate=2026-07-31&turmaId=turma-a',
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(runWithTenantMock).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(validateDimensionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'tenant-a',
        query: expect.objectContaining({ turmaId: 'turma-a' }),
        db: { tenantMarker: 'tenant-a' },
      }),
    );
    expect(getOverviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ contaId: 'tenant-a', db: { tenantMarker: 'tenant-a' } }),
    );
  });

  it('rejeita dimensão de outro tenant sem consultar o relatório', async () => {
    sessionMock.mockResolvedValue({
      user: { id: 'user-a', contaId: 'tenant-a', role: 'ADMIN' },
    });
    validateDimensionsMock.mockResolvedValue('TURMA_INVALIDA');
    const response = await GET(
      new NextRequest(
        'http://localhost/api/financeiro/relatorios/overview?startDate=2026-07-01&endDate=2026-07-31&turmaId=turma-b',
      ),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'TURMA_INVALIDA' });
    expect(getOverviewMock).not.toHaveBeenCalled();
  });

  it('valida período antes de acessar o banco', async () => {
    sessionMock.mockResolvedValue({
      user: { id: 'user-a', contaId: 'tenant-a', role: 'ADMIN' },
    });
    const response = await GET(
      new NextRequest(
        'http://localhost/api/financeiro/relatorios/overview?startDate=2026-08-01&endDate=2026-07-01',
      ),
    );
    expect(response.status).toBe(422);
    expect(runWithTenantMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/financeiro/relatorios/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateDimensionsMock.mockResolvedValue(null);
  });

  it('gera CSV privado e registra auditoria no mesmo tenant', async () => {
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-a' });
    sessionMock.mockResolvedValue({
      user: { id: 'user-a', contaId: 'tenant-a', role: 'FINANCEIRO' },
    });
    runWithTenantMock.mockImplementation(async (contaId, callback) =>
      callback({ auditLog: { create: auditCreate }, tenantMarker: contaId }),
    );
    loadProjectionsMock.mockResolvedValue({
      timeZone: 'America/Manaus',
      rows: [
        {
          id: 'COBRANCA:c-a',
          sourceId: 'c-a',
          source: 'COBRANCA',
          origin: 'ACADEMIC',
          type: 'MENSALIDADE',
          description: 'Julho',
          status: 'PAID',
          payerId: 'r-a',
          payerName: '=Responsável protegido',
          payerEmail: null,
          payerPhone: null,
          studentId: 'a-a',
          studentName: 'Aluno A',
          matriculaId: 'm-a',
          turmaId: 't-a',
          turmaName: 'Turma A',
          planoId: 'p-a',
          planoName: 'Plano A',
          paymentMethod: 'PIX',
          grossAmount: 100,
          receivedAmount: 100,
          outstandingAmount: 0,
          feeAmount: 2,
          refundedAmount: 0,
          netAmount: 98,
          dueDate: new Date('2026-07-05T04:00:00.000Z'),
          paidAt: new Date('2026-07-05T12:00:00.000Z'),
          settledAt: new Date('2026-07-06T12:00:00.000Z'),
          competenceAt: new Date('2026-07-01T04:00:00.000Z'),
          settlementStatus: 'DISPONIVEL',
          daysOverdue: 0,
        },
      ],
      dataQuality: { excludedRecords: 0, warnings: [] },
    });

    const response = await exportReport(
      new NextRequest(
        'http://localhost/api/financeiro/relatorios/export?view=overview&startDate=2026-07-01&endDate=2026-07-31&search=cpf-sensivel',
      ),
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(csv).toContain("'=Responsável protegido");
    expect(csv).toContain('"100,00";"100,00";"0,00";"2,00";"0,00";"98,00"');
    expect(loadProjectionsMock).toHaveBeenCalledWith(expect.objectContaining({ maxRows: 10_000 }));
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contaId: 'tenant-a',
        actorId: 'user-a',
        action: 'FINANCIAL_REPORT_EXPORTED',
        metadata: expect.objectContaining({ rowCount: 1, format: 'CSV' }),
      }),
    });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('cpf-sensivel');
  });

  it.each([
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@cmd', "'@cmd"],
    ['\t=cmd', "'=cmd"],
    ['\r=cmd', "'=cmd"],
    ['\n=cmd', "'=cmd"],
    ['   =cmd', "'=cmd"],
  ])('neutraliza fórmula CSV após whitespace/controles: %j', (input, expected) => {
    expect(sanitizeCsvCellValue(input)).toBe(expected);
  });
});
