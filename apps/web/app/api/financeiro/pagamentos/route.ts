import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { prisma } from '@/src/prisma';
import { listFinanceiroPagamentosResultDTOSchema } from '@/features/financeiro/dtos';
import { mapFinanceiroPagamentoRecordToDTO } from '@/features/financeiro/mappers';
import {
  reconcileAsaasPaymentIds,
  shouldReconcileAsaasOnRead,
} from '@/src/server/finance/academic-payment-history';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

// GET /api/financeiro/pagamentos
// Filtros: status, formaPagamento, q (aluno ou descricao da cobrança), cobrancaId
export async function GET(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '20')));
    const status = url.searchParams.getAll('status');
    const formaPagamento = url.searchParams.getAll('formaPagamento');
    const cobrancaId = url.searchParams.get('cobrancaId') || undefined;
    const search = url.searchParams.get('q')?.trim();

    const where: Record<string, unknown> = {
      cobranca: { matricula: { aluno: { contaId: user.contaId } } },
    };
    if (status.length) where.status = { in: status };
    if (formaPagamento.length) where.formaPagamento = { in: formaPagamento } as { in: string[] };
    if (cobrancaId) where.cobrancaId = cobrancaId;
    if (search) {
      where.OR = [
        { cobranca: { matricula: { aluno: { nome: { contains: search, mode: 'insensitive' } } } } },
        { cobranca: { descricao: { contains: search, mode: 'insensitive' } } },
      ];
    }

    async function loadPagamentos() {
      return Promise.all([
        prisma.pagamento.count({ where }),
        prisma.pagamento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          cobranca: {
            include: {
              matricula: { select: { aluno: { select: { id: true, nome: true } }, id: true } },
            },
          },
        },
        }),
      ]);
    }

    let [total, pagamentos] = await loadPagamentos();
    if (shouldReconcileAsaasOnRead(url.searchParams)) {
      const reconciliation = await reconcileAsaasPaymentIds({
        contaId: user.contaId,
        asaasPaymentIds: pagamentos.flatMap((pagamento) => [
          pagamento.asaasPaymentId,
          pagamento.cobranca.asaasPaymentId,
        ]),
        limit: pageSize,
      });
      if (reconciliation.attempted > 0) {
        [total, pagamentos] = await loadPagamentos();
      }
    }

    const items = pagamentos.map((p) => ({
      id: p.id,
      status: p.status,
      valorPago: Number(p.valorPago),
      dataPagamento: p.dataPagamento?.toISOString() || null,
      formaPagamento: p.formaPagamento,
      cobrancaId: p.cobrancaId,
      cobranca: {
        id: p.cobranca.id,
        tipo: p.cobranca.tipo,
        status: p.cobranca.status,
        valor: Number(p.cobranca.valor),
        vencimento: p.cobranca.vencimento.toISOString(),
        aluno: {
          id: p.cobranca.matricula.aluno.id,
          nome: p.cobranca.matricula.aluno.nome,
        },
      },
      asaasPaymentId: p.asaasPaymentId,
      createdAt: p.createdAt.toISOString(),
    }));

    return NextResponse.json(
      listFinanceiroPagamentosResultDTOSchema.parse({
        data: items.map((item) => mapFinanceiroPagamentoRecordToDTO(item)),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Financeiro Pagamentos] Erro', e);
    return err(500, 'ERRO_INTERNO', 'Erro ao carregar pagamentos');
  }
}
