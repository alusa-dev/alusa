/**
 * Orquestração outbound pós-`criarMatricula` (taxa + assinatura + 1º ciclo).
 *
 * Fluxo canônico individual:
 *   criarMatricula (DB acadêmico + cobrança local taxa)
 *   → pushEnrollmentFeeToAsaas (createCharge)
 *   → gate taxa OK
 *   → createEnrollmentSubscription (createSubscription + sync 1º ciclo)
 *
 * Ver também: `apps/web/app/api/matriculas/route.ts`, `@alusa/finance` use cases.
 */

import { FormaPagamento, PeriodicidadePlano } from '@prisma/client';
import { prisma } from '@/src/prisma';
import {
  createCharge,
  createSubscription,
  getAsaasPaymentDetails,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';
import {
  formatIsoDate,
  mapFormaPagamentoToBillingType,
  mapPeriodicidadeToCycle,
  resolveChargeableFirstDueDate,
} from '@/src/server/matriculas/recurring-billing';
import { syncInitialSubscriptionPaymentFromAsaas } from '@/src/server/matriculas/subscription-payment-materialization';
import {
  billingProvisionUpdate,
  deriveBillingProvisionStatusFromSync,
} from '@/src/server/matriculas/billing-provision-status';
import { MatriculaBillingProvisionStatus } from '@prisma/client';
import type {
  MatriculaAsaasSubscriptionSyncDTO,
  MatriculaAsaasTaxaSyncDTO,
} from '@/features/cadastro/matriculas/dtos';

export type EnrollmentBillingCobrancaRef = {
  id: string;
  formaPagamento: FormaPagamento;
  asaasPaymentId?: string | null;
};

export type ProvisionIndividualEnrollmentBillingInput = {
  contaId: string;
  actorUserId: string;
  matriculaId: string;
  payload: {
    criarCobranca: boolean;
    gerarCobrancaTaxa: boolean;
    taxaIsenta: boolean;
  };
  preco: {
    taxa: number;
    planoLiquido: number;
  };
  cobrancas: {
    taxa: EnrollmentBillingCobrancaRef | null;
    mensalidade: EnrollmentBillingCobrancaRef | null;
  };
  matriculaSnapshot: {
    asaasSubscriptionId?: string | null;
  };
};

export type ProvisionIndividualEnrollmentBillingResult = {
  cobrancas: {
    taxa: EnrollmentBillingCobrancaRef | null;
    mensalidade: EnrollmentBillingCobrancaRef | null;
  };
  matriculaSnapshot: {
    asaasSubscriptionId?: string | null;
  };
  taxaSync: MatriculaAsaasTaxaSyncDTO | null;
  subscriptionSync: MatriculaAsaasSubscriptionSyncDTO | null;
};

function logEnrollmentBilling(step: string, meta: Record<string, unknown>) {
  console.info('[enrollment-billing]', { step, ...meta });
}

export async function pushEnrollmentFeeToAsaas(input: {
  contaId: string;
  actorUserId: string;
  matriculaId: string;
  cobrancaTaxa: EnrollmentBillingCobrancaRef;
}): Promise<MatriculaAsaasTaxaSyncDTO> {
  logEnrollmentBilling('taxa.start', {
    matriculaId: input.matriculaId,
    cobrancaId: input.cobrancaTaxa.id,
  });

  if (input.cobrancaTaxa.formaPagamento === FormaPagamento.INDEFINIDO) {
    return { success: false, error: 'FORMA_PAGAMENTO_INVALIDA' };
  }

  const chargeResult = await createCharge({
    contaId: input.contaId,
    cobrancaId: input.cobrancaTaxa.id,
    actor: { type: 'USER', id: input.actorUserId },
  });

  if (!chargeResult.success) {
    return { success: false, error: chargeResult.error };
  }

  const asaasPaymentId = chargeResult.data.asaasPaymentId ?? null;
  if (!asaasPaymentId) {
    return { success: false, error: 'ASAAS_PAYMENT_ID_NAO_RETORNADO' };
  }

  let taxaSync: MatriculaAsaasTaxaSyncDTO = { success: true, asaasPaymentId };

  try {
    const syncResult = await syncPaymentStateFromAsaas({
      contaId: input.contaId,
      asaasPaymentId,
      eventName: 'PAYMENT_CREATED',
    });
    taxaSync = syncResult.success
      ? { success: true, asaasPaymentId }
      : { success: false, error: syncResult.error, asaasPaymentId };
  } catch (err) {
    taxaSync = {
      success: false,
      error: err instanceof Error ? err.message : 'ERRO_SINCRONIZAR_TAXA_ASAAS',
      asaasPaymentId,
    };
  }

  try {
    const details = await getAsaasPaymentDetails({
      contaId: input.contaId,
      paymentId: asaasPaymentId,
      includePixQrCode: false,
    });
    taxaSync = {
      ...taxaSync,
      invoiceUrl: details.payment.invoiceUrl ?? null,
      bankSlipUrl: details.payment.bankSlipUrl ?? null,
    };
  } catch (err) {
    console.warn('[enrollment-billing] Falha ao obter invoiceUrl da taxa', {
      cobrancaId: input.cobrancaTaxa.id,
      asaasPaymentId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  logEnrollmentBilling('taxa.done', {
    matriculaId: input.matriculaId,
    success: taxaSync.success,
  });

  return taxaSync;
}

export async function createEnrollmentSubscription(input: {
  contaId: string;
  actorUserId: string;
  matriculaId: string;
  planoLiquido: number;
}): Promise<{
  subscriptionSync: MatriculaAsaasSubscriptionSyncDTO;
  asaasSubscriptionId: string | null;
  mensalidadeCobranca: EnrollmentBillingCobrancaRef | null;
}> {
  logEnrollmentBilling('subscription.start', { matriculaId: input.matriculaId });

  const recurringContext = await prisma.matricula.findUnique({
    where: { id: input.matriculaId },
    select: {
      id: true,
      dataInicio: true,
      dataFimContrato: true,
      vencimentoDia: true,
      formaPagamento: true,
      descontoAntecipado: true,
      prazoDesconto: true,
      descontoTipo: true,
      jurosMensal: true,
      multaPercentual: true,
      multaTipo: true,
      plano: { select: { id: true, nome: true, periodicidade: true } },
      combo: { select: { id: true, nome: true, periodicidade: true } },
    },
  });

  if (!recurringContext) {
    return {
      subscriptionSync: { success: false, error: 'MATRICULA_NAO_ENCONTRADA' },
      asaasSubscriptionId: null,
      mensalidadeCobranca: null,
    };
  }

  const billingType = mapFormaPagamentoToBillingType(recurringContext.formaPagamento);
  if (!billingType) {
    return {
      subscriptionSync: { success: false, error: 'FORMA_PAGAMENTO_INVALIDA' },
      asaasSubscriptionId: null,
      mensalidadeCobranca: null,
    };
  }

  const planoOuCombo = recurringContext.combo ?? recurringContext.plano;
  const periodicidade = (planoOuCombo?.periodicidade ??
    PeriodicidadePlano.MENSAL) as PeriodicidadePlano;
  const nextDueDateObj = resolveChargeableFirstDueDate(
    recurringContext.dataInicio,
    recurringContext.vencimentoDia,
  );
  const nextDueDate = formatIsoDate(nextDueDateObj);
  const endDate = formatIsoDate(recurringContext.dataFimContrato);
  const discountValue = recurringContext.descontoAntecipado
    ? Number(recurringContext.descontoAntecipado)
    : 0;
  const interestValue = recurringContext.jurosMensal ? Number(recurringContext.jurosMensal) : 0;
  const fineValue = recurringContext.multaPercentual
    ? Number(recurringContext.multaPercentual)
    : 0;

  const subscriptionResult = await createSubscription({
    contaId: input.contaId,
    contratoId: null,
    matriculaId: input.matriculaId,
    value: input.planoLiquido,
    nextDueDate,
    billingType,
    cycle: mapPeriodicidadeToCycle(periodicidade),
    description: planoOuCombo?.nome ? `Mensalidade - ${planoOuCombo.nome}` : 'Mensalidade',
    endDate,
    discount:
      discountValue > 0
        ? {
            value: discountValue,
            dueDateLimitDays: recurringContext.prazoDesconto ?? 0,
            type: (recurringContext.descontoTipo ?? 'PERCENTAGE') as 'FIXED' | 'PERCENTAGE',
          }
        : undefined,
    interest: interestValue > 0 ? { value: interestValue } : undefined,
    fine:
      fineValue > 0
        ? {
            value: fineValue,
            type: (recurringContext.multaTipo ?? 'PERCENTAGE') as 'FIXED' | 'PERCENTAGE',
          }
        : undefined,
    actor: { type: 'USER', id: input.actorUserId },
  });

  if (!subscriptionResult.success) {
    return {
      subscriptionSync: { success: false, error: subscriptionResult.error },
      asaasSubscriptionId: null,
      mensalidadeCobranca: null,
    };
  }

  if (!subscriptionResult.data.asaasSubscriptionId) {
    return {
      subscriptionSync: { success: false, error: 'ASSINATURA_SEM_ID_ASAAS' },
      asaasSubscriptionId: null,
      mensalidadeCobranca: null,
    };
  }

  const initialPaymentSync = await syncInitialSubscriptionPaymentFromAsaas({
    contaId: input.contaId,
    asaasSubscriptionId: subscriptionResult.data.asaasSubscriptionId,
    targetDueDate: nextDueDateObj,
    intent: 'RECONCILIATION',
  });

  let mensalidadeCobranca: EnrollmentBillingCobrancaRef | null = null;
  if (initialPaymentSync.localCharge) {
    const fullCharge = await prisma.cobranca.findFirst({
      where: { id: initialPaymentSync.localCharge.id, contaId: input.contaId },
    });
    if (fullCharge) {
      mensalidadeCobranca = {
        id: fullCharge.id,
        formaPagamento: fullCharge.formaPagamento,
        asaasPaymentId: fullCharge.asaasPaymentId,
      };
    }
  }

  const subscriptionSync: MatriculaAsaasSubscriptionSyncDTO = {
    success: initialPaymentSync.processed || !initialPaymentSync.found,
    asaasSubscriptionId: subscriptionResult.data.asaasSubscriptionId ?? null,
    asaasPaymentId: initialPaymentSync.payment?.id ?? null,
    invoiceUrl: initialPaymentSync.payment?.invoiceUrl ?? null,
    bankSlipUrl: initialPaymentSync.payment?.bankSlipUrl ?? null,
    expectedWebhooks:
      initialPaymentSync.processed || initialPaymentSync.found
        ? []
        : ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'],
    message: initialPaymentSync.processed
      ? 'A assinatura e o primeiro ciclo foram sincronizados diretamente da API oficial do Asaas.'
      : initialPaymentSync.found
        ? 'A assinatura foi criada no Asaas, mas o primeiro ciclo oficial não pôde ser materializado localmente neste momento.'
        : 'A assinatura foi criada no Asaas. O primeiro ciclo será confirmado pelo webhook oficial assim que estiver disponível.',
    error:
      initialPaymentSync.processed || !initialPaymentSync.found
        ? undefined
        : (initialPaymentSync.error ?? 'ERRO_SINCRONIZAR_PRIMEIRO_CICLO'),
  };

  logEnrollmentBilling('subscription.done', {
    matriculaId: input.matriculaId,
    success: subscriptionSync.success,
    asaasSubscriptionId: subscriptionResult.data.asaasSubscriptionId,
  });

  return {
    subscriptionSync,
    asaasSubscriptionId: subscriptionResult.data.asaasSubscriptionId,
    mensalidadeCobranca,
  };
}

export async function provisionIndividualEnrollmentBilling(
  input: ProvisionIndividualEnrollmentBillingInput,
): Promise<ProvisionIndividualEnrollmentBillingResult> {
  const result: ProvisionIndividualEnrollmentBillingResult = {
    cobrancas: { ...input.cobrancas },
    matriculaSnapshot: { ...input.matriculaSnapshot },
    taxaSync: null,
    subscriptionSync: null,
  };

  const requiresTaxConfirmation =
    input.payload.gerarCobrancaTaxa &&
    !input.payload.taxaIsenta &&
    Number(input.preco.taxa ?? 0) > 0;

  await prisma.matricula.update({
    where: { id: input.matriculaId },
    data: billingProvisionUpdate(MatriculaBillingProvisionStatus.PROCESSANDO),
  });

  if (requiresTaxConfirmation && !result.cobrancas.taxa) {
    result.taxaSync = { success: false, error: 'COBRANCA_TAXA_NAO_ENCONTRADA' };
  }

  if (result.cobrancas.taxa && requiresTaxConfirmation) {
    result.taxaSync = await pushEnrollmentFeeToAsaas({
      contaId: input.contaId,
      actorUserId: input.actorUserId,
      matriculaId: input.matriculaId,
      cobrancaTaxa: result.cobrancas.taxa,
    });

    if (result.taxaSync.asaasPaymentId && result.cobrancas.taxa) {
      result.cobrancas.taxa = {
        ...result.cobrancas.taxa,
        asaasPaymentId: result.taxaSync.asaasPaymentId,
      };
    }
  }

  const shouldCreateSubscription =
    input.payload.criarCobranca && input.preco.planoLiquido > 0;
  const subscriptionBlockedByTax = requiresTaxConfirmation && !result.taxaSync?.success;

  if (shouldCreateSubscription && subscriptionBlockedByTax) {
    result.subscriptionSync = {
      success: false,
      error: 'TAXA_ASAAS_NAO_CONFIRMADA',
      message:
        'A mensalidade não foi criada porque a taxa de matrícula ainda não foi confirmada pelo Asaas.',
    };
  }

  if (shouldCreateSubscription && !subscriptionBlockedByTax) {
    const subscriptionOutcome = await createEnrollmentSubscription({
      contaId: input.contaId,
      actorUserId: input.actorUserId,
      matriculaId: input.matriculaId,
      planoLiquido: input.preco.planoLiquido,
    });

    result.subscriptionSync = subscriptionOutcome.subscriptionSync;
    if (subscriptionOutcome.asaasSubscriptionId) {
      result.matriculaSnapshot.asaasSubscriptionId = subscriptionOutcome.asaasSubscriptionId;
    }
    if (subscriptionOutcome.mensalidadeCobranca) {
      result.cobrancas.mensalidade = subscriptionOutcome.mensalidadeCobranca;
    }
  }

  const finalStatus = deriveBillingProvisionStatusFromSync({
    requiresTax: requiresTaxConfirmation,
    taxaSyncSuccess: result.taxaSync?.success ?? null,
    shouldCreateSubscription,
    subscriptionSyncSuccess: result.subscriptionSync?.success ?? null,
    hasAsaasSubscriptionId: Boolean(result.matriculaSnapshot.asaasSubscriptionId),
  });

  await prisma.matricula.update({
    where: { id: input.matriculaId },
    data: billingProvisionUpdate(
      finalStatus,
      result.subscriptionSync?.error ?? result.taxaSync?.error ?? null,
    ),
  });

  return result;
}
