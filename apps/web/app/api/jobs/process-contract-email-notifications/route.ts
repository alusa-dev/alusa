import { NextResponse } from 'next/server';
import { apiJsonError } from '@/lib/api/standard-response';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { drainContractEmailNotifications, selectContractNotificationTenantIdsForRun } from '@/src/server/contracts/contract-email-notification.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function toLimit(value: string | null) {
  const parsed = Number(value ?? 50);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), 100)) : 50;
}

async function run(request: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(request.url);
    const tenant = await resolveTenantScopeForJob('process-contract-email-notifications', () => resolveTenantScope(request, { allowCron: true, requestedContaId: url.searchParams.get('contaId'), requireContaIdForCron: false }));
    if (!tenant.ok) return tenant.response;
    startedAt = startJobRun('process-contract-email-notifications');
    const limit = toLimit(url.searchParams.get('limit'));
    let tenants = 0;
    let result = { claimed: 0, accepted: 0, skipped: 0, retried: 0, deadLettered: 0, failedTenants: 0 };
    if (tenant.contaId) {
      tenants = 1;
      result = { ...await drainContractEmailNotifications({ contaId: tenant.contaId, limit }), failedTenants: 0 };
    } else {
      // The cursor advances transactionally; the tenant drains happen after that
      // transaction and are capped at `limit` total records per invocation.
      const tenantPage = await selectContractNotificationTenantIdsForRun({ limit });
      let remainingBudget = limit;
      for (const [index, { id }] of tenantPage.entries()) {
        const remainingTenants = tenantPage.length - index;
        const tenantLimit = Math.max(1, Math.floor(remainingBudget / remainingTenants));
        tenants += 1;
        try {
          const tenantResult = await drainContractEmailNotifications({ contaId: id, limit: tenantLimit });
          remainingBudget -= tenantLimit;
          result = {
            claimed: result.claimed + tenantResult.claimed,
            accepted: result.accepted + tenantResult.accepted,
            skipped: result.skipped + tenantResult.skipped,
            retried: result.retried + tenantResult.retried,
            deadLettered: result.deadLettered + tenantResult.deadLettered,
            failedTenants: result.failedTenants,
          };
        } catch {
          remainingBudget -= tenantLimit;
          result.failedTenants += 1;
          logJobFailure('process-contract-email-notifications', startedAt, new Error('Tenant notification drain failed'), {
            contaId: id,
            errorCode: 'TENANT_DRAIN_FAILED',
          });
        }
      }
    }
    const partialFailure = result.retried > 0 || result.deadLettered > 0 || result.failedTenants > 0;
    logJobResult('process-contract-email-notifications', startedAt, { tenants, ...result }, { hasTenantScope: Boolean(tenant.contaId), partialFailure, workStatus: result.claimed ? 'worked' : 'empty' });
    return NextResponse.json({ success: !partialFailure, tenants, job: result }, { status: partialFailure ? 503 : 200 });
  } catch (error) {
    if (startedAt) logJobFailure('process-contract-email-notifications', startedAt, error);
    return apiJsonError(500, 'JOB_FAILED', 'Não foi possível processar as notificações de contratos.');
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
