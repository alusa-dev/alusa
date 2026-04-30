import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { prisma } from '@/src/prisma';
import { listFinanceiroPagamentoSummaryResultDTOSchema } from '@/features/financeiro/dtos';
import { mapFinanceiroPagamentoSummaryItemToDTO } from '@/features/financeiro/mappers';
import {
  HISTORICAL_ASAAS_PAYMENT_STATUSES,
  reconcileAcademicCharges,
  resolveAcademicDisplayedStatus,
  resolveAcademicHistoricalPayment,
} from '@/src/server/finance/academic-payment-history';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

const PAYMENT_SUMMARY_RECONCILE_LIMIT = 100;

function buildStatusVariants(status: string | null | undefined): string[] {
  const upper = status?.trim().toUpperCase();
  if (!upper) return [];

  switch (upper) {
    case 'CONFIRMED':
      return ['CONFIRMED', 'CONFIRMADO', 'PAGO'];
    case 'CONFIRMADO':
      return ['CONFIRMADO', 'CONFIRMED', 'PAGO'];
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
    case 'DUNNING_RECEIVED':
    case 'PAGO':
      return [upper, 'PAGO'];
    case 'REFUNDED':
    case 'REFUND_IN_PROGRESS':
    case 'REFUND_REQUESTED':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
    case 'ESTORNADO':
      return [upper, 'ESTORNADO'];
    default:
      return [upper];
  }
}

function matchesStatusFilter(filters: string[], statuses: Array<string | null | undefined>): boolean {
  if (filters.length === 0) return true;

  const variants = new Set(statuses.flatMap((status) => buildStatusVariants(status)));
  return filters.some((filter) => variants.has(filter.trim().toUpperCase()));
}

async function loadCobrancas(params: { contaId: string; search?: string }) {
  return prisma.cobranca.findMany({
    where: {
      matricula: {
        aluno: {
          contaId: params.contaId,
          ...(params.search
            ? { nome: { contains: params.search, mode: 'insensitive' as const } }
            : {}),
        },
      },
      OR: [
        { pagamentos: { some: {} } },
        { dataPagamento: { not: null } },
        { pagoEm: { not: null } },
        { status: { in: ['PAGO', 'ESTORNADO'] } },
        { asaasStatus: { in: [...HISTORICAL_ASAAS_PAYMENT_STATUSES] } },
      ],
    },
    orderBy: [{ vencimento: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      status: true,
      valor: true,
      vencimento: true,
      dataPagamento: true,
      pagoEm: true,
      pagoPor: true,
      formaPagamento: true,
      asaasPaymentId: true,
      asaasStatus: true,
      asaasValue: true,
      asaasNetValue: true,
      lastAsaasFetchAt: true,
      createdAt: true,
      pagamentos: {
        orderBy: [{ dataPagamento: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: {
          id: true,
          status: true,
          valorPago: true,
          dataPagamento: true,
          formaPagamento: true,
          comprovante: true,
          asaasPaymentId: true,
          createdAt: true,
        },
      },
      matricula: {
        select: {
          aluno: {
            select: {
              id: true,
              nome: true,
              cpf: true,
              foto: true,
            },
          },
        },
      },
    },
  });
}

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

// GET /api/financeiro/pagamentos/summary
// Retorna lista de alunos com agregação apenas de cobranças que tiveram pagamento
export async function GET(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const search = url.searchParams.get('q')?.trim() || undefined;
    const statusFilters = url.searchParams.getAll('status');

    let cobrancas = await loadCobrancas({ contaId: user.contaId, search });
    const reconciliation = await reconcileAcademicCharges({
      contaId: user.contaId,
      cobrancas,
      limit: PAYMENT_SUMMARY_RECONCILE_LIMIT,
    });
    if (reconciliation.attempted > 0) {
      cobrancas = await loadCobrancas({ contaId: user.contaId, search });
    }

    // Agrupar histórico de pagamentos por aluno
    const alunosMap = new Map<
      string,
      {
        id: string;
        nome: string;
        cpf: string | null;
        foto: string | null;
        totalPagamentos: number;
        valorTotal: number;
        ultimoPagamento: string | null;
        pagamentosCount: number;
      }
    >();

    for (const cobranca of cobrancas) {
      const alunoId = cobranca.matricula.aluno.id;
      const aluno = cobranca.matricula.aluno;
      const pagamento = resolveAcademicHistoricalPayment(cobranca);
      if (!pagamento) continue;

      const displayedStatus = resolveAcademicDisplayedStatus({
        localCobrancaStatus: cobranca.status,
        remotePaymentStatus: cobranca.asaasStatus ?? null,
        dueDate: cobranca.vencimento,
      });

      if (!matchesStatusFilter(statusFilters, [pagamento.status, displayedStatus])) {
        continue;
      }

      if (!alunosMap.has(alunoId)) {
        alunosMap.set(alunoId, {
          id: alunoId,
          nome: aluno.nome,
          cpf: aluno.cpf,
          foto: aluno.foto,
          totalPagamentos: 0,
          valorTotal: 0,
          ultimoPagamento: null,
          pagamentosCount: 0,
        });
      }

      const alunoData = alunosMap.get(alunoId)!;
      alunoData.totalPagamentos += Number(pagamento.valorPago);
      alunoData.valorTotal += Number(pagamento.valorPago);
      alunoData.pagamentosCount += 1;

      const ultimaMovimentacao =
        pagamento.dataPagamento ||
        cobranca.vencimento.toISOString() ||
        cobranca.createdAt.toISOString();

      if (!alunoData.ultimoPagamento || ultimaMovimentacao > alunoData.ultimoPagamento) {
        alunoData.ultimoPagamento = ultimaMovimentacao;
      }
    }

    // Converter para array e ordenar
    const alunos = Array.from(alunosMap.values()).sort((a, b) => {
      if (!a.ultimoPagamento) return 1;
      if (!b.ultimoPagamento) return -1;
      return b.ultimoPagamento.localeCompare(a.ultimoPagamento);
    });

    return NextResponse.json(
      listFinanceiroPagamentoSummaryResultDTOSchema.parse({
        data: alunos.map((item) => mapFinanceiroPagamentoSummaryItemToDTO(item)),
        total: alunos.length,
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Financeiro Pagamentos Summary] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}

