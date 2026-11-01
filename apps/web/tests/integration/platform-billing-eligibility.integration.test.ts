import { randomUUID } from 'node:crypto';
import { PrismaClient, type PeriodicidadePlano } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { runWithTenant } from '@/lib/prisma-tenant';
import {
  countActivePlatformBillingStudents,
  PlatformBillingHistoricalCountInconclusive,
} from '@/src/server/platform-billing/platform-billing-server';

const isSafeTestDatabase = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    return ['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase())
      && ['localhost', '127.0.0.1', '::1'].includes(host)
      && (name === 'alusa_test' || name.startsWith('alusa_test_'));
  } catch {
    return false;
  }
})();
const prisma = isSafeTestDatabase ? new PrismaClient() : null;

afterAll(async () => prisma?.$disconnect());

describe.skipIf(!isSafeTestDatabase)('platform billing eligibility PostgreSQL query', () => {
  it('counts distinct billable students across cadence, contract, discount, and historical boundaries', async () => {
    const db = prisma as PrismaClient;
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `pb_eligibility_${suffix}`;
    const otherContaId = `pb_other_${suffix}`;
    const billingAccountId = `pba_${suffix}`;
    const asOf = new Date('2026-09-30T23:59:59.999Z');
    const historyTimestamp = new Date('2026-06-01T12:00:00.000Z');
    const students = new Set<string>();
    const plans = new Set<string>();
    const combos = new Set<string>();
    const enrollmentIds = new Set<string>();
    let discountId: string | undefined;

    await db.conta.create({ data: { id: contaId, nome: 'Eligibility integration fixture', timezone: 'America/Manaus', createdAt: historyTimestamp, updatedAt: historyTimestamp } });
    await db.conta.create({ data: { id: otherContaId, nome: 'Eligibility other tenant fixture', createdAt: historyTimestamp, updatedAt: historyTimestamp } });
    await db.platformBillingAccount.create({
      data: {
        id: billingAccountId,
        contaId,
        environment: 'TEST',
        status: 'ACTIVE',
        accessStatus: 'ACTIVE',
        planCode: 'BAND_001_025',
        createdAt: historyTimestamp,
        updatedAt: historyTimestamp,
      },
    });
    await db.auditLog.create({
      data: {
        contaId,
        actorType: 'SYSTEM',
        action: 'PLATFORM_BILLING_ELIGIBILITY_HISTORY_TRACKING_STARTED',
        entityType: 'Conta',
        entityId: contaId,
        createdAt: historyTimestamp,
      },
    });
    const otherBillingAccountId = `pba_other_${suffix}`;
    await db.platformBillingAccount.create({
      data: {
        id: otherBillingAccountId,
        contaId: otherContaId,
        environment: 'TEST',
        status: 'ACTIVE',
        accessStatus: 'ACTIVE',
        planCode: 'BAND_001_025',
        createdAt: historyTimestamp,
        updatedAt: historyTimestamp,
      },
    });

    const createStudent = async (name: string, status: 'ATIVO' | 'INATIVO' = 'ATIVO', dataInativacao?: Date) => {
      const id = `al_${name}_${suffix}`;
      students.add(id);
      await db.aluno.create({
        data: {
          id, contaId, nome: name, dataNasc: new Date('2010-01-01T12:00:00Z'), status,
          dataInativacao, createdAt: historyTimestamp, updatedAt: historyTimestamp,
        },
      });
      return id;
    };
    const createPlan = async (name: string, periodicidade: PeriodicidadePlano, valor = 100) => {
      const id = `pl_${name}_${suffix}`;
      plans.add(id);
      await db.plano.create({ data: { id, contaId, nome: `${name}-${suffix}`, periodicidade, valor, createdAt: historyTimestamp, updatedAt: historyTimestamp } });
      return id;
    };
    const createEnrollment = async (input: {
      name: string;
      planId?: string;
      comboId?: string;
      status?: 'ATIVA' | 'PAUSADA' | 'ENCERRADA' | 'CANCELADA';
      start?: Date;
      end?: Date | null;
      contractEnd?: Date;
      cancelledAt?: Date | null;
      pauseStart?: Date | null;
      chargeDuringPause?: boolean;
    }) => {
      const id = `mat_${input.name}_${suffix}`;
      enrollmentIds.add(id);
      const alunoId = await createStudent(input.name);
      await db.matricula.create({
        data: {
          id, contaId, alunoId, planoId: input.planId, comboId: input.comboId,
          dataInicio: input.start ?? new Date('2026-09-01T12:00:00Z'),
          dataFim: input.end === undefined ? null : input.end,
          dataFimContrato: input.contractEnd ?? new Date('2026-12-31T23:59:59Z'),
          status: input.status ?? 'ATIVA', taxaMatricula: 0,
          cancelledAt: input.cancelledAt, dataInicioPausa: input.pauseStart,
          cobrarDurantePausa: input.chargeDuringPause ?? false,
          createdAt: historyTimestamp, updatedAt: historyTimestamp,
        },
      });
      return { id, alunoId };
    };

    try {
      const cadences: PeriodicidadePlano[] = ['MENSAL', 'SEMANAL', 'QUINZENAL', 'TRIMESTRAL', 'ANUAL'];
      const cadencePlanIds = await Promise.all(cadences.map((cadence, index) => createPlan(`cadence${index}`, cadence)));
      let firstCadenceEnrollmentId = '';
      for (const [index, planId] of cadencePlanIds.entries()) {
        const enrollment = await createEnrollment({ name: `cadence${index}`, planId });
        if (index === 0) firstCadenceEnrollmentId = enrollment.id;
      }
      await db.matricula.update({
        where: { id: firstCadenceEnrollmentId },
        data: { dataInicio: new Date('2026-08-01T12:00:00Z'), updatedAt: historyTimestamp },
      });

      const duplicatePlan = await createPlan('duplicate', 'MENSAL');
      const duplicate = await createEnrollment({ name: 'duplicate', planId: duplicatePlan });
      await db.matricula.create({
        data: {
          id: `mat_duplicate_second_${suffix}`, contaId, alunoId: duplicate.alunoId, planoId: duplicatePlan,
          dataInicio: new Date('2026-09-01T12:00:00Z'), dataFimContrato: new Date('2026-12-31T23:59:59Z'),
          status: 'ATIVA', taxaMatricula: 0, createdAt: historyTimestamp, updatedAt: historyTimestamp,
        },
      });
      enrollmentIds.add(`mat_duplicate_second_${suffix}`);

      const nonBillablePlan = await createPlan('zero-value', 'MENSAL', 0);
      await createEnrollment({ name: 'zero-value', planId: nonBillablePlan });

      const fullPricePlan = await createPlan('discount', 'MENSAL', 100);
      const discount = await db.desconto.create({
        data: { contaId, nome: `scholarship-${suffix}`, tipo: 'VALOR', valor: 100, escopo: 'MATRICULA', createdAt: historyTimestamp, updatedAt: historyTimestamp },
      });
      discountId = discount.id;
      const partial = await createEnrollment({ name: 'partial-discount', planId: fullPricePlan });
      const full = await createEnrollment({ name: 'full-discount', planId: fullPricePlan });
      await db.descontoMatricula.createMany({ data: [
        { matriculaId: partial.id, descontoId: discount.id, valorFinal: 25, createdAt: historyTimestamp },
        { matriculaId: full.id, descontoId: discount.id, valorFinal: 100, createdAt: historyTimestamp },
      ] });

      const planUnderBundle = await createPlan('bundle-base', 'MENSAL', 0);
      const comboId = `combo_${suffix}`;
      combos.add(comboId);
      await db.combo.create({ data: { id: comboId, contaId, nome: `bundle-${suffix}`, valor: 100, periodicidade: 'ANUAL', createdAt: historyTimestamp, updatedAt: historyTimestamp } });
      await createEnrollment({ name: 'bundle', planId: planUnderBundle, comboId });

      await createEnrollment({ name: 'prepaid-active', planId: fullPricePlan, contractEnd: new Date('2027-12-31T23:59:59Z') });
      await createEnrollment({ name: 'future', planId: fullPricePlan, start: new Date('2026-10-01T00:00:00Z') });
      await createEnrollment({ name: 'ended', planId: fullPricePlan, status: 'ENCERRADA', end: new Date('2026-09-29T23:59:59Z') });
      await createEnrollment({ name: 'canceled-after', planId: fullPricePlan, status: 'CANCELADA', cancelledAt: new Date('2026-10-02T12:00:00Z') });
      await createEnrollment({ name: 'canceled-before', planId: fullPricePlan, status: 'CANCELADA', cancelledAt: new Date('2026-09-20T12:00:00Z') });
      await createEnrollment({ name: 'paused-billable', planId: fullPricePlan, status: 'PAUSADA', pauseStart: new Date('2026-09-20T12:00:00Z'), chargeDuringPause: true });
      await createEnrollment({ name: 'paused-nonbillable', planId: fullPricePlan, status: 'PAUSADA', pauseStart: new Date('2026-09-20T12:00:00Z'), chargeDuringPause: false });
      const inactiveId = await createStudent('inactive-after', 'INATIVO', new Date('2026-10-02T12:00:00Z'));
      const inactiveEnrollment = await db.matricula.create({
        data: { contaId, alunoId: inactiveId, planoId: fullPricePlan, dataInicio: new Date('2026-09-01T12:00:00Z'), dataFimContrato: new Date('2026-12-31T23:59:59Z'), status: 'ATIVA', taxaMatricula: 0, createdAt: historyTimestamp, updatedAt: historyTimestamp },
      });
      enrollmentIds.add(inactiveEnrollment.id);

      // Foreign-tenant enrollment and records must never affect this tenant's count.
      const otherPlanId = `pl_other_${suffix}`;
      await db.plano.create({ data: { id: otherPlanId, contaId: otherContaId, nome: `other-${suffix}`, periodicidade: 'MENSAL', valor: 100, createdAt: historyTimestamp, updatedAt: historyTimestamp } });
      await db.aluno.create({ data: { id: `al_other_${suffix}`, contaId: otherContaId, nome: 'Other tenant', dataNasc: new Date('2010-01-01T12:00:00Z'), createdAt: historyTimestamp, updatedAt: historyTimestamp } });
      await db.matricula.create({ data: { contaId: otherContaId, alunoId: `al_other_${suffix}`, planoId: otherPlanId, dataInicio: new Date('2026-09-01T12:00:00Z'), dataFimContrato: new Date('2026-12-31T23:59:59Z'), taxaMatricula: 0, createdAt: historyTimestamp, updatedAt: historyTimestamp } });

      const historicalCount = await runWithTenant(contaId, (tx) => countActivePlatformBillingStudents({ tx, contaId, asOf }));
      // Five cadences + one distinct duplicate student + partial discount + bundle + prepaid + future-canceled + billed pause + student inactive after cutoff.
      expect(historicalCount).toBe(12);

      // Current count excludes historical-only terminal/pause/inactive states and date boundaries.
      const currentCount = await runWithTenant(contaId, (tx) => countActivePlatformBillingStudents({ tx, contaId }));
      expect(currentCount).toBe(10);

      const recoverableIssueFingerprint = `TEST:${contaId}:monthly-close-inconclusive:2026-09-01`;
      await db.platformBillingIssue.create({
        data: {
          contaId,
          billingAccountId,
          environment: 'TEST',
          severity: 'WARNING',
          status: 'OPEN',
          code: 'MONTHLY_CLOSE_INCONCLUSIVE',
          title: 'Missed close fixture',
          message: 'The original competence was missed.',
          fingerprint: recoverableIssueFingerprint,
          details: { periodStart: '2026-09-01', reason: 'MISSED_CLOSE_WINDOW', automaticPricing: false },
        },
      });

      const closeInput = { prisma: db, environment: 'TEST' as const, now: new Date('2026-10-27T12:00:00.000Z'), limit: 500 };
      const { capturePlatformBillingMonthlySnapshots } = await vi.importActual<typeof import('@/src/server/platform-billing/monthly-snapshots')>(
        '@/src/server/platform-billing/monthly-snapshots',
      );
      const [recovery, concurrentRetry] = await Promise.all([
        capturePlatformBillingMonthlySnapshots(closeInput),
        capturePlatformBillingMonthlySnapshots(closeInput),
      ]);
      expect(recovery.recovered + concurrentRetry.recovered).toBe(1);
      expect(recovery.transitionsScheduled + concurrentRetry.transitionsScheduled).toBe(0);
      const recoveredSnapshot = await db.platformBillingMonthlySnapshot.findUniqueOrThrow({
        where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId, environment: 'TEST', periodStart: new Date('2026-09-01T00:00:00.000Z') } },
      });
      expect(recoveredSnapshot).toMatchObject({ studentCount: 12, candidateBand: 'BAND_001_025', isRecovered: true, customQuantitySyncStatus: null });
      expect(await db.platformBillingMonthlySnapshot.count({
        where: { contaId, environment: 'TEST', periodStart: new Date('2026-09-01T00:00:00.000Z') },
      })).toBe(1);
      expect(await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint: recoverableIssueFingerprint } },
      })).toMatchObject({ status: 'RESOLVED' });
      expect(await db.platformBillingAuditLog.count({
        where: { contaId, action: 'PLATFORM_BILLING_MONTHLY_SNAPSHOT_RECOVERED', entityId: '2026-09-01' },
      })).toBe(1);
      const untrackedTenantIssue = `TEST:${otherContaId}:monthly-close-inconclusive:2026-09-01`;
      const otherTenantIssue = await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint: untrackedTenantIssue } },
      });
      // Tenant pagination can defer this account to a later cron page. If it
      // was processed, its own irrecoverable pre-coverage gap is terminalized.
      if (otherTenantIssue.status === 'IGNORED') {
        expect(otherTenantIssue.details).toMatchObject({
          reason: 'HISTORICAL_COVERAGE_UNAVAILABLE',
          resolution: 'closed without recalculation due to missing historical evidence',
          automaticPricing: false,
        });
      } else {
        expect(otherTenantIssue).toMatchObject({ status: 'OPEN', details: { reason: 'MISSED_CLOSE_WINDOW' } });
      }
      expect(await db.platformBillingMonthlySnapshot.findUnique({
        where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId: otherContaId, environment: 'TEST', periodStart: new Date('2026-09-01T00:00:00.000Z') } },
      })).toBeNull();

      const inconclusiveIssueFingerprint = `TEST:${contaId}:monthly-close-inconclusive:2026-08-01`;
      await db.platformBillingIssue.create({
        data: {
          contaId, billingAccountId, environment: 'TEST', severity: 'WARNING', status: 'OPEN',
          code: 'MONTHLY_CLOSE_INCONCLUSIVE', title: 'Historical gap fixture',
          message: 'Changed source data cannot prove this competence.', fingerprint: inconclusiveIssueFingerprint,
          details: { periodStart: '2026-08-01', reason: 'MISSED_CLOSE_WINDOW', automaticPricing: false },
        },
      });
      await db.$executeRaw`UPDATE "Plano" SET "updatedAt" = ${new Date('2026-09-15T12:00:00Z')} WHERE id = ${cadencePlanIds[0]}`;
      const inconclusiveRecovery = await capturePlatformBillingMonthlySnapshots(closeInput);
      expect(inconclusiveRecovery.inconclusive).toBeGreaterThan(0);
      const throttledRecovery = await capturePlatformBillingMonthlySnapshots({
        ...closeInput,
        now: new Date('2026-10-27T12:05:00.000Z'),
      });
      expect(throttledRecovery.inconclusive).toBe(0);
      const persistedRecoveryIssue = await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint: inconclusiveIssueFingerprint } },
      });
      expect(persistedRecoveryIssue).toMatchObject({ status: 'IGNORED', details: {
        periodStart: '2026-08-01', reason: 'HISTORICAL_EVIDENCE_LOST',
        resolution: 'closed without recalculation due to missing historical evidence', automaticPricing: false,
      } });
      expect(await db.platformBillingMonthlySnapshot.findUnique({
        where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId, environment: 'TEST', periodStart: new Date('2026-08-01T00:00:00.000Z') } },
      })).toBeNull();
      expect(await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint: inconclusiveIssueFingerprint } },
      })).toMatchObject({ status: 'IGNORED' });

      // A later competence can be captured, but it never resolves or fills the
      // older missing period when current enrollment data changed afterwards.
      await db.$executeRaw`UPDATE "Plano" SET "updatedAt" = ${new Date('2026-10-15T12:00:00Z')} WHERE id IN (${cadencePlanIds[0]}, ${fullPricePlan})`;
      const laterClose = await capturePlatformBillingMonthlySnapshots({
        ...closeInput,
        now: new Date('2026-11-02T12:00:00.000Z'),
      });
      expect(laterClose.transitionsScheduled).toBe(0);
      expect(await db.platformBillingMonthlySnapshot.findUnique({
        where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId, environment: 'TEST', periodStart: new Date('2026-08-01T00:00:00.000Z') } },
      })).toBeNull();
      expect(await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint: inconclusiveIssueFingerprint } },
      })).toMatchObject({ status: 'IGNORED' });

      await db.$executeRaw`UPDATE "Plano" SET "updatedAt" = ${new Date('2026-10-15T12:00:00Z')} WHERE id IN (${cadencePlanIds[0]}, ${fullPricePlan})`;
      await expect(runWithTenant(contaId, (tx) => countActivePlatformBillingStudents({ tx, contaId, asOf })))
        .rejects.toBeInstanceOf(PlatformBillingHistoricalCountInconclusive);

    } finally {
      await db.platformBillingAuditLog.deleteMany({ where: { contaId: { in: [contaId, otherContaId] } } });
      await db.platformBillingIssue.deleteMany({ where: { contaId: { in: [contaId, otherContaId] } } });
      await db.platformBillingMonthlySnapshot.deleteMany({ where: { contaId: { in: [contaId, otherContaId] } } });
      await db.platformBillingAccount.deleteMany({ where: { contaId: { in: [contaId, otherContaId] } } });
      await db.auditLog.deleteMany({ where: { contaId: { in: [contaId, otherContaId] } } });
      await db.descontoMatricula.deleteMany({ where: { matriculaId: { in: [...enrollmentIds] } } });
      await db.matricula.deleteMany({ where: { contaId: { in: [contaId, otherContaId] } } });
      await db.aluno.deleteMany({ where: { contaId: { in: [contaId, otherContaId] } } });
      if (discountId) await db.desconto.deleteMany({ where: { id: discountId } });
      await db.combo.deleteMany({ where: { id: { in: [...combos] } } });
      await db.plano.deleteMany({ where: { contaId: { in: [contaId, otherContaId] } } });
      // Eligibility history deliberately retains a Restrict FK to Conta. Keep
      // these isolated disposable-fixture accounts until the database reset.
      await db.conta.updateMany({ where: { id: { in: [contaId, otherContaId] } }, data: { status: 'INATIVO' } });
    }
  });

  it('reconstructs only the state effective at close, captures deletes and rolls history back with source writes', async () => {
    const db = prisma as PrismaClient;
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `pb_temporal_${suffix}`;
    const studentId = `al_temporal_${suffix}`;
    const planId = `pl_temporal_${suffix}`;
    const enrollmentId = `mat_temporal_${suffix}`;
    const rollbackStudentId = `al_rollback_${suffix}`;
    const rollbackPlanId = `pl_rollback_${suffix}`;
    const rollbackEnrollmentId = `mat_rollback_${suffix}`;
    await db.conta.create({ data: { id: contaId, nome: 'Temporal eligibility fixture' } });

    try {
      await db.plano.create({ data: { id: planId, contaId, nome: `temporal-${suffix}`, valor: 100 } });
      await db.aluno.create({ data: { id: studentId, contaId, nome: 'Temporal student', dataNasc: new Date('2010-01-01T00:00:00Z') } });
      await db.matricula.create({ data: {
        id: enrollmentId, contaId, alunoId: studentId, planoId: planId,
        dataInicio: new Date('2026-01-01T00:00:00Z'), dataFimContrato: new Date('2030-12-31T00:00:00Z'), taxaMatricula: 0,
      } });
      const [{ closeAt }] = await db.$queryRaw<Array<{ closeAt: Date }>>`SELECT clock_timestamp() + interval '10 milliseconds' AS "closeAt"`;
      const initialCount = await runWithTenant(contaId, (tx) => countActivePlatformBillingStudents({ tx, contaId, asOf: closeAt }));
      expect(initialCount).toBe(1);

      // Mutable current rows now say the student is not billable and the
      // enrollment has been physically removed. Both changes are after close.
      await db.$executeRaw`SELECT pg_sleep(0.02)`;
      await db.plano.update({ where: { id: planId }, data: { valor: 0 } });
      await db.matricula.delete({ where: { id: enrollmentId } });
      const historicalCount = await runWithTenant(contaId, (tx) => countActivePlatformBillingStudents({ tx, contaId, asOf: closeAt }));
      const [{ laterAsOf }] = await db.$queryRaw<Array<{ laterAsOf: Date }>>`SELECT clock_timestamp() AS "laterAsOf"`;
      const currentHistoricalCount = await runWithTenant(contaId, (tx) => countActivePlatformBillingStudents({ tx, contaId, asOf: laterAsOf }));
      expect(historicalCount).toBe(1);
      expect(currentHistoricalCount).toBe(0);

      const recoveryPeriod = new Date('2026-01-01T00:00:00.000Z');
      await db.platformBillingMonthlySnapshot.createMany({ data: [
        { contaId, environment: 'TEST', periodStart: recoveryPeriod, studentCount: 1 },
        { contaId, environment: 'LIVE', periodStart: recoveryPeriod, studentCount: 1 },
      ] });
      await db.platformBillingAuditLog.create({ data: {
        contaId,
        action: 'PLATFORM_BILLING_MONTHLY_SNAPSHOT_RECOVERED',
        entityType: 'PlatformBillingMonthlySnapshot',
        entityId: '2026-01-01',
        metadata: { environment: 'TEST', periodStart: '2026-01-01' },
      } });
      expect(await db.platformBillingMonthlySnapshot.findUniqueOrThrow({
        where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId, environment: 'TEST', periodStart: recoveryPeriod } },
      })).toMatchObject({ isRecovered: true });
      expect(await db.platformBillingMonthlySnapshot.findUniqueOrThrow({
        where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId, environment: 'LIVE', periodStart: recoveryPeriod } },
      })).toMatchObject({ isRecovered: false });

      await expect(db.$transaction(async (tx) => {
        await tx.plano.create({ data: { id: rollbackPlanId, contaId, nome: `rollback-${suffix}`, valor: 100 } });
        await tx.aluno.create({ data: { id: rollbackStudentId, contaId, nome: 'Rollback student', dataNasc: new Date('2010-01-01T00:00:00Z') } });
        await tx.matricula.create({ data: {
          id: rollbackEnrollmentId, contaId, alunoId: rollbackStudentId, planoId: rollbackPlanId,
          dataInicio: new Date('2026-01-01T00:00:00Z'), dataFimContrato: new Date('2030-12-31T00:00:00Z'), taxaMatricula: 0,
        } });
        throw new Error('rollback fixture');
      })).rejects.toThrow('rollback fixture');
      expect(await db.platformBillingEligibilityHistory.count({
        where: { contaId, entityId: { in: [rollbackPlanId, rollbackStudentId, rollbackEnrollmentId] } },
      })).toBe(0);

      await expect(db.$transaction(async (tx) => {
        await tx.$executeRaw`CREATE TEMP TABLE eligibility_history_spoof (id text, "contaId" text, status text, "dataInativacao" timestamptz)`;
        await tx.$executeRaw`CREATE TRIGGER eligibility_history_spoof_trigger BEFORE INSERT ON eligibility_history_spoof
          FOR EACH ROW EXECUTE FUNCTION public.capture_platform_billing_eligibility_history('STUDENT')`;
        await tx.$executeRaw`INSERT INTO eligibility_history_spoof (id, "contaId", status) VALUES ('spoof', ${contaId}, 'ATIVO')`;
      })).rejects.toThrow('Unsupported source relation');
    } finally {
      await db.matricula.deleteMany({ where: { contaId } });
      await db.aluno.deleteMany({ where: { contaId } });
      await db.plano.deleteMany({ where: { contaId } });
      // Conta and its immutable coverage/history remain in the disposable DB.
      await db.conta.update({ where: { id: contaId }, data: { status: 'INATIVO' } });
    }
  });

  it('serializes a close against in-flight tenant writes and rejects a transaction split by the cutoff', async () => {
    const db = prisma as PrismaClient;
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `pb_lock_${suffix}`;
    const planId = `pl_lock_${suffix}`;
    await db.conta.create({ data: { id: contaId, nome: 'Eligibility lock fixture' } });
    await db.plano.create({ data: { id: planId, contaId, nome: `lock-${suffix}`, valor: 100 } });

    try {
      let writerReady!: () => void;
      let releaseWriter!: () => void;
      const ready = new Promise<void>((resolve) => { writerReady = resolve; });
      const blocked = new Promise<void>((resolve) => { releaseWriter = resolve; });
      const studentId = `al_lock_${suffix}`;
      const enrollmentId = `mat_lock_${suffix}`;
      const writer = db.$transaction(async (tx) => {
        await tx.aluno.create({ data: { id: studentId, contaId, nome: 'Concurrent student', dataNasc: new Date('2010-01-01T00:00:00Z') } });
        await tx.matricula.create({ data: {
          id: enrollmentId, contaId, alunoId: studentId, planoId: planId,
          dataInicio: new Date('2020-01-01T00:00:00Z'), dataFimContrato: new Date('2030-12-31T00:00:00Z'), taxaMatricula: 0,
        } });
        writerReady();
        await blocked;
      });
      await ready;
      const [{ closeAt }] = await db.$queryRaw<Array<{ closeAt: Date }>>`SELECT clock_timestamp() + interval '10 milliseconds' AS "closeAt"`;
      let closeFinished = false;
      const closing = runWithTenant(contaId, (tx) => countActivePlatformBillingStudents({ tx, contaId, asOf: closeAt }))
        .then((count) => { closeFinished = true; return count; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(closeFinished).toBe(false);
      releaseWriter();
      await writer;
      expect(await closing).toBe(1);

      let splitReady!: () => void;
      let continueSplit!: () => void;
      const splitPrepared = new Promise<void>((resolve) => { splitReady = resolve; });
      const splitContinue = new Promise<void>((resolve) => { continueSplit = resolve; });
      const splitStudentId = `al_split_${suffix}`;
      const splitEnrollmentId = `mat_split_${suffix}`;
      const splitWriter = db.$transaction(async (tx) => {
        await tx.aluno.create({ data: { id: splitStudentId, contaId, nome: 'Split transaction student', dataNasc: new Date('2010-01-01T00:00:00Z') } });
        splitReady();
        await splitContinue;
        await tx.matricula.create({ data: {
          id: splitEnrollmentId, contaId, alunoId: splitStudentId, planoId: planId,
          dataInicio: new Date('2020-01-01T00:00:00Z'), dataFimContrato: new Date('2030-12-31T00:00:00Z'), taxaMatricula: 0,
        } });
      });
      await splitPrepared;
      const [{ splitAt }] = await db.$queryRaw<Array<{ splitAt: Date }>>`SELECT clock_timestamp() + interval '5 milliseconds' AS "splitAt"`;
      await db.$executeRaw`SELECT pg_sleep(0.01)`;
      continueSplit();
      await splitWriter;
      await expect(runWithTenant(contaId, (tx) => countActivePlatformBillingStudents({ tx, contaId, asOf: splitAt })))
        .rejects.toBeInstanceOf(PlatformBillingHistoricalCountInconclusive);
    } finally {
      await db.matricula.deleteMany({ where: { contaId } });
      await db.aluno.deleteMany({ where: { contaId } });
      await db.plano.deleteMany({ where: { contaId } });
      await db.conta.update({ where: { id: contaId }, data: { status: 'INATIVO' } });
    }
  });

  it('closes a pre-coverage gap once under concurrent cron retries without creating a snapshot', async () => {
    const db = prisma as PrismaClient;
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `pb_legacy_gap_${suffix}`;
    const billingAccountId = `pba_legacy_gap_${suffix}`;
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    await db.conta.create({ data: { id: contaId, nome: 'Legacy eligibility gap fixture', createdAt, updatedAt: createdAt } });
    await db.platformBillingAccount.create({
      data: {
        id: billingAccountId, contaId, environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
        planCode: 'BAND_001_025', createdAt, updatedAt: createdAt,
      },
    });
    try {
      const { capturePlatformBillingMonthlySnapshots } = await vi.importActual<typeof import('@/src/server/platform-billing/monthly-snapshots')>(
        '@/src/server/platform-billing/monthly-snapshots',
      );
      const closeInput = { prisma: db, environment: 'TEST' as const, now: new Date('2026-11-01T12:00:00.000Z'), limit: 500 };
      const [first, concurrent] = await Promise.all([
        capturePlatformBillingMonthlySnapshots(closeInput),
        capturePlatformBillingMonthlySnapshots(closeInput),
      ]);
      expect(first.inconclusive + concurrent.inconclusive).toBeGreaterThan(0);

      const fingerprint = `TEST:${contaId}:monthly-close-inconclusive:2026-10-01`;
      expect(await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint } },
      })).toMatchObject({ status: 'IGNORED', details: {
        reason: 'HISTORICAL_COVERAGE_UNAVAILABLE',
        resolution: 'closed without recalculation due to missing historical evidence',
        automaticPricing: false,
      } });
      expect(await db.platformBillingMonthlySnapshot.count({ where: { contaId, environment: 'TEST' } })).toBe(0);
      expect(await db.platformBillingAuditLog.count({
        where: { contaId, action: 'PLATFORM_BILLING_MONTHLY_CLOSE_GAP_CLOSED_WITHOUT_RECALCULATION', entityId: fingerprint },
      })).toBe(1);

      await capturePlatformBillingMonthlySnapshots(closeInput);
      expect(await db.platformBillingMonthlySnapshot.count({ where: { contaId, environment: 'TEST' } })).toBe(0);
      expect(await db.platformBillingAuditLog.count({
        where: { contaId, action: 'PLATFORM_BILLING_MONTHLY_CLOSE_GAP_CLOSED_WITHOUT_RECALCULATION', entityId: fingerprint },
      })).toBe(1);
    } finally {
      await db.platformBillingIssue.deleteMany({ where: { contaId } });
      await db.platformBillingAccount.deleteMany({ where: { contaId } });
      await db.conta.update({ where: { id: contaId }, data: { status: 'INATIVO' } });
    }
  });

  it('terminalizes an older legacy gap even when the current month is already ignored', async () => {
    const db = prisma as PrismaClient;
    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `pb_older_legacy_gap_${suffix}`;
    const billingAccountId = `pba_older_legacy_gap_${suffix}`;
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    await db.conta.create({ data: { id: contaId, nome: 'Older legacy gap fixture', createdAt, updatedAt: createdAt } });
    await db.platformBillingAccount.create({
      data: {
        id: billingAccountId, contaId, environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
        planCode: 'BAND_001_025', createdAt, updatedAt: createdAt,
      },
    });
    const septemberFingerprint = `TEST:${contaId}:monthly-close-inconclusive:2026-09-01`;
    const octoberFingerprint = `TEST:${contaId}:monthly-close-inconclusive:2026-10-01`;
    try {
      await db.platformBillingIssue.createMany({ data: [
        {
          contaId, billingAccountId, environment: 'TEST', severity: 'WARNING', status: 'OPEN',
          code: 'MONTHLY_CLOSE_INCONCLUSIVE', title: 'Older missed close', message: 'September has no historical evidence.',
          fingerprint: septemberFingerprint,
          details: { periodStart: '2026-09-01', reason: 'MISSED_CLOSE_WINDOW', automaticPricing: false },
        },
        {
          contaId, billingAccountId, environment: 'TEST', severity: 'WARNING', status: 'IGNORED',
          ignoredAt: new Date('2026-11-01T00:00:00.000Z'),
          code: 'MONTHLY_CLOSE_INCONCLUSIVE', title: 'Current missed close', message: 'October was closed without recalculation.',
          fingerprint: octoberFingerprint,
          details: {
            periodStart: '2026-10-01', reason: 'HISTORICAL_COVERAGE_UNAVAILABLE', automaticPricing: false,
            resolution: 'closed without recalculation due to missing historical evidence',
          },
        },
      ] });

      const { capturePlatformBillingMonthlySnapshots } = await vi.importActual<typeof import('@/src/server/platform-billing/monthly-snapshots')>(
        '@/src/server/platform-billing/monthly-snapshots',
      );
      const closeInput = { prisma: db, environment: 'TEST' as const, now: new Date('2026-11-01T12:00:00.000Z'), limit: 500 };
      await Promise.all([
        capturePlatformBillingMonthlySnapshots(closeInput),
        capturePlatformBillingMonthlySnapshots(closeInput),
      ]);

      expect(await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint: septemberFingerprint } },
      })).toMatchObject({ status: 'IGNORED', details: {
        periodStart: '2026-09-01', reason: 'HISTORICAL_COVERAGE_UNAVAILABLE',
        resolution: 'closed without recalculation due to missing historical evidence', automaticPricing: false,
      } });
      expect(await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint: octoberFingerprint } },
      })).toMatchObject({ status: 'IGNORED' });
      expect(await db.platformBillingMonthlySnapshot.count({ where: { contaId, environment: 'TEST' } })).toBe(0);
      expect(await db.platformBillingAuditLog.count({
        where: { contaId, action: 'PLATFORM_BILLING_MONTHLY_CLOSE_GAP_CLOSED_WITHOUT_RECALCULATION', entityId: septemberFingerprint },
      })).toBe(1);
      expect(await db.platformBillingAuditLog.count({
        where: { contaId, action: 'PLATFORM_BILLING_MONTHLY_CLOSE_GAP_CLOSED_WITHOUT_RECALCULATION', entityId: octoberFingerprint },
      })).toBe(0);

      await capturePlatformBillingMonthlySnapshots(closeInput);
      expect(await db.platformBillingAuditLog.count({
        where: { contaId, action: 'PLATFORM_BILLING_MONTHLY_CLOSE_GAP_CLOSED_WITHOUT_RECALCULATION', entityId: septemberFingerprint },
      })).toBe(1);
      expect(await db.platformBillingMonthlySnapshot.count({ where: { contaId, environment: 'TEST' } })).toBe(0);
    } finally {
      await db.platformBillingAuditLog.deleteMany({ where: { contaId } });
      await db.platformBillingIssue.deleteMany({ where: { contaId } });
      await db.platformBillingMonthlySnapshot.deleteMany({ where: { contaId } });
      await db.platformBillingAccount.deleteMany({ where: { contaId } });
      await db.auditLog.deleteMany({ where: { contaId } });
      await db.conta.update({ where: { id: contaId }, data: { status: 'INATIVO' } });
    }
  });
});
