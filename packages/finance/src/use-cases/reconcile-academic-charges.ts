import { prisma } from '@alusa/database';
import type { Cobranca, StatusCobranca } from '@prisma/client';

import { chargeReadModelService } from '../read-model/charge-read-model.service';
import {
  canApplyChargeStatusTransition,
  computeNextChargeStatus,
  computeNextCobrancaStatus,
  mapAsaasStatusToInternal,
} from '../mappers';
import { updateFinanceStatusFromPayment } from '../guards/finance-status-guard';
import { recordAsaasReadIntent } from '../foundation/asaas-read-intent';
import { getPayment, isAsaasEnabled } from './asaas-ops';

type ReconciledCobranca = Pick<
  Cobranca,
  | 'id'
  | 'matriculaId'
  | 'tipo'
  | 'status'
  | 'asaasPaymentId'
  | 'asaasStatus'
  | 'vencimento'
  | 'dataPagamento'
  | 'pagoEm'
  | 'liquidacaoStatus'
  | 'liquidadoEm'
>;

export type ReconcileAcademicChargesResult = {
  checked: number;
  updated: number;
  items: Map<string, ReconciledCobranca>;
};

const RECONCILIABLE_STATUSES: StatusCobranca[] = [
  'A_VENCER',
  'PENDENTE',
  'PROCESSANDO',
  'ATRASADO',
];

function parseAsaasDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseAsaasDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? parseAsaasDate(value) : parsed;
}

function resolveLiquidacaoStatus(payment: {
  status: string;
  creditDate?: string | null;
  estimatedCreditDate?: string | null;
}) {
  if (payment.status === 'RECEIVED_IN_CASH') return 'DISPONIVEL' as const;
  if (payment.status === 'RECEIVED' || payment.status === 'CONFIRMED') {
    return payment.creditDate ? ('DISPONIVEL' as const) : ('PENDENTE' as const);
  }
  return 'NAO_APLICAVEL' as const;
}

function resolveFinanceStatus(params: {
  chargeType: string;
  nextChargeStatus: StatusCobranca;
}) {
  if (params.chargeType !== 'TAXA_MATRICULA') return null;
  if (params.nextChargeStatus === 'PAGO') return 'ADIMPLENTE' as const;
  if (params.nextChargeStatus === 'ATRASADO') return 'INADIMPLENTE' as const;
  return null;
}

