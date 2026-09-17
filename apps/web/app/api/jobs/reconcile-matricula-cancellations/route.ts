import { NextResponse } from 'next/server';

import { reconcileMatriculaCancellationsJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  listContasWithPendingMatriculaCancellations,
  reconcilePendingMatriculaCancellations,
} from '@/src/server/matriculas/matricula-sync.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const query = reconcileMatriculaCancellationsJobQueryDTOSchema.parse({
    contaId: url.searchParams.get('contaId'),
    maxAccounts: url.searchParams.get('maxAccounts'),
    limit: url.searchParams.get('limit'),
  });
  const scope = await resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: query.contaId,
  });
  if (!scope.ok) return scope.response;

  const maxAccounts = query.maxAccounts;
  const limit = query.limit;
  const contaIds = scope.contaId
    ? [scope.contaId]
    : await listContasWithPendingMatriculaCancellations({ maxAccounts });

  const results = [];
  const errors: Array<{ contaId: string; error: string }> = [];

  for (const contaId of contaIds) {
    try {
      results.push({
        contaId,
        ...(await reconcilePendingMatriculaCancellations({ contaId, limit })),
      });
    } catch {
      errors.push({
        contaId,
        error: 'Não foi possível reconciliar os cancelamentos desta conta.',
      });
    }
  }

  return NextResponse.json({
    success: true,
    processedAccounts: contaIds.length,
    results,
    errors,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
