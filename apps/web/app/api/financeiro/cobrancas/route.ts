import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { listChargesAggregated, listOperationalCharges, listStandaloneCharges } from '@alusa/finance';
import type { ChargeOrigin } from '@alusa/finance';
import { prisma } from '@/src/prisma';
import {
  financeiroCobrancasQueryDTOSchema,
  listFinanceiroCobrancasResultDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapFinanceiroCobrancaListItemToDTO } from '@/features/financeiro/cobrancas/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

// Mapeamento de UnifiedChargeStatus para status legado (compatibilidade com UI)
function mapToLegacyStatus(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'PENDENTE';
    case 'PROCESSING':
      return 'PROCESSANDO';
    case 'PAID':
      return 'PAGO';
    case 'OVERDUE':
      return 'ATRASADO';
    case 'CANCELED':
      return 'CANCELADO';
    case 'REFUNDED':
      return 'ESTORNADO';
    default:
      return status;
  }
}

/**
 * GET /api/financeiro/cobrancas
 *
 * Query params:
 * - origin: 'ACADEMIC' | 'STANDALONE' | 'all' (default: 'all')
 *   Use origin=STANDALONE para listar apenas cobranças avulsas
 */
export async function GET(req: NextRequest) {
  try {
    const session = await safeGetServerSession();
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const url = new URL(req.url);
    const query = financeiroCobrancasQueryDTOSchema.parse({
      page: Math.max(1, Number(url.searchParams.get('page') || '1')),
      pageSize: Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') || '20'))),
      status: url.searchParams.getAll('status'),
      tipo: url.searchParams.getAll('tipo'),
      q: url.searchParams.get('q')?.trim(),
      statusView: url.searchParams.get('statusView') || 'open',
      origin: url.searchParams.get('origin') || 'all',
      groupInstallments: url.searchParams.get('groupInstallments') !== 'false',
      scope: url.searchParams.get('scope') || undefined,
    });

    const {
      page,
      pageSize,
      status,
      tipo,
      q: search,
      statusView,
      origin,
      groupInstallments,
      scope,
    } = query as typeof query & { origin: ChargeOrigin };

    // FASE 1: se scope=operational, usar o novo use-case (fila operacional)
    if (scope === 'operational') {
      const opResult = await listOperationalCharges({
        contaId: user.contaId,
        page,
        pageSize,
        search: search || undefined,
      });
      return NextResponse.json(
        listFinanceiroCobrancasResultDTOSchema.parse({
          data: opResult.items.map((item) =>
            mapFinanceiroCobrancaListItemToDTO(item as unknown as Record<string, unknown>),
          ),
          total: opResult.total,
          page: opResult.page,
          pageSize: opResult.pageSize,
          totalPages: opResult.totalPages,
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    // FASE 2: se scope=standalone, listar apenas cobranças avulsas
    if (scope === 'standalone') {
      const stResult = await listStandaloneCharges({
        contaId: user.contaId,
        page,
        pageSize,
        search: search || undefined,
        statusView,
      });

      const now = Date.now();
      const items = stResult.items.map((c) => {
        const venc = c.dueDate ? new Date(c.dueDate).getTime() : 0;
        const atrasado = c.status === 'PENDING' && venc < now && venc > 0;
        return {
          id: c.id,
          tipo: 'AVULSA' as const,
          formaPagamento: c.billingType ?? undefined,
          status: mapToLegacyStatus(c.status),
          valor: c.value,
          vencimento: c.dueDate,
          aluno: { id: c.id, nome: c.payerName },
          matriculaId: null,
          asaasPaymentId: c.asaasPaymentId,
          atrasado,
          origin: 'STANDALONE' as const,
          description: c.description,
          isGroup: false,
          groupType: null,
          installmentPlanId: null,
          installmentCount: null,
          installmentsPaid: null,
          installments: null,
        };
      });

      return NextResponse.json(
        listFinanceiroCobrancasResultDTOSchema.parse({
          data: items.map((item) => mapFinanceiroCobrancaListItemToDTO(item)),
          total: stResult.total,
          page: stResult.page,
          pageSize: stResult.pageSize,
          totalPages: stResult.totalPages,
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const result = await listChargesAggregated({
      contaId: user.contaId,
      page,
      pageSize,
      statusFilter: status.length ? status : undefined,
      statusView,
      tipoFilter: tipo.length ? tipo : undefined,
      search: search || undefined,
      origin,
      groupInstallments,
    }, prisma as any);

    const now = Date.now();
    const items = result.items.map((c) => {
      const venc = c.dueDate ? new Date(c.dueDate).getTime() : 0;
      const atrasado = c.status === 'PENDING' && venc < now && venc > 0;
      const formaPagamento =
        c.origin === 'STANDALONE'
          ? (c.billingType ?? undefined)
          : (c.billingType ?? undefined);
      return {
        id: c.id,
        tipo: c.tipo ?? 'AVULSA',
        formaPagamento,
        status: mapToLegacyStatus(c.status),
        liquidacaoStatus: c.liquidacaoStatus,
        valor: c.value,
        vencimento: c.dueDate,
        aluno: { id: c.alunoId ?? c.id, nome: c.payerName },
        matriculaId: c.matriculaId,
        asaasPaymentId: c.asaasPaymentId,
        atrasado,
        // Novo campo para diferenciar origem
        origin: c.origin,
        description: c.description,
        // Campos de grupo (para parcelamentos)
        isGroup: c.isGroup ?? false,
        groupType: c.groupType ?? null,
        installmentPlanId: c.installmentPlanId ?? null,
        installmentCount: c.installmentCount ?? null,
        installmentsPaid: c.installmentsPaid ?? null,
        // Parcelas do grupo (quando expandido)
        installments: c.installments?.map((p) => ({
          id: p.id,
          status: mapToLegacyStatus(p.status),
          valor: p.value,
          vencimento: p.dueDate,
          description: p.description,
          asaasPaymentId: p.asaasPaymentId,
        })) ?? null,
      };
    });

    return NextResponse.json(
      listFinanceiroCobrancasResultDTOSchema.parse({
        data: items.map((item) => mapFinanceiroCobrancaListItemToDTO(item)),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Financeiro Cobrancas] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
