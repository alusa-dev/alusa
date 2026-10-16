import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';
import { expireContractLinksJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  expireContractSignatureLinks,
  listContasWithExpiredContractLinks,
} from '@/src/server/contracts/expire-contract-signature-links.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
        const scope = await resolveTenantScopeForJob('expire-contract-links', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!scope.ok) return scope.response;
    startedAt = startJobRun('expire-contract-links');
const query = expireContractLinksJobQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId'),
      maxAccounts: url.searchParams.get('maxAccounts'),
      limit: url.searchParams.get('limit'),
    });

    const maxAccounts = query.maxAccounts;
    const limit = query.limit;
    const contaIds = scope.contaId
      ? [scope.contaId]
      : await listContasWithExpiredContractLinks({ maxAccounts });
    const results: Array<{ contaId: string; atualizados: number; contratoIds: string[] }> = [];
    const errors: Array<{ contaId: string; erro: string }> = [];

    for (const contaId of contaIds) {
      try {
        results.push({ contaId, ...(await expireContractSignatureLinks({ contaId, limit })) });
      } catch (error) {
        errors.push({
          contaId,
          erro: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    const updatedContracts = results.reduce((total, result) => total + result.atualizados, 0);
    logJobResult('expire-contract-links', startedAt, {
      processedAccounts: contaIds.length,
      updatedContracts,
      failed: errors.length,
    }, { partialFailure: errors.length > 0, workStatus: updatedContracts > 0 ? 'worked' : errors.length > 0 || scope.contaId || contaIds.length > 0 ? 'unknown' : 'empty' });

    return NextResponse.json({
      success: errors.length === 0,
      processedAccounts: contaIds.length,
      updatedContracts,
      results,
      errors,
    });
  } catch (error) {
    if (startedAt) logJobFailure('expire-contract-links', startedAt, error);
    return NextResponse.json(
      { error: { code: 'ERRO_JOB', message: 'Erro ao expirar links de contratos' } },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    job: 'expire-contract-links',
    description: 'Materializa como EXPIRADO todo contrato pendente cujo link passou do prazo.',
    method: 'POST',
  });
}
