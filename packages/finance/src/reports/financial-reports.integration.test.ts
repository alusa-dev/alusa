import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';
import { afterAll, describe, expect, it } from 'vitest';

import {
  financialReportQuerySchema,
  getDelinquencyReport,
  getFinancialOverviewReport,
  getFinancialReportFilterOptions,
  getReceiptsReport,
  loadFinancialReportProjections,
} from './financial-reports';

const contaIds: string[] = [];

function assertTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (
    process.env.NODE_ENV !== 'test' ||
    !/(_test|test_)/i.test(databaseUrl)
  ) {
    throw new Error(
      'Teste de integração de relatórios requer DATABASE_URL de teste.',
    );
  }
}

async function cleanup() {
  if (contaIds.length === 0) return;
  const where = { contaId: { in: contaIds } };
  await prisma.$transaction([
    prisma.pagamento.deleteMany({ where }),
    prisma.cobranca.deleteMany({ where }),
    prisma.matricula.deleteMany({ where }),
    prisma.turma.deleteMany({ where }),
    prisma.plano.deleteMany({ where }),
    prisma.aluno.deleteMany({ where }),
    prisma.modalidade.deleteMany({ where }),
    prisma.sala.deleteMany({ where }),
    prisma.conta.deleteMany({ where: { id: { in: contaIds } } }),
  ]);
  contaIds.length = 0;
}

async function createTenantFixture(label: 'A' | 'B', amount: number) {
  const suffix = randomUUID();
  const contaId = `reports-it-conta-${label}-${suffix}`;
  contaIds.push(contaId);
  const sentinel = `REPORTS_SENTINEL_${label}_${suffix}`;
  const conta = await prisma.conta.create({
    data: { id: contaId, nome: sentinel },
  });
  const modalidade = await prisma.modalidade.create({
    data: { contaId, nome: `${sentinel}_MODALIDADE` },
  });
  const sala = await prisma.sala.create({
    data: { contaId, nome: `${sentinel}_SALA`, capacidade: 20 },
  });
  const turma = await prisma.turma.create({
    data: {
      contaId,
      nome: `${sentinel}_TURMA`,
      modalidadeId: modalidade.id,
      salaId: sala.id,
      diasSemana: ['SEGUNDA'],
      horaInicio: '08:00',
      horaFim: '09:00',
      capacidade: 20,
    },
  });
  const plano = await prisma.plano.create({
    data: { contaId, nome: `${sentinel}_PLANO`, valor: amount },
  });
  const aluno = await prisma.aluno.create({
    data: {
      contaId,
      nome: `${sentinel}_ALUNO`,
      dataNasc: new Date('2015-01-01T12:00:00.000Z'),
    },
  });
  const matricula = await prisma.matricula.create({
    data: {
      contaId,
      alunoId: aluno.id,
      turmaId: turma.id,
      planoId: plano.id,
      dataInicio: new Date('2026-01-01T12:00:00.000Z'),
      dataFimContrato: new Date('2026-12-31T12:00:00.000Z'),
      taxaMatricula: 0,
    },
  });
  const overdue = await prisma.cobranca.create({
    data: {
      contaId,
      matriculaId: matricula.id,
      descricao: `${sentinel}_ATRASADA`,
      competenciaInicio: new Date('2026-07-01T12:00:00.000Z'),
      competenciaFim: new Date('2026-07-31T12:00:00.000Z'),
      valor: amount,
      valorFinal: amount,
      vencimento: new Date('2026-07-05T12:00:00.000Z'),
      formaPagamento: 'BOLETO',
      status: 'ATRASADO',
    },
  });
  const paid = await prisma.cobranca.create({
    data: {
      contaId,
      matriculaId: matricula.id,
      descricao: `${sentinel}_PAGA`,
      competenciaInicio: new Date('2026-07-01T12:00:00.000Z'),
      competenciaFim: new Date('2026-07-31T12:00:00.000Z'),
      valor: amount,
      valorFinal: amount,
      vencimento: new Date('2026-07-06T12:00:00.000Z'),
      dataPagamento: new Date('2026-07-10T12:00:00.000Z'),
      pagoEm: new Date('2026-07-10T12:00:00.000Z'),
      formaPagamento: 'PIX',
      pagoPor: 'PIX',
      status: 'PAGO',
    },
  });
  return { conta, turma, plano, overdue, paid, sentinel, amount };
}

afterAll(async () => {
  await cleanup();
});

describe('financial reports tenant isolation (Prisma real)', () => {
  it('isola overview, inadimplência, recebimentos, opções e fonte de exportação', async () => {
    assertTestDatabase();
    await cleanup();
    try {
      const tenantA = await createTenantFixture('A', 100);
      const tenantB = await createTenantFixture('B', 999);
      const query = financialReportQuerySchema.parse({
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      const context = {
        contaId: tenantA.conta.id,
        query,
        db: prisma as never,
        now: new Date('2026-07-30T12:00:00.000Z'),
      };

      const overview = await getFinancialOverviewReport(context);
      const delinquency = await getDelinquencyReport(context);
      const receipts = await getReceiptsReport({
        ...context,
        query: { ...query, dateBasis: 'PAID_AT' },
      });
      const options = await getFinancialReportFilterOptions({
        contaId: tenantA.conta.id,
        db: prisma as never,
      });
      const exportSource = await loadFinancialReportProjections({
        ...context,
        maxRows: 10_000,
      });

      expect(overview.summary.totalCharges).toBe(200);
      expect(overview.details.items).toHaveLength(2);
      expect(delinquency.summary.overdue).toBe(100);
      expect(delinquency.details.items).toHaveLength(1);
      expect(receipts.summary.received).toBe(100);
      expect(receipts.details.items.map((item) => item.sourceId)).toEqual([
        tenantA.paid.id,
      ]);
      expect(options.turmas).toEqual([
        { id: tenantA.turma.id, nome: `${tenantA.sentinel}_TURMA` },
      ]);
      expect(options.planos).toEqual([
        { id: tenantA.plano.id, nome: `${tenantA.sentinel}_PLANO` },
      ]);
      expect(exportSource.rows.map((row) => row.sourceId).sort()).toEqual(
        [tenantA.overdue.id, tenantA.paid.id].sort(),
      );

      const serialized = JSON.stringify({
        overview,
        delinquency,
        receipts,
        options,
        exportSource,
      });
      expect(serialized).not.toContain(tenantB.conta.id);
      expect(serialized).not.toContain(tenantB.turma.id);
      expect(serialized).not.toContain(tenantB.plano.id);
      expect(serialized).not.toContain(tenantB.sentinel);
      expect(serialized).not.toContain('999');
    } finally {
      await cleanup();
    }
  });
});
