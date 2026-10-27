import type { PrismaClient } from '@prisma/client';
import type { PlatformBillingEnvironment, SchoolPriceBandCode } from '@alusa/platform-billing';
import {
  resolveSchoolCommercialTarget,
  resolveStableSchoolPriceBand,
} from '@alusa/platform-billing';
import { runWithTenant } from '@/lib/prisma-tenant';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { logApiOperationalEvent } from '@/lib/observability/api-logger';
import { countActivePlatformBillingStudents, PlatformBillingHistoricalCountInconclusive, resolvePlatformBillingEnvironment } from './platform-billing-server';
import { scheduleStablePlatformPriceBandTransition } from './plan-change-actions';

const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

export type CapturePlatformBillingMonthlySnapshotsResult = {
  checked: number;
  captured: number;
  readyForSpecialist: number;
  transitionsScheduled: number;
  specialistNoticesCreated: number;
  inconclusive: number;
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
  let inconclusive = 0;
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
    const close = getPreviousClosedMonth(conta.timezone, now);
    const { periodStart } = close;
    try {
    if (!close.canCapture) {
      const alreadyCaptured = await runWithTenant(conta.id, (tx) => tx.platformBillingMonthlySnapshot.findUnique({
        where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId: conta.id, environment, periodStart } },
        select: { id: true },
      }));
      if (alreadyCaptured) continue;
      await recordInconclusiveClose({ contaId: conta.id, environment, periodStart, reason: 'MISSED_CLOSE_WINDOW' });
      inconclusive += 1;
      continue;
    }
    const result = await runWithTenant(conta.id, async (tx) => {
      const periodEnd = schoolLocalDateInstant(
        periodStart.getUTCFullYear(),
        periodStart.getUTCMonth() + 1,
        0,
        conta.timezone || 'UTC',
      );
      const studentCount = await countActivePlatformBillingStudents({ tx, contaId: conta.id, asOf: periodEnd });
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
      const inconclusiveFingerprint = `${environment}:${conta.id}:monthly-close-inconclusive:${periodStart.toISOString().slice(0, 10)}`;
      const priorCloseIssue = await tx.platformBillingIssue.findUnique({
        where: { uq_platform_billing_issue_env_fingerprint: { environment, fingerprint: inconclusiveFingerprint } },
        select: { id: true, contaId: true, status: true },
      });
      if (priorCloseIssue?.contaId === conta.id && priorCloseIssue.status === 'OPEN') {
        const resolved = await tx.platformBillingIssue.updateMany({
          where: { id: priorCloseIssue.id, contaId: conta.id, status: 'OPEN' },
          data: { status: 'RESOLVED', resolvedAt: now },
        });
        if (resolved.count > 0) {
          await tx.platformBillingAuditLog.create({
            data: {
              contaId: conta.id,
              billingAccountId: billingAccount?.id ?? null,
              action: 'PLATFORM_BILLING_MONTHLY_CLOSE_ISSUE_RESOLVED',
              entityType: 'PlatformBillingIssue',
              entityId: inconclusiveFingerprint,
              correlationId: inconclusiveFingerprint,
              metadata: { periodStart: periodStart.toISOString().slice(0, 10), resolution: 'snapshot-captured' },
            },
          });
        }
      }
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
      try {
        const transition = await scheduleStablePlatformPriceBandTransition({
          prisma: db,
          contaId: conta.id,
          environment,
          targetPlanCode: result.stableBand,
        });
        if (transition === 'scheduled') transitionsScheduled += 1;
      } catch (error) {
        // The close is already durable; a failed commercial transition must
        // not rewrite its status as inconclusive. The transition job retries.
        logApiOperationalEvent({
          severity: 'error',
          eventName: 'job.platform_billing.monthly_price_transition.failed',
          route: '/api/jobs/platform-billing-maintenance',
          method: 'JOB',
          requestId: `${environment}:${conta.id}:${periodStart.toISOString().slice(0, 10)}`,
          error,
        });
      }
    }
    } catch (error) {
      await recordInconclusiveClose({
        contaId: conta.id,
        environment,
        periodStart,
        reason: error instanceof PlatformBillingHistoricalCountInconclusive
          ? 'HISTORICAL_DATA_INSUFFICIENT'
          : 'CLOSE_PROCESSING_FAILED',
      });
      inconclusive += 1;
    }
  }

  return { checked, captured, readyForSpecialist, transitionsScheduled, specialistNoticesCreated, inconclusive };
}

async function recordInconclusiveClose(input: {
  contaId: string;
  environment: PlatformBillingEnvironment;
  periodStart: Date;
  reason: string;
}) {
  const fingerprint = `${input.environment}:${input.contaId}:monthly-close-inconclusive:${input.periodStart.toISOString().slice(0, 10)}`;
  await runWithTenant(input.contaId, async (tx) => {
    const existing = await tx.platformBillingIssue.findUnique({
      where: { uq_platform_billing_issue_env_fingerprint: { environment: input.environment, fingerprint } },
      select: { id: true, status: true, details: true },
    });
    const details = {
      periodStart: input.periodStart.toISOString().slice(0, 10),
      reason: input.reason,
      automaticPricing: false,
    };
    if (existing?.status === 'OPEN' && JSON.stringify(existing.details) === JSON.stringify(details)) return;
    const billingAccount = await tx.platformBillingAccount.findUnique({
      where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment: input.environment } },
      select: { id: true },
    });
    await tx.platformBillingIssue.upsert({
      where: { uq_platform_billing_issue_env_fingerprint: { environment: input.environment, fingerprint } },
      create: {
        contaId: input.contaId,
        billingAccountId: billingAccount?.id ?? null,
        environment: input.environment,
        severity: 'WARNING',
        status: 'OPEN',
        code: 'MONTHLY_CLOSE_INCONCLUSIVE',
        title: 'Fechamento comercial mensal inconclusivo',
        message: 'A competência não foi fechada porque a janela do job foi perdida ou os dados históricos disponíveis não permitem reconstruir a elegibilidade com segurança. Nenhuma alteração de faixa foi aplicada.',
        fingerprint,
        correlationId: fingerprint,
        details: {
          ...details,
        },
      },
      update: {
        status: 'OPEN',
        resolvedAt: null,
        details: {
          ...details,
        },
      },
    });
  });
}

function getPreviousClosedMonth(timezone: string | null, now: Date): { periodStart: Date; canCapture: boolean } {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
    return parts;
  }, {});
  const year = Number(date.year);
  const month = Number(date.month);
  return { periodStart: new Date(Date.UTC(year, month - 2, 1)), canCapture: date.day === '01' };
}

function schoolLocalDateInstant(year: number, month: number, day: number, timezone: string): Date {
  const targetUtc = Date.UTC(year, month, day, 23, 59, 59, 999);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(targetUtc)).reduce<Record<string, string>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  const observedUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second), 999,
  );
  return new Date(targetUtc - (observedUtc - targetUtc));
}

function isSchoolBand(value: string): value is SchoolPriceBandCode {
  return [
    'BAND_001_025', 'BAND_026_050', 'BAND_051_100', 'BAND_101_150',
    'BAND_151_200', 'BAND_201_300', 'BAND_301_400', 'BAND_401_500',
  ].includes(value);
}
