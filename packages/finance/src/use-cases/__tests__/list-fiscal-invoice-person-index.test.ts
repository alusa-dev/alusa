import { describe, expect, it, vi, beforeEach } from 'vitest';

import { listFiscalInvoicePersonIndex } from '../list-fiscal-invoice-person-index';

const invoiceFindMany = vi.fn();
const matriculaFindMany = vi.fn();
const chargeFindMany = vi.fn();
const alunoFindMany = vi.fn();
const responsavelFindMany = vi.fn();
const settingsFindUnique = vi.fn();

vi.mock('../../fiscal/fiscal-prisma', () => ({
  getFiscalPrisma: () => ({
    invoice: { findMany: invoiceFindMany },
    matricula: { findMany: matriculaFindMany },
    charge: { findMany: chargeFindMany },
    aluno: { findMany: alunoFindMany },
    responsavel: { findMany: responsavelFindMany },
    contaFiscalSettings: { findUnique: settingsFindUnique },
  }),
}));

describe('listFiscalInvoicePersonIndex', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    settingsFindUnique.mockResolvedValue({
      readinessStatus: 'READY',
      readinessIssues: [],
    });
  });

  it('agrupa notas pelo cliente responsável quando houver responsavelId', async () => {
    invoiceFindMany.mockResolvedValueOnce([
      {
        id: 'inv-1',
        chargeId: 'charge-1',
        matriculaId: 'mat-1',
        responsavelId: 'resp-1',
        status: 'AUTHORIZED',
        value: 100,
        effectiveDate: new Date('2026-01-10T00:00:00.000Z'),
        statusUpdatedAt: new Date('2026-01-10T00:00:00.000Z'),
      },
    ]);
    matriculaFindMany.mockResolvedValueOnce([{ id: 'mat-1', alunoId: 'aluno-1' }]);
    chargeFindMany.mockResolvedValueOnce([]);
    alunoFindMany.mockResolvedValueOnce([]);
    responsavelFindMany.mockResolvedValueOnce([
      { id: 'resp-1', nome: 'Maria Silva', cpf: '123', foto: null },
    ]);

    const result = await listFiscalInvoicePersonIndex({
      contaId: 'conta-1',
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      id: 'resp-1',
      tipo: 'RESPONSAVEL',
      nome: 'Maria Silva',
      totalNotas: 1,
    });
  });

  it('agrupa notas avulsas pelo customer da cobrança', async () => {
    invoiceFindMany.mockResolvedValueOnce([
      {
        id: 'inv-standalone',
        chargeId: 'charge-2',
        matriculaId: null,
        responsavelId: null,
        status: 'AUTHORIZED',
        value: 50,
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    matriculaFindMany.mockResolvedValueOnce([]);
    chargeFindMany.mockResolvedValueOnce([
      {
        id: 'charge-2',
        customer: { payerType: 'ALUNO', payerId: 'aluno-2' },
      },
    ]);
    alunoFindMany.mockResolvedValueOnce([
      { id: 'aluno-2', nome: 'João Souza', cpf: '456', foto: null },
    ]);
    responsavelFindMany.mockResolvedValueOnce([]);

    const result = await listFiscalInvoicePersonIndex({
      contaId: 'conta-1',
      page: 1,
      pageSize: 20,
    });

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'aluno-2',
        tipo: 'ALUNO',
        nome: 'João Souza',
        totalNotas: 1,
      }),
    ]);
  });

  it('ignora notas sem cliente resolvível', async () => {
    invoiceFindMany.mockResolvedValueOnce([
      {
        id: 'inv-orphan',
        chargeId: 'charge-3',
        matriculaId: null,
        responsavelId: null,
        status: 'AUTHORIZED',
        value: 50,
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    matriculaFindMany.mockResolvedValueOnce([]);
    chargeFindMany.mockResolvedValueOnce([{ id: 'charge-3', customer: null }]);
    alunoFindMany.mockResolvedValueOnce([]);
    responsavelFindMany.mockResolvedValueOnce([]);

    const result = await listFiscalInvoicePersonIndex({
      contaId: 'conta-1',
      page: 1,
      pageSize: 20,
    });

    expect(result.data).toEqual([]);
  });
});
