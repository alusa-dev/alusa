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
      expect(recoveredSnapshot).toMatchObject({ studentCount: 12, candidateBand: 'BAND_001_025' });
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
      expect(await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint: untrackedTenantIssue } },
      })).toMatchObject({ status: 'OPEN' });
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
      expect(persistedRecoveryIssue.details).toMatchObject({ recoveryRetryAfter: '2026-10-27T13:00:00.000Z' });
      expect(await db.platformBillingMonthlySnapshot.findUnique({
        where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId, environment: 'TEST', periodStart: new Date('2026-08-01T00:00:00.000Z') } },
      })).toBeNull();
      expect(await db.platformBillingIssue.findUniqueOrThrow({
        where: { uq_platform_billing_issue_env_fingerprint: { environment: 'TEST', fingerprint: inconclusiveIssueFingerprint } },
      })).toMatchObject({ status: 'OPEN' });

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
      })).toMatchObject({ status: 'OPEN' });

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
      await db.conta.deleteMany({ where: { id: { in: [contaId, otherContaId] } } });
    }
  });
});
