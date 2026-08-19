import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { prisma } from '@/src/prisma';
import { expireContractSignatureLinks } from '@/src/server/contracts/expire-contract-signature-links.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function listContasWithExpiredLinks(maxAccounts: number) {
  const candidates = await prisma.contrato.findMany({
    where: {
      status: 'PENDENTE',
      tokenExpiraEm: { not: null, lt: new Date() },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { contaId: true },
    distinct: ['contaId'],
    orderBy: { contaId: 'asc' },
    take: maxAccounts,
  });
  return candidates.map((candidate) => candidate.contaId);
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const scope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!scope.ok) return scope.response;

    const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 100, 100);
    const limit = clampPositiveInt(url.searchParams.get('limit'), 500, 500);
    const contaIds = scope.contaId ? [scope.contaId] : await listContasWithExpiredLinks(maxAccounts);
    const results: Array<{ contaId: string; atualizados: number; contratoIds: string[] }> = [];
    const errors: Array<{ contaId: string; erro: string }> = [];

    for (const contaId of contaIds) {
      try {
        results.push({ contaId, ...(await expireContractSignatureLinks({ contaId, limit }, { prisma })) });
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
