import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  reconcileOutboundFinancialOperations,
  reconcilePendingPaymentCommands,
} from '@alusa/finance';
import { reconcileEnrollmentCreationOperations } from '@/src/server/enrollments/reconcile-enrollment-creation-operations';
import {
  resolveTenantScopeForJob,
  startJobRun,
  logJobFailure,
  logJobResult,
  type JobRunContext,
} from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type ReconciliationStage = 'payment_commands' | 'outbound_operations' | 'enrollment_creations';

type StageResult<T> =
  | { ok: true; value: T }
  | { ok: false; stage: ReconciliationStage; correlationId: string };

async function runStage<T>(
  stage: ReconciliationStage,
  startedAt: JobRunContext,
  run: () => Promise<T>,
): Promise<StageResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    const correlationId = randomUUID();
    if (startedAt) logJobFailure('reconcile-payment-commands', startedAt, error, { failedStages: 1 });
    return { ok: false, stage, correlationId };
  }
}

/**
 * GET/POST /api/jobs/reconcile-payment-commands
 *
 * Reconsulta o Asaas para comandos financeiros pendentes e abre divergência
 * quando a confirmação por webhook/sync não chega dentro da janela esperada.
 *
 * Query params:
 * - contaId (opcional): restringe para uma conta.
 * - limit (opcional): limite de comandos, default 50.
 * - pollOlderThanSeconds (opcional): idade mínima para polling, default 30.
 * - staleOlderThanMinutes (opcional): idade para abrir divergência, default 10.
 */
async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('reconcile-payment-commands', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    startedAt = startJobRun('reconcile-payment-commands');

    const limitRaw = Number(url.searchParams.get('limit') ?? '50');
    const pollOlderThanSecondsRaw = Number(url.searchParams.get('pollOlderThanSeconds') ?? '30');
    const staleOlderThanMinutesRaw = Number(url.searchParams.get('staleOlderThanMinutes') ?? '10');

    const common = {
      contaId: tenantScope.contaId,
      limit: Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50,
    };
    const [commandsResult, creationsResult, enrollmentCreationsResult] = await Promise.all([
      runStage('payment_commands', startedAt, () =>
        reconcilePendingPaymentCommands({
          ...common,
          pollOlderThanSeconds: Number.isFinite(pollOlderThanSecondsRaw)
            ? Math.max(5, Math.min(60 * 60, pollOlderThanSecondsRaw))
            : 30,
          staleOlderThanMinutes: Number.isFinite(staleOlderThanMinutesRaw)
            ? Math.max(1, Math.min(24 * 60, staleOlderThanMinutesRaw))
            : 10,
        }),
      ),
      runStage('outbound_operations', startedAt, () =>
        reconcileOutboundFinancialOperations({
          ...common,
          olderThanSeconds: Number.isFinite(pollOlderThanSecondsRaw)
            ? Math.max(5, Math.min(60 * 60, pollOlderThanSecondsRaw))
            : 30,
        }),
      ),
      runStage('enrollment_creations', startedAt, () =>
        reconcileEnrollmentCreationOperations({
          ...common,
          olderThanSeconds: Number.isFinite(staleOlderThanMinutesRaw)
            ? Math.max(1, Math.min(24 * 60, staleOlderThanMinutesRaw)) * 60
            : 600,
        }),
      ),
    ]);
    if (!commandsResult.ok || !creationsResult.ok || !enrollmentCreationsResult.ok) {
      const failures = [commandsResult, creationsResult, enrollmentCreationsResult]
        .filter((result): result is Extract<StageResult<unknown>, { ok: false }> => !result.ok)
        .map(({ stage, correlationId }) => ({ stage, correlationId }));
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'ERRO_JOB',
            message: 'Uma ou mais etapas da reconciliação falharam.',
            failures,
          },
        },
        { status: 500 },
      );
    }

    const commands = commandsResult.value;
    const creations = creationsResult.value;
    const enrollmentCreations = enrollmentCreationsResult.value;
    const scannedCount = commands.scanned + commands.stale.processed + creations.scanned + enrollmentCreations.inspected;
    const confirmedWorkCount = commands.synced + commands.stale.marked + creations.recovered +
      (enrollmentCreations.committed ?? 0) + (enrollmentCreations.compensated ?? 0);
    logJobResult('reconcile-payment-commands', startedAt, {
      commandsScanned: commands.scanned,
      staleCommandsScanned: commands.stale.processed,
      staleCommandsMarked: commands.stale.marked,
      outboundOperationsScanned: creations.scanned,
      enrollmentCreationsInspected: enrollmentCreations.inspected,
      enrollmentCreationsCommitted: enrollmentCreations.committed ?? 0,
      enrollmentCreationsCompensated: enrollmentCreations.compensated ?? 0,
      enrollmentCreationsAttention: enrollmentCreations.attention ?? 0,
      enrollmentCreationsSuspended: enrollmentCreations.suspended ?? 0,
      enrollmentCreationsWaiting: enrollmentCreations.waiting ?? 0,
    }, {
      failedStages: 0,
      workStatus: confirmedWorkCount > 0 ? 'worked' : scannedCount === 0 ? 'empty' : 'unknown',
    });
    // Preserva o contrato legado em `result` e expõe a nova trilha separadamente.
    return NextResponse.json({
      success: true,
      result: commands,
      creations,
      enrollmentCreations,
    });
  } catch (error) {
    const correlationId = randomUUID();
    if (startedAt) logJobFailure('reconcile-payment-commands', startedAt, error);
    return NextResponse.json(
      {
        error: {
          code: 'ERRO_JOB',
          message: 'Não foi possível concluir a reconciliação.',
          correlationId,
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
