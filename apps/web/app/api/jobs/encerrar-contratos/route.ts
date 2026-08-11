import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { encerrarContratosExpirados } from '@alusa/lib';
import { prisma } from '@/src/prisma';
import { finalizeExpiredFamilyEnrollments } from '@/src/server/matriculas/enrollment-closure.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function listContasWithExpiredEnrollments(maxAccounts: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const candidates = await prisma.matricula.findMany({
    where: {
      OR: [
        {
          status: { in: ['ATIVA', 'PAUSADA'] },
          dataFimContrato: { lt: today },
        },
        {
          matriculaFamiliar: {
            status: { in: ['ATIVO', 'PARCIAL'] },
            dataFimContrato: { lt: today },
          },
        },
      ],
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { contaId: true },
    distinct: ['contaId'],
    orderBy: { contaId: 'asc' },
    take: maxAccounts,
  });

  return candidates.map((candidate) => candidate.contaId);
}

/**
 * POST /api/jobs/encerrar-contratos
 *
 * Executa o job de encerramento automático de contratos expirados.
 * Pode ser chamado manualmente por admins ou por um cron job externo.
 *
 * Query params:
 * - contaId (opcional): admins processam a própria conta; o cron pode limitar a uma conta
 * - maxAccounts (opcional): limite do cron multi-tenant, default 25, máximo 100
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 25, 100);
    const contaIds = tenantScope.contaId
      ? [tenantScope.contaId]
      : await listContasWithExpiredEnrollments(maxAccounts);

    const results = [];
    const errors: Array<{ contaId: string; erro: string }> = [];

    for (const contaId of contaIds) {
      try {
        const contractResult = await encerrarContratosExpirados(contaId);
        const familyResult = await finalizeExpiredFamilyEnrollments({ contaId });
        results.push({ contaId, ...contractResult, familyClosure: familyResult });
      } catch (error) {
        errors.push({
          contaId,
          erro: error instanceof Error ? error.message : 'Erro desconhecido',
        });
      }
    }

    return NextResponse.json({
      success: true,
      processedAccounts: contaIds.length,
      updatedEnrollments: results.reduce((total, result) => total + result.atualizados, 0),
      results,
      errors,
    });
  } catch (error) {
    console.error('[Job Encerrar Contratos] Erro:', error);
    return jsonError(500, 'ERRO_JOB', (error as Error).message);
  }
}

/**
 * GET /api/jobs/encerrar-contratos
 *
 * Retorna informações sobre o job (para debug/monitoramento).
 */
export async function GET() {
  return NextResponse.json({
    job: 'encerrar-contratos-expirados',
    description: 'Encerra automaticamente contratos com dataFimContrato < hoje',
    method: 'POST',
    params: {
      contaId: 'opcional - processa uma conta; sem conta, o cron percorre contas elegíveis',
      maxAccounts: 'opcional - limite de contas por execução (default 25, máximo 100)',
    },
    headers: {
      'x-cron-token': 'token para execução via cron (opcional se admin)',
    },
  });
}
