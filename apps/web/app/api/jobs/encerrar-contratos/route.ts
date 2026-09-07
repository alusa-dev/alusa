import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { encerrarContratosExpirados } from '@alusa/lib';
import { getAcademicDateBoundsForInstant, normalizeAcademicTimeZone } from '@alusa/lib/date-only';
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

async function listContasWithExpiredEnrollments(maxAccounts: number, now: Date) {
  // Primeiro carregamos apenas tenants ativos. O dia acadêmico é então
  // calculado por grupo de timezone, pois um único "hoje" do processo não é
  // válido para todas as Contas.
  const contas = await prisma.conta.findMany({
    where: { status: 'ATIVO', deletedAt: null },
    select: { id: true, timezone: true },
    orderBy: { id: 'asc' },
  });

  const contasPorTimezone = new Map<string, string[]>();
  for (const conta of contas) {
    const timeZone = normalizeAcademicTimeZone(conta.timezone);
    const contaIds = contasPorTimezone.get(timeZone) ?? [];
    contaIds.push(conta.id);
    contasPorTimezone.set(timeZone, contaIds);
  }

  const contasElegiveis = new Set<string>();
  for (const [timeZone, contaIds] of contasPorTimezone) {
    const academicDay = getAcademicDateBoundsForInstant(now, timeZone);
    const candidates = await prisma.matricula.findMany({
      where: {
        contaId: { in: contaIds },
        OR: [
          {
            status: { in: ['ATIVA', 'PAUSADA'] },
            dataFimContrato: { lt: academicDay.start },
          },
          {
            matriculaFamiliar: {
              status: { in: ['ATIVO', 'PARCIAL'] },
              dataFimContrato: { lt: academicDay.start },
            },
          },
        ],
      },
      select: { contaId: true },
      distinct: ['contaId'],
      orderBy: { contaId: 'asc' },
      take: maxAccounts,
    });

    for (const candidate of candidates) contasElegiveis.add(candidate.contaId);
  }

  return Array.from(contasElegiveis).sort().slice(0, maxAccounts);
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
    const operationNow = new Date();
    const contaIds = tenantScope.contaId
      ? [tenantScope.contaId]
      : await listContasWithExpiredEnrollments(maxAccounts, operationNow);

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
