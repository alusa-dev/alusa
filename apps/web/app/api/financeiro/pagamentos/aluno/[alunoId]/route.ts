import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { financeiroPagamentoAlunoParamsDTOSchema } from '@/features/financeiro/dtos';
import {
  HISTORICAL_ASAAS_PAYMENT_STATUSES,
  reconcileAcademicCharges,
  resolveAcademicDisplayedStatus,
  resolveAcademicHistoricalPayment,
} from '@/src/server/finance/academic-payment-history';
import { buildAcademicAsaasData, mapBillingTypeToFormaPagamento } from '@/src/server/finance/asaas-payment-detail-policy';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type HistoricoPagamento = {
  id: string;
  status: string;
  valorPago: number;
  dataPagamento: string | null;
  formaPagamento: string;
  comprovante: string | null;
  asaasPaymentId: string | null;
  createdAt: string;
};

type HistoricoCobranca = {
  id: string;
  sourceKind: 'cobranca';
  sourceId: string;
  chargeType: string;
  origin: string;
  tipo: string | null;
  description: string | null;
  payerName: string;
  valor: number;
  vencimento: string | null;
  billingType: string | null;
  status: string;
  asaasPaymentId: string | null;
  matriculaId: string | null;
  groupId: string | null;
  isGroup: boolean;
  installmentCount: number | null;
  installmentsPaid: number | null;
  createdAt: string;
  pagamento: HistoricoPagamento | null;
};

/**
 * GET /api/financeiro/pagamentos/aluno/[alunoId]
 * Retorna apenas o histórico de pagamentos confirmados do aluno
 * pelo vínculo acadêmico real (matrícula -> cobrança -> pagamento).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { alunoId: string } }
) {
  try {
    const session = await safeGetServerSession();
    const user = (
      session as { user?: { id?: string; contaId?: string; role?: string } } | null
    )?.user;
    if (!user?.id || !user?.contaId) {
      return NextResponse.json(
        { success: false, error: { message: 'Usuário não autenticado' } },
        { status: 401 },
      );
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return NextResponse.json(
        { success: false, error: { message: 'Acesso negado' } },
        { status: 403 },
      );
    }

    const parsedParams = financeiroPagamentoAlunoParamsDTOSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: { message: 'ID do aluno é obrigatório' } },
        { status: 400 },
      );
    }
    const { alunoId } = parsedParams.data;
    const contaId = user.contaId;

    const aluno = await prisma.aluno.findFirst({
      where: { id: alunoId, contaId },
      select: { id: true, nome: true, email: true, telefone: true, cpf: true, foto: true },
    });

    if (!aluno) {
      return NextResponse.json(
        { success: false, error: { message: 'Aluno não encontrado' } },
        { status: 404 },
      );
    }

    async function loadCobrancasAcademicas() {
      return prisma.cobranca.findMany({
        where: {
          matricula: {
            alunoId,
            aluno: { contaId },
          },
          OR: [
            { pagamentos: { some: {} } },
            { dataPagamento: { not: null } },
            { pagoEm: { not: null } },
            { status: { in: ['PAGO', 'ESTORNADO'] } },
            { asaasStatus: { in: [...HISTORICAL_ASAAS_PAYMENT_STATUSES] } },
          ],
        },
        select: {
          id: true,
          tipo: true,
          descricao: true,
          valor: true,
          vencimento: true,
          dataPagamento: true,
          formaPagamento: true,
          status: true,
          pagoEm: true,
          pagoPor: true,
          asaasPaymentId: true,
          asaasStatus: true,
          asaasValue: true,
          asaasNetValue: true,
          lastAsaasFetchAt: true,
          matriculaId: true,
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
        },
        orderBy: [{ vencimento: 'desc' }, { createdAt: 'desc' }],
      });
    }

    let cobrancasAcademicas = await loadCobrancasAcademicas();
    const reconciliation = await reconcileAcademicCharges({
      contaId,
      cobrancas: cobrancasAcademicas,
      limit: 100,
    });
    if (reconciliation.attempted > 0) {
      cobrancasAcademicas = await loadCobrancasAcademicas();
    }

    const cobrancas: HistoricoCobranca[] = [];
    for (const cobranca of cobrancasAcademicas) {
      const pagamentoHistorico = resolveAcademicHistoricalPayment(cobranca);
      if (!pagamentoHistorico) continue;

      const asaasData = buildAcademicAsaasData(cobranca as unknown as Record<string, unknown>);

      cobrancas.push({
        id: cobranca.id,
        sourceKind: 'cobranca',
        sourceId: cobranca.id,
        chargeType: cobranca.tipo,
        origin: 'ACADEMICO',
        tipo: cobranca.tipo,
        description: cobranca.descricao,
        payerName: aluno.nome,
        valor: Number(cobranca.valor),
        vencimento: cobranca.vencimento.toISOString(),
        billingType:
          mapBillingTypeToFormaPagamento(asaasData?.billingType) ?? cobranca.formaPagamento,
        status: resolveAcademicDisplayedStatus({
          localCobrancaStatus: cobranca.status,
          remotePaymentStatus: cobranca.asaasStatus ?? null,
          dueDate: cobranca.vencimento,
        }),
        asaasPaymentId: cobranca.asaasPaymentId,
        matriculaId: cobranca.matriculaId,
        groupId: null,
        isGroup: false,
        installmentCount: null,
        installmentsPaid: null,
        createdAt: cobranca.createdAt.toISOString(),
        pagamento: {
          id: pagamentoHistorico.id,
          status: pagamentoHistorico.status,
          valorPago: pagamentoHistorico.valorPago,
          dataPagamento: pagamentoHistorico.dataPagamento,
          formaPagamento: pagamentoHistorico.formaPagamento,
          comprovante: pagamentoHistorico.comprovante,
          asaasPaymentId: pagamentoHistorico.asaasPaymentId,
          createdAt: pagamentoHistorico.createdAt,
        },
      });
    }

    cobrancas.sort((left, right) => {
      const leftDate = left.vencimento ?? left.createdAt;
      const rightDate = right.vencimento ?? right.createdAt;
      return new Date(rightDate).getTime() - new Date(leftDate).getTime();
    });

    const totalPago = cobrancas.reduce(
      (sum, c) => sum + (c.pagamento ? c.pagamento.valorPago : 0),
      0,
    );

    return NextResponse.json({
      success: true,
      data: {
        aluno,
        cobrancas,
        resumo: {
          total: cobrancas.length,
          totalPago,
          totalValor: totalPago,
        },
      },
    });
  } catch (error) {
    console.error('[GET /api/financeiro/pagamentos/aluno/[alunoId]]', error);
    return NextResponse.json(
      {
        success: false,
        error: { message: error instanceof Error ? error.message : 'Erro ao buscar dados' },
      },
      { status: 500 },
    );
  }
}
