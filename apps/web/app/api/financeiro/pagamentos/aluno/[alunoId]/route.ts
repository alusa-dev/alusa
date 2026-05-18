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
  sourceKind: 'cobranca' | 'charge' | 'sale';
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

function resolveStandaloneChargeType(charge: {
  standaloneInstallmentPlanId: string | null;
  standaloneSubscriptionId: string | null;
  externalReference: string;
}) {
  if (charge.standaloneInstallmentPlanId || charge.externalReference.includes(':installment:')) {
    return 'INSTALLMENT';
  }
  if (charge.standaloneSubscriptionId || charge.externalReference.includes(':subscription:')) {
    return 'SUBSCRIPTION';
  }
  return 'ONE_TIME';
}

function resolveStandaloneTipo(chargeType: string, hasSale: boolean) {
  if (hasSale) return 'LOJA';
  if (chargeType === 'INSTALLMENT') return 'PARCELADA';
  if (chargeType === 'SUBSCRIPTION') return 'RECORRENTE';
  return 'AVULSA';
}

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
          matricula: {
            select: {
              responsavelFinanceiro: { select: { nome: true } },
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
        payerName: cobranca.matricula?.responsavelFinanceiro?.nome ?? aluno.nome,
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

    const standaloneCharges = await prisma.charge.findMany({
      where: {
        contaId,
        cobrancaId: null,
        status: 'PAID',
        OR: [
          { customer: { payerType: 'ALUNO', payerId: alunoId } },
          { sale: { alunoId } },
        ],
      },
      select: {
        id: true,
        status: true,
        externalReference: true,
        asaasPaymentId: true,
        value: true,
        dueDate: true,
        billingType: true,
        payerName: true,
        description: true,
        standaloneInstallmentPlanId: true,
        standaloneSubscriptionId: true,
        invoiceUrl: true,
        statusUpdatedAt: true,
        createdAt: true,
        updatedAt: true,
        sale: {
          select: {
            id: true,
            saleNumber: true,
            total: true,
            paymentMethod: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
    });

    for (const charge of standaloneCharges) {
      const chargeType = resolveStandaloneChargeType(charge);
      const tipo = resolveStandaloneTipo(chargeType, Boolean(charge.sale));
      const value = Number(charge.value ?? charge.sale?.total ?? 0);
      const paidAt = (charge.statusUpdatedAt ?? charge.updatedAt ?? charge.createdAt).toISOString();
      const sourceDescription = charge.sale
        ? `Loja #${String(charge.sale.saleNumber).padStart(4, '0')}`
        : charge.description;

      cobrancas.push({
        id: charge.id,
        sourceKind: 'charge',
        sourceId: charge.id,
        chargeType,
        origin: charge.sale ? 'LOJA' : 'STANDALONE',
        tipo,
        description:
          sourceDescription ??
          (chargeType === 'SUBSCRIPTION'
            ? 'Assinatura recorrente'
            : chargeType === 'INSTALLMENT'
              ? 'Parcela'
              : 'Cobrança avulsa'),
        payerName: charge.payerName ?? aluno.nome,
        valor: value,
        vencimento: charge.dueDate?.toISOString() ?? charge.createdAt.toISOString(),
        billingType: charge.sale?.paymentMethod ?? charge.billingType,
        status: 'PAGO',
        asaasPaymentId: charge.asaasPaymentId,
        matriculaId: null,
        groupId: charge.standaloneInstallmentPlanId ?? charge.standaloneSubscriptionId,
        isGroup: false,
        installmentCount: null,
        installmentsPaid: null,
        createdAt: charge.createdAt.toISOString(),
        pagamento: {
          id: charge.id,
          status: 'PAID',
          valorPago: value,
          dataPagamento: paidAt,
          formaPagamento: charge.sale?.paymentMethod ?? charge.billingType ?? 'INDEFINIDO',
          comprovante: charge.invoiceUrl,
          asaasPaymentId: charge.asaasPaymentId,
          createdAt: paidAt,
        },
      });
    }

    const directStoreSales = await prisma.sale.findMany({
      where: {
        contaId,
        alunoId,
        status: 'CONCLUIDA',
        finalizationType: 'RECEBIMENTO_PRESENCIAL',
        chargeId: null,
      },
      select: {
        id: true,
        saleNumber: true,
        total: true,
        paymentMethod: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const sale of directStoreSales) {
      const paidAt = sale.updatedAt?.toISOString() ?? sale.createdAt.toISOString();
      const value = Number(sale.total);
      cobrancas.push({
        id: sale.id,
        sourceKind: 'sale',
        sourceId: sale.id,
        chargeType: 'ONE_TIME',
        origin: 'LOJA',
        tipo: 'LOJA',
        description: `Loja #${String(sale.saleNumber).padStart(4, '0')}`,
        payerName: aluno.nome,
        valor: value,
        vencimento: sale.createdAt.toISOString(),
        billingType: sale.paymentMethod,
        status: 'PAGO',
        asaasPaymentId: null,
        matriculaId: null,
        groupId: null,
        isGroup: false,
        installmentCount: null,
        installmentsPaid: null,
        createdAt: sale.createdAt.toISOString(),
        pagamento: {
          id: sale.id,
          status: 'PAGO',
          valorPago: value,
          dataPagamento: paidAt,
          formaPagamento: sale.paymentMethod ?? 'INDEFINIDO',
          comprovante: null,
          asaasPaymentId: null,
          createdAt: paidAt,
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
