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
import { syncCustomSubscriptionQuantityForMonthlyClose } from './custom-quantity-sync';

const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
const MONTHLY_RECOVERY_RETRY_COOLDOWN_MS = 60 * 60 * 1000;

export type CapturePlatformBillingMonthlySnapshotsResult = {
  checked: number;
  captured: number;
  recovered: number;
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
  let recovered = 0;
  let readyForSpecialist = 0;
  let transitionsScheduled = 0;
  let specialistNoticesCreated = 0;
  let inconclusive = 0;
  // A Conta has no platform-billing competence to close until it has entered
  // this environment's billing lifecycle (for example, by starting a trial).
  // Keeping pre-onboarding tenants out also prevents false missed-close issues.
  const where = {
    status: 'ATIVO' as const,
    deletedAt: null,
    platformBillingAccounts: { some: { environment } },
  };
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
    select: { id: true, timezone: true, createdAt: true },
  });
  const checked = contas.length;
  for (const conta of contas) {
    const close = getPreviousClosedMonth(conta.timezone, now);
    const { periodStart } = close;
    try {
    const periodEnd = schoolLocalDateInstant(
      periodStart.getUTCFullYear(),
      periodStart.getUTCMonth() + 1,
      0,
      conta.timezone || 'UTC',
    );
    const billingAccount = await runWithTenant(conta.id, (tx) => tx.platformBillingAccount.findUnique({
      where: { uq_platform_billing_account_conta_env: { contaId: conta.id, environment } },
      select: { id: true, createdAt: true },
    }));
    // A newly onboarded billing account had no billing competence before it
    // existed. Do not manufacture an issue/snapshot for that earlier period.
    if (conta.createdAt > periodEnd || !billingAccount || billingAccount.createdAt > periodEnd) continue;
    await ensureEligibilityHistoryTracking(conta.id);
    if (!close.canCapture) {
      const alreadyCaptured = await runWithTenant(conta.id, (tx) => tx.platformBillingMonthlySnapshot.findUnique({
        where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId: conta.id, environment, periodStart } },
        select: { id: true },
      }));
      if (!alreadyCaptured) {
        await recordInconclusiveClose({ contaId: conta.id, environment, periodStart, reason: 'MISSED_CLOSE_WINDOW' });
      }
    }
    const recovery = await recoverOpenMonthlyCloseIssues({
      contaId: conta.id,
      billingAccountId: billingAccount.id,
      environment,
      timezone: conta.timezone || 'UTC',
      now,
    });
    recovered += recovery.recovered;
    inconclusive += recovery.inconclusive;
    if (!close.canCapture) {
      // Recovery records the original month only. It never evaluates a price
      // transition; the regular monthly close owns that decision.
      await retryCustomQuantitySync({ contaId: conta.id, environment, periodStart, now });
      continue;
    }
    const result = await runWithTenant(conta.id, async (tx) => {
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
      const openCloseIssues = await tx.platformBillingIssue.findMany({
        where: {
          contaId: conta.id,
          environment,
          code: 'MONTHLY_CLOSE_INCONCLUSIVE',
          status: 'OPEN',
        },
        select: { id: true, fingerprint: true },
      });
      const capturedPeriod = periodStart.toISOString().slice(0, 10);
      for (const issue of openCloseIssues) {
        const issuePeriod = getMonthlyCloseIssuePeriod(issue.fingerprint, environment, conta.id);
        // A later close establishes a baseline for later pricing decisions; it
        // cannot prove the missing historical competence. Only a snapshot for
        // the exact issue period can resolve that issue.
        if (!canResolveMonthlyCloseIssue(issue.fingerprint, environment, conta.id, capturedPeriod)) continue;
        const resolved = await tx.platformBillingIssue.updateMany({
          where: { id: issue.id, contaId: conta.id, environment, status: 'OPEN' },
          data: { status: 'RESOLVED', resolvedAt: now },
        });
        if (resolved.count > 0) {
          await tx.platformBillingAuditLog.create({
            data: {
              contaId: conta.id,
              billingAccountId: billingAccount?.id ?? null,
              action: 'PLATFORM_BILLING_MONTHLY_CLOSE_ISSUE_RESOLVED',
              entityType: 'PlatformBillingIssue',
              entityId: issue.fingerprint,
              correlationId: issue.fingerprint,
              metadata: { issuePeriodStart: issuePeriod, resolvedByPeriodStart: capturedPeriod, resolution: 'newer-snapshot-established-baseline-no-backfill' },
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
      const stableBand = billingAccount?.planCode === 'CUSTOM' ? null : resolveStableSchoolPriceBand({
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
    await retryCustomQuantitySync({ contaId: conta.id, environment, periodStart, now });
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

  return { checked, captured, recovered, readyForSpecialist, transitionsScheduled, specialistNoticesCreated, inconclusive };
}

async function retryCustomQuantitySync(input: {
  contaId: string;
  environment: PlatformBillingEnvironment;
  periodStart: Date;
  now: Date;
}) {
  try {
    await syncCustomSubscriptionQuantityForMonthlyClose(input);
  } catch (error) {
    // The monthly snapshot is already durable. Quantity sync has its own
    // persisted retry state and must not rewrite the close as inconclusive.
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'job.platform_billing.custom_quantity_sync.failed',
      route: '/api/jobs/platform-billing-maintenance',
      method: 'JOB',
      requestId: `${input.environment}:${input.contaId}:${input.periodStart.toISOString().slice(0, 10)}`,
      error,
    });
  }
}

async function recoverOpenMonthlyCloseIssues(input: {
  contaId: string;
  billingAccountId: string;
  environment: PlatformBillingEnvironment;
  timezone: string;
  now: Date;
}) {
  const issues = await runWithTenant(input.contaId, (tx) => tx.platformBillingIssue.findMany({
    where: {
      contaId: input.contaId,
      environment: input.environment,
      code: 'MONTHLY_CLOSE_INCONCLUSIVE',
      status: 'OPEN',
    },
    select: { id: true, fingerprint: true, details: true, updatedAt: true },
  }));
  let recovered = 0;
  let inconclusive = 0;

  for (const issue of issues) {
    const period = getMonthlyCloseIssuePeriod(issue.fingerprint, input.environment, input.contaId);
    if (!period) continue;
    const periodStart = new Date(`${period}T00:00:00.000Z`);
    const periodEnd = schoolLocalDateInstant(
      periodStart.getUTCFullYear(),
      periodStart.getUTCMonth() + 1,
      0,
      input.timezone,
    );
    if (periodStart.getUTCDate() !== 1 || periodEnd > input.now) continue;
    const retryAfter = getMonthlyRecoveryRetryAfter(issue.details);
    if (retryAfter && retryAfter > input.now) continue;
    const claimed = await runWithTenant(input.contaId, async (tx) => tx.platformBillingIssue.updateMany({
      // Claim the retry window using the issue version read above. Concurrent
      // cron invocations can therefore emit at most one warning per issue and
      // cooldown interval without adding a queue or a schema migration.
      where: {
        id: issue.id,
        contaId: input.contaId,
        environment: input.environment,
        status: 'OPEN',
        updatedAt: issue.updatedAt,
      },
      data: {
        details: {
          ...getRecord(issue.details),
          recoveryRetryAfter: new Date(input.now.getTime() + MONTHLY_RECOVERY_RETRY_COOLDOWN_MS).toISOString(),
        },
      },
    }));
    if (claimed.count === 0) continue;
    try {
      const result = await runWithTenant(input.contaId, async (tx) => {
        const billingAccount = await tx.platformBillingAccount.findUnique({
          where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment: input.environment } },
          select: { id: true, createdAt: true },
        });
        if (!billingAccount || billingAccount.createdAt > periodEnd) return { recovered: false, inconclusive: false };

        const existingSnapshot = await tx.platformBillingMonthlySnapshot.findUnique({
          where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId: input.contaId, environment: input.environment, periodStart } },
          select: { id: true },
        });
        let inserted = 0;
        if (!existingSnapshot) {
          // This historical query rejects changed current rows. No snapshot is
          // written when its evidence is insufficient.
          const studentCount = await countActivePlatformBillingStudents({ tx, contaId: input.contaId, asOf: periodEnd });
          const target = resolveSchoolCommercialTarget(studentCount);
          const insertResult = await tx.platformBillingMonthlySnapshot.createMany({
            data: [{
              contaId: input.contaId,
              billingAccountId: billingAccount.id,
              environment: input.environment,
              periodStart,
              studentCount,
              candidateBand: target?.kind === 'SPECIALIST' ? 'SPECIALIST' : target?.band.code ?? null,
              specialistRequired: target?.kind === 'SPECIALIST',
            }],
            skipDuplicates: true,
          });
          inserted = insertResult.count;
          const recoveredSnapshot = await tx.platformBillingMonthlySnapshot.findUnique({
            where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId: input.contaId, environment: input.environment, periodStart } },
            select: { id: true, studentCount: true, candidateBand: true },
          });
          if (!recoveredSnapshot) throw new Error('Historical monthly snapshot insert did not produce the expected period.');
          if (inserted > 0) {
            await tx.platformBillingAuditLog.create({
              data: {
                contaId: input.contaId,
                billingAccountId: billingAccount.id,
                action: 'PLATFORM_BILLING_MONTHLY_SNAPSHOT_RECOVERED',
                entityType: 'PlatformBillingMonthlySnapshot',
                entityId: period,
                correlationId: `${input.environment}:${input.contaId}:${period}:recovery`,
                metadata: {
                  environment: input.environment,
                  periodStart: period,
                  studentCount: recoveredSnapshot.studentCount,
                  candidateBand: recoveredSnapshot.candidateBand,
                  evidence: 'historical-eligibility-query',
                  automaticPricing: false,
                },
              },
            });
          }
        }

        // Never clear the issue until the exact tenant/environment/period row
        // is durable (the unique key also makes concurrent retries safe).
        const exactSnapshot = await tx.platformBillingMonthlySnapshot.findUnique({
          where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId: input.contaId, environment: input.environment, periodStart } },
          select: { id: true },
        });
        if (!exactSnapshot) return { recovered: false, inconclusive: true };
        const resolved = await tx.platformBillingIssue.updateMany({
          where: { id: issue.id, contaId: input.contaId, environment: input.environment, status: 'OPEN' },
          data: { status: 'RESOLVED', resolvedAt: input.now },
        });
        if (resolved.count > 0) {
          await tx.platformBillingAuditLog.create({
            data: {
              contaId: input.contaId,
              billingAccountId: billingAccount.id,
              action: 'PLATFORM_BILLING_MONTHLY_CLOSE_ISSUE_RESOLVED',
              entityType: 'PlatformBillingIssue',
              entityId: issue.fingerprint,
              correlationId: `${input.environment}:${input.contaId}:${period}:recovery`,
              metadata: {
                issuePeriodStart: period,
                resolvedByPeriodStart: period,
                resolution: inserted > 0 ? 'historical-snapshot-reconstructed' : 'exact-snapshot-already-exists',
                automaticPricing: false,
              },
            },
          });
        }
        return { recovered: resolved.count > 0, inconclusive: false };
      });
      if (result.recovered) recovered += 1;
      if (result.inconclusive) inconclusive += 1;
    } catch (error) {
      inconclusive += 1;
      logApiOperationalEvent({
        severity: 'warn',
        eventName: 'job.platform_billing.monthly_snapshot_recovery.inconclusive',
        route: '/api/jobs/platform-billing-maintenance',
        method: 'JOB',
        requestId: `${input.environment}:${input.contaId}:${period}`,
        error,
      });
    }
  }

  return { recovered, inconclusive };
}

