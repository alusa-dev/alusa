import { NextResponse } from 'next/server';
import { encerrarContratosJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { encerrarContratosExpirados } from '@alusa/lib/jobs/encerrar-contratos-expirados';
import {
  finalizeExpiredFamilyEnrollments,
  listContasWithExpiredEnrollments,
} from '@/src/server/matriculas/enrollment-closure.service';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
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
    const query = encerrarContratosJobQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId'),
      maxAccounts: url.searchParams.get('maxAccounts'),
    });
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: query.contaId,
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const maxAccounts = query.maxAccounts;
    const operationNow = new Date();
    const contaIds = tenantScope.contaId
      ? [tenantScope.contaId]
      : await listContasWithExpiredEnrollments({ maxAccounts, now: operationNow });

    const results = [];
    const errors: Array<{ contaId: string; erro: string }> = [];

    for (const contaId of contaIds) {
      try {
        const contractResult = await encerrarContratosExpirados(contaId, { now: operationNow });
        const familyResult = await finalizeExpiredFamilyEnrollments({
          contaId,
          now: operationNow,
        });
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
    return jsonError(500, 'ERRO_JOB', 'Não foi possível encerrar os contratos expirados.');
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
