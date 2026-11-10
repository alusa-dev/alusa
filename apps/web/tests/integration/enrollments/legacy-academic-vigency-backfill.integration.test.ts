import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { resetDb } from '../../utils/reset-db';

const hasDb = Boolean(process.env.DATABASE_URL?.startsWith('postgres'));
const describeIf = hasDb ? describe : describe.skip;
const migrationSql = readFileSync(
  resolve(process.cwd(), '../../prisma/migrations/20261105172000_finalize_legacy_vigency_civil_date/migration.sql'),
  'utf8',
);

describeIf('legacy academic vigency data backfill', () => {
  const db = new PrismaClient();

  beforeAll(async () => {
    await resetDb(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('backfills only reached, active enrollments allowed by tenant activation policy and preserves indeterminate classification', async () => {
    const applyCorrectiveMigration = async () => {
      const sectionMarker = "\n\n-- Backfill any links which are eligible under Alusa's established date-only\n-- semantics. Classification remains indeterminate because this proves only\n-- that the contractual start date was reached, not cycle or continuity.\n";
      const [revertStatementWithBegin, backfillStatementWithCommit] = migrationSql.split(sectionMarker);
      if (!revertStatementWithBegin || !backfillStatementWithCommit) throw new Error('Migration SQL sections not found');
      const revertStatement = revertStatementWithBegin.replace(/^\s*BEGIN;\s*/, '');
      const backfillStatement = backfillStatementWithCommit.replace(/\nCOMMIT;\s*$/, '');
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Pacific/Auckland'");
        await tx.$executeRawUnsafe(revertStatement);
        await tx.$executeRawUnsafe(backfillStatement);
      });
    };

    const immediateConta = await db.conta.create({
      data: { nome: 'Legacy vigency immediate', timezone: 'America/Manaus', matriculaActivationPolicy: 'IMMEDIATE' },
    });
    const paymentConta = await db.conta.create({
      data: { nome: 'Legacy vigency payment', timezone: 'Pacific/Kiritimati', matriculaActivationPolicy: 'REQUIRES_PAYMENT' },
    });

    const createLegacyLink = async (input: {
      contaId: string;
      courseName: string;
      status?: 'ATIVA' | 'PAUSADA';
      start: Date;
      fee: number;
      feeStatus: 'PENDENTE' | 'PAGO' | 'ISENTO';
      exempt?: boolean;
    }) => {
      const course = await db.modalidade.create({ data: { contaId: input.contaId, nome: input.courseName } });
      const student = await db.aluno.create({
        data: { contaId: input.contaId, nome: `Student ${input.courseName}`, dataNasc: new Date('2010-01-01T00:00:00.000Z') },
      });
      const enrollment = await db.matricula.create({
        data: {
          contaId: input.contaId,
          alunoId: student.id,
          dataInicio: input.start,
          dataFimContrato: new Date('2100-01-01T00:00:00.000Z'),
          status: input.status ?? 'ATIVA',
          taxaMatricula: new Prisma.Decimal(input.fee),
          taxaStatus: input.feeStatus,
          taxaIsenta: input.exempt ?? false,
        },
      });
      const link = await db.matriculaVinculoAcademico.create({
        data: {
          contaId: input.contaId,
          matriculaId: enrollment.id,
          modalidadeId: course.id,
          classificacao: 'HISTORICO_INDETERMINADO',
          classificacaoMotivo: 'HISTORICO_PRE_MIGRACAO_NAO_RECONSTRUIDO',
        },
      });
      return { enrollment, link };
    };

    const reached = new Date('2020-02-03T12:00:00.000Z');
    const future = new Date('2099-02-03T12:00:00.000Z');
    const immediateUnpaid = await createLegacyLink({ contaId: immediateConta.id, courseName: 'Immediate unpaid', start: reached, fee: 35, feeStatus: 'PENDENTE' });
    const paidFee = await createLegacyLink({ contaId: paymentConta.id, courseName: 'Payment paid', start: reached, fee: 35, feeStatus: 'PAGO' });
    const exemptFee = await createLegacyLink({ contaId: paymentConta.id, courseName: 'Payment exempt', start: reached, fee: 35, feeStatus: 'PENDENTE', exempt: true });
    const noFee = await createLegacyLink({ contaId: paymentConta.id, courseName: 'Payment no fee', start: reached, fee: 0, feeStatus: 'PENDENTE' });
    const unpaidFee = await createLegacyLink({ contaId: paymentConta.id, courseName: 'Payment unpaid', start: reached, fee: 35, feeStatus: 'PENDENTE' });
    const futureStart = await createLegacyLink({ contaId: immediateConta.id, courseName: 'Future start', start: future, fee: 0, feeStatus: 'ISENTO' });
    const notActive = await createLegacyLink({ contaId: immediateConta.id, courseName: 'Paused', status: 'PAUSADA', start: reached, fee: 0, feeStatus: 'ISENTO' });
    const localDateParts = new Map(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    const nextTenantDateAtUtcMidnight = new Date(Date.UTC(
      Number(localDateParts.get('year')),
      Number(localDateParts.get('month')) - 1,
      Number(localDateParts.get('day')) + 1,
    ));
    const previouslyBackfilledEarly = await createLegacyLink({
      contaId: immediateConta.id,
      courseName: 'UTC civil date future boundary',
      start: nextTenantDateAtUtcMidnight,
      fee: 0,
      feeStatus: 'ISENTO',
    });
    const priorMigrationAuditId = 'legacy-vigency-' + createHash('md5')
      .update(immediateConta.id + ':' + previouslyBackfilledEarly.link.id + ':declared-start-v1')
      .digest('hex');
    await db.matriculaVinculoAcademico.update({
      where: { id: previouslyBackfilledEarly.link.id },
      data: { vigenciaIniciadaEm: previouslyBackfilledEarly.enrollment.dataInicio },
    });
    await db.matriculaVinculoAcademicoAudit.create({
      data: {
        id: priorMigrationAuditId,
        contaId: immediateConta.id,
        vinculoAcademicoId: previouslyBackfilledEarly.link.id,
        vigenciaIniciadaEmAnterior: null,
        vigenciaIniciadaEmNova: previouslyBackfilledEarly.enrollment.dataInicio,
        motivo: 'LEGACY_VIGENCIA_RECONHECIDA_DATA_INICIO_DECLARADA; CLASSIFICACAO_PRESERVADA_INDETERMINADA',
        autorId: 'SYSTEM_LEGACY_VIGENCIA_BACKFILL',
      },
    });

    await applyCorrectiveMigration();

    const links = await db.matriculaVinculoAcademico.findMany({
      where: { id: { in: [immediateUnpaid.link.id, paidFee.link.id, exemptFee.link.id, noFee.link.id, unpaidFee.link.id, futureStart.link.id, notActive.link.id, previouslyBackfilledEarly.link.id] } },
      select: { id: true, vigenciaIniciadaEm: true, classificacao: true },
    });
    const byId = new Map(links.map((link) => [link.id, link]));
    for (const candidate of [immediateUnpaid, paidFee, exemptFee, noFee]) {
      expect(byId.get(candidate.link.id)?.vigenciaIniciadaEm?.toISOString()).toBe(candidate.enrollment.dataInicio.toISOString());
      expect(byId.get(candidate.link.id)?.classificacao).toBe('HISTORICO_INDETERMINADO');
    }
    for (const candidate of [unpaidFee, futureStart, notActive, previouslyBackfilledEarly]) {
      expect(byId.get(candidate.link.id)?.vigenciaIniciadaEm).toBeNull();
    }

    const firstAuditCount = await db.matriculaVinculoAcademicoAudit.count({
      where: { autorId: { in: ['SYSTEM_LEGACY_VIGENCIA_BACKFILL', 'SYSTEM_LEGACY_VIGENCIA_CIVIL_DATE_CORRECTION'] } },
    });
    expect(firstAuditCount).toBe(6);
    const audits = await db.matriculaVinculoAcademicoAudit.findMany({
      where: { vinculoAcademicoId: { in: [immediateUnpaid.link.id, paidFee.link.id, exemptFee.link.id, noFee.link.id] } },
      select: { vigenciaIniciadaEmNova: true, motivo: true, autorId: true },
    });
    expect(audits).toHaveLength(4);
    expect(audits.every((audit) => audit.motivo.includes('DATA_CIVIL_UTC') && audit.autorId === 'SYSTEM_LEGACY_VIGENCIA_CIVIL_DATE_CORRECTION')).toBe(true);
    expect(audits.map((audit) => audit.vigenciaIniciadaEmNova?.toISOString()).sort()).toEqual(
      [immediateUnpaid, paidFee, exemptFee, noFee].map((item) => item.enrollment.dataInicio.toISOString()).sort(),
    );
    const correction = await db.matriculaVinculoAcademicoAudit.findFirst({
      where: { vinculoAcademicoId: previouslyBackfilledEarly.link.id, autorId: 'SYSTEM_LEGACY_VIGENCIA_CIVIL_DATE_CORRECTION' },
      select: { vigenciaIniciadaEmAnterior: true, vigenciaIniciadaEmNova: true, motivo: true },
    });
    expect(correction).toMatchObject({
      vigenciaIniciadaEmAnterior: previouslyBackfilledEarly.enrollment.dataInicio,
      vigenciaIniciadaEmNova: null,
      motivo: 'LEGACY_VIGENCIA_REVERTIDA_DATA_CIVIL_UTC_AINDA_FUTURA_NO_TIMEZONE_DA_CONTA',
    });

    await applyCorrectiveMigration();
    expect(await db.matriculaVinculoAcademicoAudit.count({
      where: { autorId: { in: ['SYSTEM_LEGACY_VIGENCIA_BACKFILL', 'SYSTEM_LEGACY_VIGENCIA_CIVIL_DATE_CORRECTION'] } },
    })).toBe(firstAuditCount);
  });
});
