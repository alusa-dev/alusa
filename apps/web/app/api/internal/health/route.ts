import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { getAsaasBaseUrlFromEnvOrThrow, AsaasBaseUrlError } from '@alusa/asaas';

import { prisma } from '@/src/prisma';
import { internalHealthResultDTOSchema } from '@/features/system/dtos';
import { mapInternalHealthResultToDTO } from '@/features/system/mappers';
import { authOptions } from '@/lib/auth-options';

type HealthCheckStatus = 'OK' | 'WARNING' | 'ERROR';

type HealthCheck = {
  name: string;
  status: HealthCheckStatus;
  message?: string;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function summarizeOverallStatus(checks: HealthCheck[]): 'OK' | 'DEGRADED' | 'ERROR' {
  if (checks.some((c) => c.status === 'ERROR')) return 'ERROR';
  if (checks.some((c) => c.status === 'WARNING')) return 'DEGRADED';
  return 'OK';
}

async function canReadInternalHealth(req: Request): Promise<boolean> {
  const configuredToken = process.env.CRON_SECRET_TOKEN ?? process.env.CRON_SECRET;
  const cronToken = req.headers.get('x-cron-token');
  const authorization = req.headers.get('authorization');
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
  if (configuredToken && (cronToken === configuredToken || bearerToken === configuredToken)) {
    return true;
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const role = (session as { user?: { role?: string } } | null)?.user?.role?.toUpperCase();
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export async function GET(req: Request) {
  if (!(await canReadInternalHealth(req))) {
    return json(401, { error: 'Unauthorized' });
  }

  const checks: HealthCheck[] = [];

  // DB (somente conectividade)
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: 'database', status: 'OK' });
  } catch {
    checks.push({ name: 'database', status: 'ERROR', message: 'Falha ao conectar no banco' });
  }

  // Config Asaas (sem chamadas externas)
  try {
    const baseUrl = getAsaasBaseUrlFromEnvOrThrow();
    checks.push({ name: 'asaas.base_url', status: 'OK', message: baseUrl });
  } catch (error) {
    if (error instanceof AsaasBaseUrlError) {
      checks.push({ name: 'asaas.base_url', status: 'ERROR', message: error.code });
    } else {
      checks.push({ name: 'asaas.base_url', status: 'ERROR', message: 'UNKNOWN_ERROR' });
    }
  }

  if (process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET) {
    checks.push({ name: 'asaas.webhook_auth_token_secret', status: 'OK' });
  } else {
    checks.push({ name: 'asaas.webhook_auth_token_secret', status: 'ERROR', message: 'MISSING' });
  }

  const overallStatus = summarizeOverallStatus(checks);

  const httpStatus = overallStatus === 'OK' ? 200 : overallStatus === 'DEGRADED' ? 200 : 503;

  return json(
    httpStatus,
    internalHealthResultDTOSchema.parse(
      mapInternalHealthResultToDTO({
        ok: overallStatus === 'OK',
        overallStatus,
        checks,
      }),
    ),
  );
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