export async function reconcileAcademicChargesWithAsaas(params: {
  contaId: string;
  cobrancaIds?: string[];
  limit?: number;
  force?: boolean;
}): Promise<ReconcileAcademicChargesResult> {
  if (!isAsaasEnabled()) {
    return { checked: 0, updated: 0, items: new Map() };
  }

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const cobrancas = await prisma.cobranca.findMany({
    where: {
      ...(params.cobrancaIds?.length ? { id: { in: params.cobrancaIds } } : {}),
      asaasPaymentId: { not: null },
      matricula: { aluno: { contaId: params.contaId } },
      ...(params.force ? {} : { status: { in: RECONCILIABLE_STATUSES } }),
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      matriculaId: true,
      tipo: true,
      status: true,
      asaasPaymentId: true,
      asaasStatus: true,
      vencimento: true,
      dataPagamento: true,
      pagoEm: true,
      liquidacaoStatus: true,
      liquidadoEm: true,
      charge: {
        select: {
          id: true,
          status: true,
          asaasPaymentId: true,
        },
      },
    },
  });

  const items = new Map<string, ReconciledCobranca>();
  let updated = 0;

  for (const cobranca of cobrancas) {
    if (!cobranca.asaasPaymentId) continue;

    try {
      recordAsaasReadIntent('RECONCILIATION');
      const payment = await getPayment(cobranca.asaasPaymentId, { contaId: params.contaId });
      const dueDate = parseAsaasDate(payment.dueDate) ?? cobranca.vencimento;
      const statusDecision = computeNextCobrancaStatus({
        currentStatus: cobranca.status,
        asaasPaymentStatus: payment.status,
        billingType: payment.billingType,
        dueDate,
      });
      const nextStatus = statusDecision.nextStatus;
      const paymentDate =
        parseAsaasDateTime(payment.creditDate) ??
        parseAsaasDateTime(payment.paymentDate) ??
        parseAsaasDateTime(payment.clientPaymentDate) ??
        parseAsaasDateTime(payment.confirmedDate);
      const liquidacaoStatus = resolveLiquidacaoStatus(payment);
      const liquidadoEm =
        liquidacaoStatus === 'DISPONIVEL'
          ? parseAsaasDateTime(payment.creditDate) ?? paymentDate
          : null;
      const feeValue =
        typeof payment.netValue === 'number' ? Number(payment.value) - Number(payment.netValue) : null;

      const data = {
        status: nextStatus,
        vencimento: dueDate,
        asaasStatus: payment.status,
        asaasValue: payment.value,
        asaasNetValue: payment.netValue,
        asaasOriginalValue: payment.originalValue ?? null,
        asaasFeeValue: feeValue,
        asaasCreditDate: parseAsaasDateTime(payment.creditDate),
        asaasEstimatedCreditDate: parseAsaasDateTime(payment.estimatedCreditDate),
        lastAsaasFetchAt: new Date(),
        liquidacaoStatus,
        liquidadoEm,
        ...(nextStatus === 'PAGO' && paymentDate
          ? { dataPagamento: paymentDate, pagoEm: paymentDate }
          : {}),
      };

      const localChanged =
        cobranca.status !== nextStatus ||
        cobranca.asaasStatus !== payment.status ||
        cobranca.vencimento.getTime() !== dueDate.getTime() ||
        cobranca.liquidacaoStatus !== liquidacaoStatus ||
        (cobranca.liquidadoEm?.getTime() ?? null) !== (liquidadoEm?.getTime() ?? null);

      let nextCobranca: ReconciledCobranca = {
        id: cobranca.id,
        matriculaId: cobranca.matriculaId,
        tipo: cobranca.tipo,
        status: nextStatus,
        asaasPaymentId: cobranca.asaasPaymentId,
        asaasStatus: payment.status,
        vencimento: dueDate,
        dataPagamento: nextStatus === 'PAGO' && paymentDate ? paymentDate : cobranca.dataPagamento,
        pagoEm: nextStatus === 'PAGO' && paymentDate ? paymentDate : cobranca.pagoEm,
        liquidacaoStatus,
        liquidadoEm,
      };

      if (localChanged) {
        nextCobranca = await prisma.cobranca.update({
          where: { id: cobranca.id },
          data,
          select: {
            id: true,
            matriculaId: true,
            tipo: true,
            status: true,
            asaasPaymentId: true,
            asaasStatus: true,
            vencimento: true,
            dataPagamento: true,
            pagoEm: true,
            liquidacaoStatus: true,
            liquidadoEm: true,
          },
        });
        updated++;
      }

      if (cobranca.tipo === 'TAXA_MATRICULA' && nextStatus === 'PAGO') {
        await prisma.matricula.updateMany({
          where: { id: cobranca.matriculaId, taxaStatus: { not: 'PAGO' } },
          data: { taxaStatus: 'PAGO' },
        });
      }

      const nextFinanceStatus = resolveFinanceStatus({
        chargeType: cobranca.tipo,
        nextChargeStatus: nextStatus,
      });
      if (nextFinanceStatus) {
        await updateFinanceStatusFromPayment({
          matriculaId: cobranca.matriculaId,
          newStatus: nextFinanceStatus,
          eventName: 'ASAAS_RECONCILIATION',
          reason: 'Reconciliação com Asaas',
        });
      }

      if (cobranca.charge) {
        const effectiveChargeStatus = computeNextChargeStatus({
          currentStatus: cobranca.charge.status,
          internalStatus: mapAsaasStatusToInternal(payment.status),
        });
        if (
          cobranca.charge.status !== effectiveChargeStatus &&
          canApplyChargeStatusTransition({
            current: cobranca.charge.status,
            next: effectiveChargeStatus,
            eventName: 'ASAAS_RECONCILIATION',
          })
        ) {
          await prisma.charge.update({
            where: { id: cobranca.charge.id },
            data: {
              status: effectiveChargeStatus,
              statusUpdatedAt: new Date(),
              asaasPaymentId: cobranca.charge.asaasPaymentId ?? cobranca.asaasPaymentId,
            },
          });
        }

        await chargeReadModelService.projectChargeReadModelByChargeId(cobranca.charge.id);
      }

      await chargeReadModelService.projectChargeReadModelByCobrancaId(cobranca.id);
      items.set(cobranca.id, nextCobranca);
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[finance][reconcileAcademicChargesWithAsaas] falha ao reconciliar cobrança', {
          cobrancaId: cobranca.id,
          asaasPaymentId: cobranca.asaasPaymentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { checked: cobrancas.length, updated, items };
}
