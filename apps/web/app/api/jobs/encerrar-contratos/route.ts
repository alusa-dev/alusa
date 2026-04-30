import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { encerrarContratosExpirados } from '@alusa/lib';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/encerrar-contratos
 *
 * Executa o job de encerramento automático de contratos expirados.
 * Pode ser chamado manualmente por admins ou por um cron job externo.
 *
 * Query params:
 * - contaId (opcional): se informado, processa apenas matrículas desta conta
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
      requireContaIdForCron: true,
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const contaId = tenantScope.contaId;

    if (!contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório para executar o job.');
    }

    const result = await encerrarContratosExpirados(contaId);

    return NextResponse.json({
      success: true,
      ...result,
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
      contaId: 'opcional - processa apenas matrículas desta conta',
    },
    headers: {
      'x-cron-token': 'token para execução via cron (opcional se admin)',
    },
  });
}
