import type { PrismaClient } from '@prisma/client';
import type { PlatformBillingEnvironment, SchoolPriceBandCode } from '@alusa/platform-billing';
import {
  resolveSchoolCommercialTarget,
  resolveStableSchoolPriceBand,
} from '@alusa/platform-billing';
import { runWithTenant } from '@/lib/prisma-tenant';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { countActivePlatformBillingStudents, resolvePlatformBillingEnvironment } from './platform-billing-server';
import { scheduleStablePlatformPriceBandTransition } from './plan-change-actions';

const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

export type CapturePlatformBillingMonthlySnapshotsResult = {
  checked: number;
  captured: number;
  readyForSpecialist: number;
  transitionsScheduled: number;
  specialistNoticesCreated: number;
};

/**
 * Capture a single close on the first local calendar day of a month. The
 * unique tenant/environment/period key makes retries idempotent. Missed closes
 * are intentionally not backfilled because snapshots describe observed future
 * state only.
 */
export async function capturePlatformBillingMonthlySnapshots(input: {
  prisma?: PrismaClient;
  environment?: PlatformBillingEnvironment;
  now?: Date;
  limit?: number;
} = {}): Promise<CapturePlatformBillingMonthlySnapshotsResult> {
  const db = input.prisma ?? defaultPrisma;
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  let captured = 0;
  let readyForSpecialist = 0;
  let transitionsScheduled = 0;
  let specialistNoticesCreated = 0;
  const where = { status: 'ATIVO' as const, deletedAt: null };
  const eligibleCount = await db.conta.count({ where });
  // The maintenance cron runs every five minutes. Rotate one bounded page per
  // invocation so a timeout cannot force every retry to restart at page one.
  // Snapshot uniqueness makes revisiting completed accounts safe and avoids a
  // new cursor table or migration.
  const rotationWindow = Math.floor(now.getTime() / MAINTENANCE_INTERVAL_MS);
  const skip = eligibleCount > limit ? (rotationWindow * limit) % eligibleCount : 0;
  const contas = await db.conta.findMany({
    where,
    orderBy: { id: 'asc' },
    skip,
    take: limit,
    select: { id: true, timezone: true },
  });
  const checked = contas.length;
  for (const conta of contas) {
    const periodStart = getPreviousClosedMonth(conta.timezone, now);
    if (!periodStart) continue;
    const result = await runWithTenant(conta.id, async (tx) => {
      const studentCount = await countActivePlatformBillingStudents({ tx, contaId: conta.id });
      const target = resolveSchoolCommercialTarget(studentCount);
      const billingAccount = await tx.platformBillingAccount.findUnique({
        where: { uq_platform_billing_account_conta_env: { contaId: conta.id, environment } },
        select: { id: true, planCode: true },
      });
      const inserted = await tx.platformBillingMonthlySnapshot.createMany({
        data: [{
          contaId: conta.id,
          billingAccountId: billingAccount?.id ?? null,
          environment,
          periodStart,
          studentCount,
          candidateBand: target?.kind === 'SPECIALIST' ? 'SPECIALIST' : target?.band.code ?? null,
          specialistRequired: target?.kind === 'SPECIALIST',
        }],
        skipDuplicates: true,
      });
      if (inserted.count > 0) await tx.platformBillingAuditLog.create({
        data: {
          contaId: conta.id,
          billingAccountId: billingAccount?.id ?? null,
          action: 'PLATFORM_BILLING_MONTHLY_SNAPSHOT_CAPTURED',
          entityType: 'PlatformBillingMonthlySnapshot',
          entityId: periodStart.toISOString().slice(0, 10),
          correlationId: `${environment}:${periodStart.toISOString().slice(0, 10)}`,
          metadata: {
            environment,
            periodStart: periodStart.toISOString().slice(0, 10),
            studentCount,
            candidateBand: target?.kind === 'SPECIALIST' ? 'SPECIALIST' : target?.band.code ?? null,
          },
        },
      });

      const recentSnapshots = await tx.platformBillingMonthlySnapshot.findMany({
        where: { contaId: conta.id, environment },
        orderBy: { periodStart: 'desc' },
        take: 3,
        select: { periodStart: true, candidateBand: true },
      });
      const stableBand = resolveStableSchoolPriceBand({
        currentBand: billingAccount?.planCode && isSchoolBand(billingAccount.planCode)
          ? billingAccount.planCode
          : null,
        snapshots: recentSnapshots,
      });
      let specialistNoticeCreated = false;
      if (stableBand === 'SPECIALIST') {
        const noticeAt = now;
        const transitionEndsAt = new Date(noticeAt.getTime() + 30 * 24 * 60 * 60 * 1000);
        const fingerprint = `${environment}:${conta.id}:specialist-negotiation`;
        await tx.platformBillingIssue.upsert({
          where: { uq_platform_billing_issue_env_fingerprint: { environment, fingerprint } },
          create: {
            contaId: conta.id,
            billingAccountId: billingAccount?.id ?? null,
            environment,
            severity: 'WARNING',
            code: 'SPECIALIST_NEGOTIATION_REQUIRED',
            title: 'Negociação comercial necessária',
            message: 'A conta superou 500 alunos em três fechamentos mensais consecutivos. O contrato e a operação atuais permanecem durante 30 dias para negociação; nenhuma faixa ou preço será aplicado automaticamente.',
            fingerprint,
            correlationId: `${environment}:${conta.id}:specialist-negotiation`,
            details: {
              studentCount,
              noticeAt: noticeAt.toISOString(),
              transitionEndsAt: transitionEndsAt.toISOString(),
              automaticPricing: false,
            },
          },
          update: {},
        });
        const eventId = `specialist-negotiation:${environment}:${conta.id}`;
        const notice = await tx.platformBillingNotificationOutbox.createMany({
          data: [{
            environment,
            eventId,
            eventType: 'platform.specialist_negotiation_ready',
            contaId: conta.id,
          }],
          skipDuplicates: true,
        });
        specialistNoticeCreated = notice.count > 0;
        if (specialistNoticeCreated) {
          await tx.platformBillingAuditLog.create({
            data: {
              contaId: conta.id,
              billingAccountId: billingAccount?.id ?? null,
              action: 'PLATFORM_BILLING_SPECIALIST_NEGOTIATION_OPENED',
              entityType: 'PlatformBillingIssue',
              entityId: fingerprint,
              correlationId: eventId,
              metadata: {
                environment,
                studentCount,
                noticeAt: noticeAt.toISOString(),
                transitionEndsAt: transitionEndsAt.toISOString(),
                automaticPricing: false,
              },
            },
          });
        }
      }
      return {
        inserted: inserted.count > 0,
        specialistReady: stableBand === 'SPECIALIST',
        specialistNoticeCreated,
        stableBand,
      };
    });
    if (result.inserted) captured += 1;
    if (result.specialistReady) readyForSpecialist += 1;
    if (result.specialistNoticeCreated) specialistNoticesCreated += 1;
    if (result.stableBand && result.stableBand !== 'SPECIALIST') {
      const transition = await scheduleStablePlatformPriceBandTransition({
        prisma: db,
        contaId: conta.id,
        environment,
        targetPlanCode: result.stableBand,
      });
      if (transition === 'scheduled') transitionsScheduled += 1;
    }
  }

  return { checked, captured, readyForSpecialist, transitionsScheduled, specialistNoticesCreated };
}

function getPreviousClosedMonth(timezone: string | null, now: Date): Date | null {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
    return parts;
  }, {});
  if (date.day !== '01') return null;
  const year = Number(date.year);
  const month = Number(date.month);
  return new Date(Date.UTC(year, month - 2, 1));
}

function isSchoolBand(value: string): value is SchoolPriceBandCode {
  return [
    'BAND_001_025', 'BAND_026_050', 'BAND_051_100', 'BAND_101_150',
    'BAND_151_200', 'BAND_201_300', 'BAND_301_400', 'BAND_401_500',
  ].includes(value);
}
