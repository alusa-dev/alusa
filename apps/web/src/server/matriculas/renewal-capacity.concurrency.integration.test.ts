import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { resetDb } from '../../../tests/utils/reset-db';

vi.mock('@/src/server/platform-billing/capacity', () => ({
  assertStudentCapacity: vi.fn().mockResolvedValue(undefined),
}));

import {
  confirmRenewalProcess,
  previewRenewalProcess,
  type ConfirmRenewalProcessInput,
  type RenewalProcessInput,
} from './renewal-process.service';

const hasDb = !!process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres');
const describeIf = hasDb ? describe : describe.skip;

describeIf('renewal capacity concurrency', () => {
  const db = new PrismaClient();
  const effectiveAt = new Date('2027-02-01T00:00:00.000Z');

  let contaId: string;
  let turmaId: string;
  let planoId: string;
  let responsavelId: string;
  let sourceEnrollmentIds: string[];

  beforeAll(async () => {
    await resetDb(db);

    const conta = await db.conta.create({ data: { nome: 'Conta Concorrência' } });
    contaId = conta.id;

    const modalidade = await db.modalidade.create({
      data: { contaId, nome: 'Modalidade Concorrência' },
    });
    const sala = await db.sala.create({
      data: { contaId, nome: 'Sala Concorrência', capacidade: 30 },
    });
    const turma = await db.turma.create({
      data: {
        contaId,
        nome: 'Turma com última vaga',
        modalidadeId: modalidade.id,
        salaId: sala.id,
        diasSemana: ['SEGUNDA'],
        horaInicio: '08:00',
        horaFim: '09:00',
        capacidade: 1,
      },
    });
    turmaId = turma.id;

    const plano = await db.plano.create({
      data: { contaId, nome: 'Plano Concorrência', valor: new Prisma.Decimal('100.00') },
    });
    planoId = plano.id;

    const responsavel = await db.responsavel.create({
      data: {
        contaId,
        nome: 'Responsável Concorrência',
        cpf: '11111111111',
        email: 'concorrencia@example.com',
        telefone: '92999999999',
        financeiro: true,
      },
    });
    responsavelId = responsavel.id;

    const students = await Promise.all([
      db.aluno.create({
        data: { contaId, nome: 'Aluno Concorrente 1', dataNasc: new Date('2010-01-01') },
      }),
      db.aluno.create({
        data: { contaId, nome: 'Aluno Concorrente 2', dataNasc: new Date('2011-01-01') },
      }),
    ]);

    sourceEnrollmentIds = await Promise.all(
      students.map(async (student, index) => {
        const enrollment = await db.matricula.create({
          data: {
            contaId,
            alunoId: student.id,
            responsavelFinanceiroId: responsavel.id,
            planoId,
            dataInicio: new Date('2026-01-01T00:00:00.000Z'),
            dataFimContrato: new Date('2027-01-31T00:00:00.000Z'),
            status: 'ATIVA',
            statusFinanceiro: 'ADIMPLENTE',
            statusContrato: 'ATIVO',
            taxaMatricula: new Prisma.Decimal(0),
            taxaIsenta: true,
            formaPagamento: 'PIX',
            formaPagamentoTaxa: 'PIX',
            vencimentoDia: 10,
            uiRequestId: `renewal-concurrency-source-${index}`,
          },
        });
        return enrollment.id;
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('permite somente uma confirmação quando duas requisições disputam a última vaga', async () => {
    const buildInput = (sourceEnrollmentId: string, index: number): RenewalProcessInput => ({
      contaId,
      actorId: `actor-${index}`,
      origin: 'STANDALONE',
      targetPeriodId: '2027',
      holderType: 'RESPONSIBLE',
      holderId: responsavelId,
      effectiveAt,
      targetContractEndsAt: new Date('2028-01-31T00:00:00.000Z'),
      items: [
        {
          decision: 'RENEW',
          sourceEnrollmentId,
          target: { type: 'CLASS', targetId: turmaId, planId: planoId },
        },
      ],
      financialTerms: {
        paymentMethod: 'PIX',
        enrollmentFeePaymentMethod: 'PIX',
        dueDay: 10,
        enrollmentFeeAmount: 0,
        enrollmentFeeExempt: true,
        feeChargeMoment: 'EXEMPT',
        feeUnit: 'NO_FEE',
      },
    });

    const firstInput = buildInput(sourceEnrollmentIds[0]!, 1);
    const secondInput = buildInput(sourceEnrollmentIds[1]!, 2);
    const [firstPreview, secondPreview] = await Promise.all([
      previewRenewalProcess(firstInput, { prisma: db }),
      previewRenewalProcess(secondInput, { prisma: db }),
    ]);
    expect(firstPreview.blockers).toHaveLength(0);
    expect(secondPreview.blockers).toHaveLength(0);

    const buildConfirmation = (
      input: RenewalProcessInput,
      preview: Awaited<ReturnType<typeof previewRenewalProcess>>,
      index: number,
    ): ConfirmRenewalProcessInput => ({
      ...input,
      previewHash: preview.previewHash,
      sourceVersion: preview.sourceVersion,
      idempotencyKey: `renewal-concurrency-${index}`,
    });

    const results = await Promise.allSettled([
      confirmRenewalProcess(buildConfirmation(firstInput, firstPreview, 1), { prisma: db }),
      confirmRenewalProcess(buildConfirmation(secondInput, secondPreview, 2), { prisma: db }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejectionIndex = results.findIndex((result) => result.status === 'rejected');
    const rejection = results[rejectionIndex];
    expect(rejection).toMatchObject({ status: 'rejected' });

    if (rejection?.status === 'rejected' && rejection.reason?.message === 'PREVIEW_DESATUALIZADO') {
      const loserInput = rejectionIndex === 0 ? firstInput : secondInput;
      const retryPreview = await previewRenewalProcess(loserInput, { prisma: db });
      expect(retryPreview.blockers).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'TARGET_CLASS_FULL' })]),
      );
    } else {
      expect(rejection).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ message: expect.stringContaining('não possui vagas') }),
      });
    }

    await expect(
      db.reservaVagaFutura.count({
        where: { contaId, targetClassId: turmaId, targetPeriodId: '2027', status: 'RESERVED' },
      }),
    ).resolves.toBe(1);
  }, 30_000);
});
