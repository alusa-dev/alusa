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
  try {
    const url = new URL(req.url);
    const query = expireContractLinksJobQueryDTOSchema.parse({
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
      : await listContasWithExpiredContractLinks({ maxAccounts });
    const results: Array<{ contaId: string; atualizados: number; contratoIds: string[] }> = [];
    const errors: Array<{ contaId: string; erro: string }> = [];

    for (const contaId of contaIds) {
      try {
        results.push({ contaId, ...(await expireContractSignatureLinks({ contaId, limit })) });
      } catch (error) {
        errors.push({ contaId, erro: error instanceof Error ? error.message : 'Erro desconhecido' });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      processedAccounts: contaIds.length,
      updatedContracts: results.reduce((total, result) => total + result.atualizados, 0),
      results,
      errors,
    });
  } catch (error) {
    console.error('[JOB_EXPIRE_CONTRACT_LINKS]', error);
    return NextResponse.json({ error: { code: 'ERRO_JOB', message: 'Erro ao expirar links de contratos' } }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    job: 'expire-contract-links',
    description: 'Materializa como EXPIRADO todo contrato pendente cujo link passou do prazo.',
    method: 'POST',
  });
}
