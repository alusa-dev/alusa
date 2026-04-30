import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { getAsaasBaseUrlFromEnvOrThrow } from '@alusa/asaas';
import {
  getAsaasReadIntentStats,
  getKycAsaasReadCacheStats,
  getPaymentCommandPreflightStats,
  getWebhookHealthStatus,
  getWebhookQueueMetrics,
} from '@alusa/finance';
import { loadAsaasCredentials } from '@alusa/database';
import { adminFinancialHealthResultDTOSchema } from '@/features/system/dtos';
import { mapAdminFinancialHealthResultToDTO } from '@/features/system/mappers';
import { getAsaasReadObservability } from '@/src/server/finance/asaas-read-observability';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

type HealthCheckName = 'base_url' | 'credentials' | 'webhook' | 'feature_flag';

type HealthCheck = {
  name: HealthCheckName;
  ok: boolean;
  message?: string;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function GET() {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const checks: HealthCheck[] = [];
    const [queueMetrics, remoteWebhookStatus] = await Promise.all([
      getWebhookQueueMetrics({ contaId: user.contaId }),
      getWebhookHealthStatus(user.contaId),
    ]);

    const baseUrlOk = (() => {
      try {
        getAsaasBaseUrlFromEnvOrThrow();
        return true;
      } catch {
        return false;
      }
    })();

    checks.push({ name: 'base_url', ok: baseUrlOk, message: baseUrlOk ? undefined : 'INVALID_OR_MISSING' });

    const creds = await loadAsaasCredentials(user.contaId);
    const credentialsOk = Boolean(creds?.apiKey);
    checks.push({ name: 'credentials', ok: credentialsOk, message: credentialsOk ? undefined : 'MISSING' });

    const webhookSecretOk = Boolean(process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET);
    const asaasAccount = await prisma.asaasAccount.findFirst({
      where: { financeProfile: { contaId: user.contaId } },
      select: { webhookAuthTokenHash: true },
    });

    const webhookHashOk = Boolean(asaasAccount?.webhookAuthTokenHash);
    const hasEnabledRemoteWebhook = remoteWebhookStatus?.webhooks.some((webhook) => webhook.enabled) ?? false;
    const hasInterruptedRemoteWebhook = remoteWebhookStatus?.hasInterrupted ?? false;
    const webhookOk = webhookSecretOk && webhookHashOk && hasEnabledRemoteWebhook && !hasInterruptedRemoteWebhook;

    checks.push({
      name: 'webhook',
      ok: webhookOk,
      message: webhookOk
        ? undefined
        : !webhookSecretOk
          ? 'MISSING_SECRET'
          : !webhookHashOk
            ? 'MISSING_ACCOUNT_HASH'
            : !remoteWebhookStatus
              ? 'REMOTE_NOT_CONFIGURED'
              : hasInterruptedRemoteWebhook
                ? 'REMOTE_INTERRUPTED'
                : 'REMOTE_DISABLED',
    });

    const featureFlagOk = process.env.FEATURE_ASAAS === 'true';
    checks.push({ name: 'feature_flag', ok: featureFlagOk, message: featureFlagOk ? undefined : 'DISABLED' });

    const ok = checks.every((c) => c.ok);
    const queueStatus = queueMetrics.backlog > 0
      ? (queueMetrics.lagSeconds != null && queueMetrics.lagSeconds > 60 ? 'WARNING' : 'DEGRADED')
      : 'OK';

    return json(
      200,
      adminFinancialHealthResultDTOSchema.parse(
        mapAdminFinancialHealthResultToDTO({
          ok,
          overallStatus:
            ok && queueStatus === 'OK' ? 'OK' : queueStatus === 'WARNING' ? 'WARNING' : 'ERROR',
          checks,
          queue: queueMetrics,
          queueStatus,
          asaasReads: {
            kycCache: getKycAsaasReadCacheStats(),
            routeReads: getAsaasReadObservability(),
            commandPreflight: getPaymentCommandPreflightStats(),
            intentStats: getAsaasReadIntentStats(),
          },
        }),
      ),
    );
  } catch (error) {
    console.error('[Admin Financial Health][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