async function ensureEligibilityHistoryTracking(contaId: string) {
  await runWithTenant(contaId, async (tx) => {
    const marker = await tx.auditLog.findFirst({
      where: { contaId, action: 'PLATFORM_BILLING_ELIGIBILITY_HISTORY_TRACKING_STARTED' },
      select: { id: true },
    });
    if (marker) return;
    await tx.auditLog.create({
      data: {
        contaId,
        actorType: 'SYSTEM',
        action: 'PLATFORM_BILLING_ELIGIBILITY_HISTORY_TRACKING_STARTED',
        entityType: 'Conta',
        entityId: contaId,
        metadata: { purpose: 'platform-billing-monthly-eligibility-recovery', version: 1 },
      },
    });
  });
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
    if (existing?.status === 'OPEN' && hasSameMonthlyCloseDetails(existing.details, details)) return;
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
        ignoredAt: null,
        details: {
          ...details,
        },
      },
    });
  });
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getMonthlyRecoveryRetryAfter(details: unknown): Date | null {
  const value = getRecord(details).recoveryRetryAfter;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasSameMonthlyCloseDetails(existing: unknown, expected: Record<string, unknown>): boolean {
  const record = getRecord(existing);
  return Object.entries(expected).every(([key, value]) => record[key] === value);
}

function getMonthlyCloseIssuePeriod(fingerprint: string, environment: PlatformBillingEnvironment, contaId: string): string | null {
  const prefix = `${environment}:${contaId}:monthly-close-inconclusive:`;
  if (!fingerprint.startsWith(prefix)) return null;
  const period = fingerprint.slice(prefix.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return null;
  const parsed = new Date(`${period}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== period ? null : period;
}

/** A newer close cannot prove or resolve a missing historical competence. */
export function canResolveMonthlyCloseIssue(
  fingerprint: string,
  environment: PlatformBillingEnvironment,
  contaId: string,
  capturedPeriod: string,
): boolean {
  return getMonthlyCloseIssuePeriod(fingerprint, environment, contaId) === capturedPeriod;
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
