import {
  auditLogService,
  createStandaloneCharge,
  deleteCharge,
  deletePayment,
  FORMA_PAGAMENTO_TO_ASAAS,
  getMobileBillingSummary,
  markChargeAsPaid,
  numberFromFinanceDecimal,
  readPaymentFullPreflight,
  refundCobranca,
  resolveMobileBillingCategory,
  roundFinanceCurrency,
  runAsaasPaymentCommand,
  syncPaymentStateFromAsaas,
  updateCharge,
  updatePayment,
  undoCashPayment,
  evaluatePaymentActionPolicy,
  type MobileBillingCategory,
  type MobileBillingPeriod,
  type AsaasBillingType,
} from '@alusa/finance';

import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';

export type MobileBillingActor = { userId: string; contaId: string };

export type MobileBillingChargesSort =
  | 'created-at-desc'
  | 'created-at-asc'
  | 'priority'
  | 'due-date-asc'
  | 'due-date-desc'
  | 'amount-desc'
  | 'amount-asc';

export type MobileBillingOrigin = 'ACADEMIC' | 'STANDALONE';

export type MobileBillingAction =
  | 'CONFIRM_CASH_PAYMENT'
  | 'CANCEL'
  | 'REFUND'
  | 'UNDO_CASH_PAYMENT'
  | 'UPDATE_CHARGE'
  | 'UPDATE_RULES';

export type MobileBillingChargeChanges = {
  amount?: number;
  dueDate?: string;
  description?: string;
  paymentMethod?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | 'INDEFINIDO';
  interestPercent?: number;
  finePercent?: number;
  discountValue?: number;
  discountType?: 'FIXED' | 'PERCENTAGE';
  discountDueDateLimitDays?: number;
};

export type MobileBillingMetric = { count: number; amount: number };

export type MobileBillingCharge = {
  id: string;
  category: Exclude<MobileBillingCategory, 'IGNORED'>;
  studentName: string;
  description: string;
  amount: number;
  dueDate: string | null;
  paidAt: string | null;
  eventDate: string | null;
  createdAt: string | null;
  originalStatus: string;
  paymentMethod: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  financialRules: {
    interestPercent: number | null;
    finePercent: number | null;
    discountValue: number | null;
    discountType: string | null;
    discountDueDateLimitDays: number | null;
  };
  origin: 'ACADEMIC' | 'STANDALONE';
  capabilities: {
    canEdit: boolean;
    canEditRules: boolean;
    canConfirmCashPayment: boolean;
    canCancel: boolean;
    canRefund: boolean;
    canUndoCashPayment: boolean;
  };
};

export class MobileBillingUnauthorizedError extends Error {
  constructor() {
    super('Usuário sem acesso à conta ativa.');
    this.name = 'MobileBillingUnauthorizedError';
  }
}

/**
 * Valida a associação do usuário mobile com a conta ativa antes de uma
 * operação financeira. A transação é curta e não envolve chamadas externas.
 */
export async function assertMobileBillingActor(actor: MobileBillingActor) {
  await withAuthorizedTenant(actor, async () => undefined);
}

export type MobileStandaloneChargeInput = {
  payer:
    | { type: 'aluno'; alunoId: string }
    | { type: 'responsavel'; responsavelId: string };
  chargeType: 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION';
  billingType: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED';
  description?: string;
  value?: number;
  dueDate?: string;
  installmentCount?: number;
  installmentValue?: number;
  nextDueDate?: string;
  endDate?: string;
  cycle?: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
  discount?: { value: number; type: 'FIXED' | 'PERCENTAGE'; dueDateLimitDays?: number };
  interest?: { value: number };
  fine?: { value: number; type: 'FIXED' | 'PERCENTAGE' };
  uiRequestId?: string;
};

export async function createMobileStandaloneCharge(input: {
  actor: MobileBillingActor;
  charge: MobileStandaloneChargeInput;
}) {
  return createStandaloneCharge({
    contaId: input.actor.contaId,
    actor: { type: 'USER', id: input.actor.userId },
    ...input.charge,
  });
}

async function assertActiveMembership(tx: TenantTransactionClient, actor: MobileBillingActor) {
  const membership = await tx.usuarioConta.findFirst({
    where: {
      usuarioId: actor.userId,
      contaId: actor.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { id: true, role: true },
  });
  if (!membership || !['ADMIN', 'FINANCEIRO'].includes(membership.role.toUpperCase())) {
    throw new MobileBillingUnauthorizedError();
  }
}

async function withAuthorizedTenant<T>(actor: MobileBillingActor, callback: (_tx: TenantTransactionClient) => Promise<T>) {
  return runWithTenant(actor.contaId, async (tx) => {
    await assertActiveMembership(tx, actor);
    const account = await tx.conta.findFirst({
      where: { id: actor.contaId, status: 'ATIVO', deletedAt: null },
      select: { id: true },
    });
    if (!account) throw new MobileBillingUnauthorizedError();
    return callback(tx);
  });
}

type MobileBillingActionTarget = {
  id: string;
  origin: 'ACADEMIC' | 'STANDALONE';
  asaasPaymentId: string | null;
  amount: number;
  localStatus: string;
  paymentMethod: string | null;
  dueDate: Date | null;
  description: string | null;
};

export async function executeMobileBillingAction(input: {
  actor: MobileBillingActor;
  chargeId: string;
  action: MobileBillingAction;
  changes?: MobileBillingChargeChanges;
}) {
  const target = await withAuthorizedTenant(input.actor, async (tx) => {
    const academic = await tx.cobranca.findFirst({
      where: {
        id: input.chargeId,
        contaId: input.actor.contaId,
        matricula: { contaId: input.actor.contaId, aluno: { contaId: input.actor.contaId } },
      },
      select: { id: true, asaasPaymentId: true, valorFinal: true, valor: true, status: true, formaPagamento: true, vencimento: true, descricao: true },
    });
    if (academic) {
      return {
        id: academic.id,
        origin: 'ACADEMIC' as const,
        asaasPaymentId: academic.asaasPaymentId,
        amount: numberFromFinanceDecimal(academic.valorFinal ?? academic.valor),
        localStatus: academic.status,
        paymentMethod: academic.formaPagamento,
        dueDate: academic.vencimento,
        description: academic.descricao,
      } satisfies MobileBillingActionTarget;
    }

    const standalone = await tx.charge.findFirst({
      where: { id: input.chargeId, contaId: input.actor.contaId, cobrancaId: null },
      select: { id: true, asaasPaymentId: true, value: true, asaasValue: true, status: true, billingType: true, dueDate: true, description: true },
    });
    return standalone
      ? {
          id: standalone.id,
          origin: 'STANDALONE' as const,
          asaasPaymentId: standalone.asaasPaymentId,
          amount: numberFromFinanceDecimal(standalone.asaasValue ?? standalone.value),
          localStatus: standalone.status,
          paymentMethod: standalone.billingType,
          dueDate: standalone.dueDate,
          description: standalone.description,
        } satisfies MobileBillingActionTarget
      : null;
  });

  if (!target) return { success: false as const, code: 'NOT_FOUND', error: 'Cobrança não encontrada.' };

  if (input.action === 'UPDATE_CHARGE' || input.action === 'UPDATE_RULES') {
    const changes = input.changes ?? {};
    if (target.origin === 'ACADEMIC') {
      const result = await updateCharge({
        chargeId: target.id,
        contaId: input.actor.contaId,
        userId: input.actor.userId,
        changes: toFinanceChanges(changes, input.action === 'UPDATE_RULES'),
      });
      if (!result.success) return { success: false as const, code: result.code, error: result.error };
    } else {
      const result = input.action === 'UPDATE_RULES'
        ? await updateStandaloneRules(input.actor, target, changes)
        : await updateStandaloneCharge(input.actor, target, changes);
      if (!result.success) return result;
    }
    if (changes.paymentMethod && changes.paymentMethod !== target.paymentMethod) {
      const result = await updateMobilePaymentMethod(input.actor, target, changes.paymentMethod);
      if (!result.success) return result;
    }
    return { success: true as const, message: 'Alteração enviada. O status final será confirmado pelo Asaas.' };
  }

  if (input.action === 'CONFIRM_CASH_PAYMENT') {
    const result = await markChargeAsPaid({
      chargeId: target.id,
      contaId: input.actor.contaId,
      userId: input.actor.userId,
      formaPagamentoManual: 'DINHEIRO',
      notifyCustomer: false,
    });
    return result.success
      ? { success: true as const, message: 'Recebimento em dinheiro solicitado.' }
      : { success: false as const, code: result.code, error: result.error };
  }

  if (input.action === 'CANCEL') {
    if (target.origin !== 'ACADEMIC') {
      return { success: false as const, code: 'ACTION_NOT_SUPPORTED', error: 'O cancelamento desta cobrança ainda não está disponível no aplicativo.' };
    }
    const result = await deleteCharge({
      chargeId: target.id,
      contaId: input.actor.contaId,
      userId: input.actor.userId,
      hardDelete: false,
    });
    return result.success
      ? { success: true as const, message: 'Cobrança cancelada.' }
      : { success: false as const, code: result.code, error: result.error };
  }

  if (!target.asaasPaymentId) {
    return { success: false as const, code: 'NO_PROVIDER_PAYMENT', error: 'Esta cobrança não possui pagamento integrado ao Asaas.' };
  }

  const payment = await readPaymentFullPreflight(target.asaasPaymentId, { contaId: input.actor.contaId });
  const providerStatus = String(payment.status ?? '').toUpperCase();

  if (input.action === 'UNDO_CASH_PAYMENT') {
    if (providerStatus !== 'RECEIVED_IN_CASH') {
      return { success: false as const, code: 'ACTION_NOT_ALLOWED', error: 'Desfazer recebimento está disponível apenas para pagamentos recebidos em dinheiro.' };
    }
    const command = await runAsaasPaymentCommand({
      contaId: input.actor.contaId,
      type: 'PAYMENT_UNDO_CASH_COMMAND',
      entityType: target.origin === 'ACADEMIC' ? 'COBRANCA' : 'CHARGE',
      entityId: target.id,
      asaasPaymentId: target.asaasPaymentId,
      actorId: input.actor.userId,
      chargeId: target.origin === 'STANDALONE' ? target.id : null,
      cobrancaId: target.origin === 'ACADEMIC' ? target.id : null,
      providerStatus,
      metadata: { source: 'mobile-billing', action: input.action, previousProviderStatus: providerStatus },
      run: () => undoCashPayment(target.asaasPaymentId!, { contaId: input.actor.contaId }),
    });
    await syncPaymentStateFromAsaas({ contaId: input.actor.contaId, asaasPaymentId: target.asaasPaymentId, eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE' });
    await auditLogService.record({ contaId: input.actor.contaId, action: 'finance.charge.undo_cash_requested', entity: { type: target.origin === 'ACADEMIC' ? 'Cobranca' : 'Charge', id: target.id }, actor: { type: 'USER', id: input.actor.userId }, metadata: { source: 'mobile-billing', commandJobId: command.commandJobId, correlationId: command.correlationId, asaasPaymentId: target.asaasPaymentId } });
    return { success: true as const, message: 'Desfazer recebimento solicitado. O status será atualizado via webhook.' };
  }

  if (!['RECEIVED', 'CONFIRMED'].includes(providerStatus)) {
    return { success: false as const, code: 'ACTION_NOT_ALLOWED', error: 'Estorno disponível apenas para pagamentos recebidos ou confirmados.' };
  }
  const command = await runAsaasPaymentCommand({
    contaId: input.actor.contaId,
    type: 'PAYMENT_REFUND_COMMAND',
    entityType: target.origin === 'ACADEMIC' ? 'COBRANCA' : 'CHARGE',
    entityId: target.id,
    asaasPaymentId: target.asaasPaymentId,
    actorId: input.actor.userId,
    chargeId: target.origin === 'STANDALONE' ? target.id : null,
    cobrancaId: target.origin === 'ACADEMIC' ? target.id : null,
    providerStatus,
    metadata: { source: 'mobile-billing', action: input.action, previousProviderStatus: providerStatus, amount: target.amount },
    run: () => refundCobranca({ paymentId: target.asaasPaymentId!, contaId: input.actor.contaId, description: `Estorno solicitado via Alusa` }),
  });
  await syncPaymentStateFromAsaas({ contaId: input.actor.contaId, asaasPaymentId: target.asaasPaymentId, eventName: 'PAYMENT_REFUNDED' });
  await auditLogService.record({ contaId: input.actor.contaId, action: 'finance.charge.refund_requested', entity: { type: target.origin === 'ACADEMIC' ? 'Cobranca' : 'Charge', id: target.id }, actor: { type: 'USER', id: input.actor.userId }, metadata: { source: 'mobile-billing', commandJobId: command.commandJobId, correlationId: command.correlationId, asaasPaymentId: target.asaasPaymentId } });
  return { success: true as const, message: 'Estorno solicitado. O status será atualizado via webhook.' };
}

function toFinanceChanges(changes: MobileBillingChargeChanges, rulesOnly: boolean) {
  const result: Parameters<typeof updateCharge>[0]['changes'] = {};
  if (!rulesOnly && changes.amount !== undefined) result.valor = changes.amount;
  if (!rulesOnly && changes.dueDate !== undefined) result.vencimento = changes.dueDate;
  if (!rulesOnly && changes.description !== undefined) result.descricao = changes.description;
  if (changes.interestPercent !== undefined) result.jurosPercentual = changes.interestPercent;
  if (changes.finePercent !== undefined) result.multaPercentual = changes.finePercent;
  if (changes.discountType === 'FIXED' && changes.discountValue !== undefined) {
    result.descontoTipo = 'VALOR_FIXO';
    result.descontoValorFixo = changes.discountValue;
    result.descontoPercentual = 0;
  }
  if (changes.discountType === 'PERCENTAGE' && changes.discountValue !== undefined) {
    result.descontoTipo = 'PERCENTUAL';
    result.descontoPercentual = changes.discountValue;
    result.descontoValorFixo = 0;
  }
  if (changes.discountDueDateLimitDays !== undefined) result.descontoPrazoMaximo = discountLimitCode(changes.discountDueDateLimitDays);
  return result;
}

function discountLimitCode(days: number) {
  if (days === 1) return '1_DIA';
  if (days === 3) return '3_DIAS';
  if (days === 7) return '7_DIAS';
  if (days === 15) return '15_DIAS';
  if (days === 30) return '30_DIAS';
  return 'ATE_VENCIMENTO';
}

async function updateStandaloneCharge(actor: MobileBillingActor, target: MobileBillingActionTarget, changes: MobileBillingChargeChanges) {
  if (!target.asaasPaymentId) return { success: false as const, code: 'NO_PROVIDER_PAYMENT', error: 'Esta cobrança não possui pagamento integrado ao Asaas.' };
  if (!['CREATED', 'OPEN', 'OVERDUE'].includes(target.localStatus)) return { success: false as const, code: 'STATUS_NOT_EDITABLE', error: 'Apenas cobranças em aberto podem ser editadas.' };
  const payment = await readPaymentFullPreflight(target.asaasPaymentId, { contaId: actor.contaId });
  if (!['PENDING', 'OVERDUE'].includes(String(payment.status ?? '').toUpperCase())) return { success: false as const, code: 'ASAAS_STATUS_NOT_EDITABLE', error: 'Esta cobrança não pode mais ser editada no Asaas.' };
  const payload: Record<string, unknown> = {};
  if (changes.amount !== undefined) payload.value = changes.amount;
  if (changes.dueDate !== undefined) payload.dueDate = changes.dueDate;
  if (changes.description !== undefined) payload.description = changes.description;
  await updatePayment(target.asaasPaymentId, payload as Parameters<typeof updatePayment>[1], { contaId: actor.contaId });
  await withAuthorizedTenant(actor, async (tx) => tx.charge.update({ where: { id: target.id }, data: {
    ...(changes.amount !== undefined ? { value: changes.amount } : {}),
    ...(changes.dueDate !== undefined ? { dueDate: new Date(changes.dueDate) } : {}),
    ...(changes.description !== undefined ? { description: changes.description } : {}),
  } }));
  await auditLogService.record({ contaId: actor.contaId, action: 'finance.charge.updated', entity: { type: 'Charge', id: target.id }, actor: { type: 'USER', id: actor.userId }, metadata: { source: 'mobile-billing', changes, asaasPaymentId: target.asaasPaymentId } });
  return { success: true as const };
}

async function updateStandaloneRules(actor: MobileBillingActor, target: MobileBillingActionTarget, changes: MobileBillingChargeChanges) {
  if (!target.asaasPaymentId) return { success: false as const, code: 'NO_PROVIDER_PAYMENT', error: 'Esta cobrança não possui pagamento integrado ao Asaas.' };
  if (!['CREATED', 'OPEN', 'OVERDUE'].includes(target.localStatus)) return { success: false as const, code: 'STATUS_NOT_EDITABLE', error: 'Apenas cobranças em aberto podem ser editadas.' };
  const payment = await readPaymentFullPreflight(target.asaasPaymentId, { contaId: actor.contaId });
  if (!['PENDING', 'OVERDUE'].includes(String(payment.status ?? '').toUpperCase())) return { success: false as const, code: 'ASAAS_STATUS_NOT_EDITABLE', error: 'Esta cobrança não pode mais ser editada no Asaas.' };
  const discountType = changes.discountType ?? 'FIXED';
  const payload = {
    interest: { value: changes.interestPercent ?? 0 },
    fine: { value: changes.finePercent ?? 0, type: 'PERCENTAGE' as const },
    discount: { value: changes.discountValue ?? 0, type: discountType, dueDateLimitDays: changes.discountDueDateLimitDays ?? 0 },
  };
  await updatePayment(target.asaasPaymentId, payload, { contaId: actor.contaId });
  await withAuthorizedTenant(actor, async (tx) => tx.charge.update({
    where: { id: target.id },
    data: {
      interestValue: payload.interest.value,
      fineValue: payload.fine.value,
      fineType: payload.fine.type,
      discountValue: payload.discount.value,
      discountType: payload.discount.type,
      discountDueDateLimitDays: payload.discount.dueDateLimitDays,
    },
  }));
  await auditLogService.record({ contaId: actor.contaId, action: 'finance.charge.updated', entity: { type: 'Charge', id: target.id }, actor: { type: 'USER', id: actor.userId }, metadata: { source: 'mobile-billing', changes, asaasPaymentId: target.asaasPaymentId } });
  return { success: true as const };
}

async function updateMobilePaymentMethod(actor: MobileBillingActor, target: MobileBillingActionTarget, paymentMethod: NonNullable<MobileBillingChargeChanges['paymentMethod']>) {
  if (!target.asaasPaymentId) return { success: false as const, code: 'NO_PROVIDER_PAYMENT', error: 'Esta cobrança não possui pagamento integrado ao Asaas.' };
  const billingType = FORMA_PAGAMENTO_TO_ASAAS[paymentMethod];
  if (!billingType) return { success: false as const, code: 'INVALID_INPUT', error: 'Forma de pagamento inválida.' };
  const payment = await readPaymentFullPreflight(target.asaasPaymentId, { contaId: actor.contaId });
  if (!['PENDING', 'OVERDUE'].includes(String(payment.status ?? '').toUpperCase())) return { success: false as const, code: 'ASAAS_STATUS_NOT_EDITABLE', error: 'Esta cobrança não pode mais ser editada no Asaas.' };
  await updatePayment(target.asaasPaymentId, { billingType: billingType as AsaasBillingType, value: Number(payment.value ?? target.amount), dueDate: payment.dueDate ?? target.dueDate?.toISOString().slice(0, 10) }, { contaId: actor.contaId });
  await withAuthorizedTenant(actor, async (tx) => target.origin === 'ACADEMIC'
    ? tx.cobranca.update({ where: { id: target.id }, data: { formaPagamento: paymentMethod } })
    : tx.charge.update({ where: { id: target.id }, data: { billingType } }));
  await auditLogService.record({ contaId: actor.contaId, action: 'finance.charge.payment_method_updated', entity: { type: target.origin === 'ACADEMIC' ? 'Cobranca' : 'Charge', id: target.id }, actor: { type: 'USER', id: actor.userId }, metadata: { source: 'mobile-billing', paymentMethod, billingType, asaasPaymentId: target.asaasPaymentId } });
  return { success: true as const };
}

function resolveMobileBillingCapabilities(input: {
  origin: 'ACADEMIC' | 'STANDALONE';
  localStatus: string;
  asaasStatus: string | null;
  asaasPaymentId: string | null;
  paymentMethod: string | null;
  invoiceUrl: string | null;
}) {
  const providerStatus = input.asaasStatus?.trim().toUpperCase() ?? null;
  const localStatus = input.localStatus.trim().toUpperCase();
  const policy = evaluatePaymentActionPolicy({
    entityType: input.origin === 'ACADEMIC' ? 'COBRANCA' : 'CHARGE',
    origin: input.origin,
    localStatus,
    asaasStatus: providerStatus,
    billingType: input.paymentMethod,
    hasAsaasPaymentId: Boolean(input.asaasPaymentId),
    hasInvoiceUrl: Boolean(input.invoiceUrl),
    wasReceivedInCash: providerStatus === 'RECEIVED_IN_CASH' || input.paymentMethod?.toUpperCase() === 'DINHEIRO',
  });
  const locallyEditable = input.origin === 'ACADEMIC'
    ? ['PENDENTE', 'A_VENCER', 'ATRASADO'].includes(localStatus)
    : ['CREATED', 'OPEN', 'OVERDUE'].includes(localStatus);
  const locallyPayable = input.origin === 'ACADEMIC'
    ? ['PENDENTE', 'A_VENCER', 'ATRASADO'].includes(localStatus)
    : ['CREATED', 'PENDING_SYNC', 'OPEN', 'OVERDUE'].includes(localStatus);
  const providerReceivable = !providerStatus || ['PENDING', 'OVERDUE'].includes(providerStatus);

  return {
    canEdit: policy.canEdit && locallyEditable && (input.origin === 'ACADEMIC' || Boolean(input.asaasPaymentId)),
    canEditRules: policy.canEdit && locallyEditable && (input.origin === 'ACADEMIC' || Boolean(input.asaasPaymentId)),
    canConfirmCashPayment: locallyPayable && providerReceivable,
    canCancel: input.origin === 'ACADEMIC' && policy.canCancel,
    canRefund: policy.canRefund,
    canUndoCashPayment: policy.canUndoCashPayment,
  };
}

function toIso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function categoryStatusLabel(category: Exclude<MobileBillingCategory, 'IGNORED'>) {
  switch (category) {
    case 'RECEIVED': return 'Recebida';
    case 'CONFIRMED': return 'Confirmada';
    case 'AWAITING_PAYMENT': return 'Aguardando pagamento';
    case 'OVERDUE': return 'Vencida';
    case 'REFUNDED': return 'Estornada';
    case 'CANCELLED': return 'Cancelada';
  }
}

function isInPeriod(category: MobileBillingCategory, eventDate: Date | null, dueDate: Date | null, now: Date, period: MobileBillingPeriod) {
  const start = period === 'LAST_30_DAYS'
    ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = period === 'LAST_30_DAYS'
    ? now
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const reference = category === 'RECEIVED' || category === 'CONFIRMED' || category === 'REFUNDED' || category === 'CANCELLED' ? eventDate : dueDate;
  return Boolean(reference && reference >= start && reference < end);
}

const categoryPriority: Record<Exclude<MobileBillingCategory, 'IGNORED'>, number> = {
  OVERDUE: 0,
  AWAITING_PAYMENT: 1,
  CONFIRMED: 2,
  RECEIVED: 3,
  REFUNDED: 4,
  CANCELLED: 5,
};

function compareCharges(left: MobileBillingCharge, right: MobileBillingCharge, sort: MobileBillingChargesSort) {
  if (sort === 'created-at-desc' || sort === 'created-at-asc') {
    const leftCreatedAt = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightCreatedAt = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    if (leftCreatedAt !== rightCreatedAt) return sort === 'created-at-desc' ? rightCreatedAt - leftCreatedAt : leftCreatedAt - rightCreatedAt;
  }

  if (sort === 'priority') {
    const priorityDifference = categoryPriority[left.category] - categoryPriority[right.category];
    if (priorityDifference !== 0) return priorityDifference;
  }

  if (sort === 'amount-desc' || sort === 'amount-asc') {
    const amountDifference = left.amount - right.amount;
    if (amountDifference !== 0) return sort === 'amount-desc' ? -amountDifference : amountDifference;
  }

  if (sort === 'due-date-asc' || sort === 'due-date-desc' || sort === 'priority') {
    if (!left.dueDate && right.dueDate) return 1;
    if (left.dueDate && !right.dueDate) return -1;
    if (left.dueDate && right.dueDate) {
      const leftDate = new Date(left.dueDate).getTime();
      const rightDate = new Date(right.dueDate).getTime();
      if (leftDate !== rightDate) return sort === 'due-date-desc' ? rightDate - leftDate : leftDate - rightDate;
    }
  }

  const leftCreatedAt = left.createdAt ? new Date(left.createdAt).getTime() : 0;
  const rightCreatedAt = right.createdAt ? new Date(right.createdAt).getTime() : 0;
  if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt;
  return `${left.origin}:${left.id}`.localeCompare(`${right.origin}:${right.id}`);
}

function mapAcademicCharge(charge: {
  id: string;
  asaasPaymentId: string | null;
  tipo: string;
  descricao: string | null;
  valor: unknown;
  valorFinal: unknown;
  asaasValue: unknown;
  asaasStatus: string | null;
  status: string;
  liquidacaoStatus: string;
  vencimento: Date;
  dataPagamento: Date | null;
  pagoEm: Date | null;
  updatedAt: Date;
  formaPagamento: string;
  createdAt: Date;
  jurosPercentual: unknown;
  multaPercentual: unknown;
  descontoValorFixo: unknown;
  descontoPercentual: unknown;
  descontoTipo: string | null;
  descontoPrazoMaximo: string | null;
  charge: { invoiceUrl: string | null; bankSlipUrl: string | null } | null;
  matricula: { aluno: { nome: string } };
}, now: Date): MobileBillingCharge | null {
  const category = resolveMobileBillingCategory({
    localStatus: charge.status,
    asaasStatus: charge.asaasStatus,
    liquidacaoStatus: charge.liquidacaoStatus,
    dueDate: charge.vencimento,
    startOfToday: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  });
  if (category === 'IGNORED') return null;
  const amount = numberFromFinanceDecimal(charge.asaasValue ?? charge.valorFinal ?? charge.valor);
  const eventDate = charge.dataPagamento ?? charge.pagoEm ?? charge.updatedAt;
  return {
    id: charge.id,
    category,
    studentName: charge.matricula.aluno.nome,
    description: charge.descricao?.trim() || labelForType(charge.tipo),
    amount: roundFinanceCurrency(amount),
    dueDate: toIso(charge.vencimento),
    paidAt: toIso(charge.dataPagamento ?? charge.pagoEm),
    originalStatus: categoryStatusLabel(category),
    paymentMethod: charge.formaPagamento,
    invoiceUrl: charge.charge?.invoiceUrl ?? null,
    bankSlipUrl: charge.charge?.bankSlipUrl ?? null,
    financialRules: {
      interestPercent: charge.jurosPercentual == null ? null : numberFromFinanceDecimal(charge.jurosPercentual),
      finePercent: charge.multaPercentual == null ? null : numberFromFinanceDecimal(charge.multaPercentual),
      discountValue: charge.descontoTipo?.toUpperCase().includes('PERCENT')
        ? charge.descontoPercentual == null ? null : numberFromFinanceDecimal(charge.descontoPercentual)
        : charge.descontoValorFixo == null ? null : numberFromFinanceDecimal(charge.descontoValorFixo),
      discountType: charge.descontoTipo,
      discountDueDateLimitDays: discountLimitDays(charge.descontoPrazoMaximo),
    },
    origin: 'ACADEMIC',
    capabilities: resolveMobileBillingCapabilities({
      origin: 'ACADEMIC',
      localStatus: charge.status,
      asaasStatus: charge.asaasStatus,
      asaasPaymentId: charge.asaasPaymentId,
      paymentMethod: charge.formaPagamento,
      invoiceUrl: charge.charge?.invoiceUrl ?? null,
    }),
    eventDate: toIso(eventDate),
    createdAt: toIso(charge.createdAt),
  };
}

function discountLimitDays(value: string | null | undefined) {
  switch (value) {
    case '1_DIA': return 1;
    case '3_DIAS': return 3;
    case '7_DIAS': return 7;
    case '15_DIAS': return 15;
    case '30_DIAS': return 30;
    case 'ATE_VENCIMENTO': return 0;
    default: return null;
  }
}

function labelForType(type: string) {
  switch (type) {
    case 'TAXA_MATRICULA': return 'Taxa de matrícula';
    case 'MENSALIDADE': return 'Mensalidade';
    case 'PARCELADA': return 'Cobrança parcelada';
    case 'RECORRENTE': return 'Cobrança recorrente';
    default: return 'Cobrança';
  }
}

export async function getMobileBillingSummaryForActor(actor: MobileBillingActor, period: MobileBillingPeriod) {
  return withAuthorizedTenant(actor, async (tx) => getMobileBillingSummary({ contaId: actor.contaId, period, db: tx }));
}

export async function listMobileBillingCharges(input: {
  actor: MobileBillingActor;
  period: MobileBillingPeriod;
  origin?: MobileBillingOrigin;
  category?: Exclude<MobileBillingCategory, 'IGNORED'>;
  sort?: MobileBillingChargesSort;
  search?: string;
  page?: number;
  pageSize?: number;
  offset?: number;
  limit?: number;
}) {
  return withAuthorizedTenant(input.actor, async (tx) => {
    const now = new Date();
    const [academicCharges, standaloneCharges] = await Promise.all([
      tx.cobranca.findMany({
        where: {
          contaId: input.actor.contaId,
          matricula: { contaId: input.actor.contaId, aluno: { contaId: input.actor.contaId } },
          status: { in: ['A_VENCER', 'PENDENTE', 'PROCESSANDO', 'PAGO', 'ATRASADO', 'CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL'] },
        },
        orderBy: { vencimento: 'asc' },
        select: {
          id: true,
          asaasPaymentId: true,
          tipo: true,
          descricao: true,
          valor: true,
          valorFinal: true,
          asaasValue: true,
          asaasStatus: true,
          status: true,
          liquidacaoStatus: true,
          vencimento: true,
          dataPagamento: true,
          pagoEm: true,
          updatedAt: true,
          createdAt: true,
          formaPagamento: true,
          jurosPercentual: true,
          multaPercentual: true,
          descontoValorFixo: true,
          descontoPercentual: true,
          descontoTipo: true,
          descontoPrazoMaximo: true,
          charge: { select: { invoiceUrl: true, bankSlipUrl: true } },
          matricula: { select: { aluno: { select: { nome: true } } } },
        },
      }),
      tx.charge.findMany({
        where: {
          contaId: input.actor.contaId,
          cobrancaId: null,
          status: { in: ['CREATED', 'PENDING_SYNC', 'OPEN', 'PAID', 'OVERDUE', 'CANCELED', 'REFUNDED'] },
        },
        orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          asaasPaymentId: true,
          description: true,
          payerName: true,
          value: true,
          asaasValue: true,
          asaasStatus: true,
          status: true,
          liquidacaoStatus: true,
          dueDate: true,
          liquidadoEm: true,
          statusUpdatedAt: true,
          updatedAt: true,
          createdAt: true,
          billingType: true,
          invoiceUrl: true,
          bankSlipUrl: true,
          interestValue: true,
          fineValue: true,
          discountValue: true,
          discountType: true,
          discountDueDateLimitDays: true,
        },
      }),
    ]);

    const items: MobileBillingCharge[] = [];
    for (const charge of input.origin === 'STANDALONE' ? [] : academicCharges) {
      const item = mapAcademicCharge(charge, now);
      if (item) items.push(item);
    }
    for (const charge of input.origin === 'ACADEMIC' ? [] : standaloneCharges) {
      const category = resolveMobileBillingCategory({
        localStatus: charge.status,
        asaasStatus: charge.asaasStatus,
        liquidacaoStatus: charge.liquidacaoStatus,
        dueDate: charge.dueDate,
        startOfToday: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      });
      if (category === 'IGNORED') continue;
      const eventDate = charge.liquidadoEm ?? charge.statusUpdatedAt ?? charge.updatedAt;
      if (!isInPeriod(category, eventDate, charge.dueDate, now, input.period)) continue;
      items.push({
        id: charge.id,
        category,
        studentName: charge.payerName?.trim() || 'Pagador não informado',
        description: charge.description?.trim() || 'Cobrança',
        amount: roundFinanceCurrency(numberFromFinanceDecimal(charge.asaasValue ?? charge.value)),
        dueDate: toIso(charge.dueDate),
        paidAt: toIso(charge.liquidadoEm),
        eventDate: toIso(eventDate),
        createdAt: toIso(charge.createdAt),
        originalStatus: categoryStatusLabel(category),
        paymentMethod: charge.billingType,
        invoiceUrl: charge.invoiceUrl,
        bankSlipUrl: charge.bankSlipUrl,
        financialRules: {
          interestPercent: charge.interestValue == null ? null : numberFromFinanceDecimal(charge.interestValue),
          finePercent: charge.fineValue == null ? null : numberFromFinanceDecimal(charge.fineValue),
          discountValue: charge.discountValue == null ? null : numberFromFinanceDecimal(charge.discountValue),
          discountType: charge.discountType,
          discountDueDateLimitDays: charge.discountDueDateLimitDays,
        },
        origin: 'STANDALONE',
        capabilities: resolveMobileBillingCapabilities({
          origin: 'STANDALONE',
          localStatus: charge.status,
          asaasStatus: charge.asaasStatus,
          asaasPaymentId: charge.asaasPaymentId,
          paymentMethod: charge.billingType,
          invoiceUrl: charge.invoiceUrl,
        }),
      });
    }

    const currentPeriodItems = items.filter((item) => {
      const eventDate = item.eventDate ? new Date(item.eventDate) : null;
      const dueDate = item.dueDate ? new Date(item.dueDate) : null;
      return isInPeriod(item.category, eventDate, dueDate, now, input.period);
    });
    const normalizedSearch = input.search?.trim().toLocaleLowerCase();
    const filtered = currentPeriodItems.filter((item) => {
      const matchesCategory = !input.category || item.category === input.category;
      const matchesSearch = !normalizedSearch || `${item.studentName} ${item.description}`.toLocaleLowerCase().includes(normalizedSearch);
      return matchesCategory && matchesSearch;
    });
  filtered.sort((left, right) => compareCharges(left, right, input.sort ?? 'created-at-desc'));

    const pageSize = Math.min(20, Math.max(1, input.pageSize ?? 20));
    const page = Math.max(1, input.page ?? 1);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = Math.max(0, input.offset ?? (safePage - 1) * pageSize);
    const limit = Math.min(20, Math.max(1, input.limit ?? pageSize));
    return {
      charges: filtered.slice(offset, offset + limit),
      total,
      page: safePage,
      pageSize,
      totalPages,
      offset,
      limit,
      hasMore: offset + limit < total,
    };
  });
}

export async function getMobileBillingCharge(actor: MobileBillingActor, chargeId: string) {
  const normalizedId = chargeId.trim();
  if (!normalizedId) throw new MobileBillingUnauthorizedError();

  return withAuthorizedTenant(actor, async (tx) => {
    const academic = await tx.cobranca.findFirst({
      where: {
        id: normalizedId,
        contaId: actor.contaId,
        matricula: { contaId: actor.contaId, aluno: { contaId: actor.contaId } },
      },
      select: {
        id: true,
        asaasPaymentId: true,
        tipo: true,
        descricao: true,
        valor: true,
        valorFinal: true,
        asaasValue: true,
        asaasStatus: true,
        status: true,
        liquidacaoStatus: true,
        vencimento: true,
        dataPagamento: true,
        pagoEm: true,
        updatedAt: true,
        createdAt: true,
        formaPagamento: true,
        jurosPercentual: true,
        multaPercentual: true,
        descontoValorFixo: true,
        descontoPercentual: true,
        descontoTipo: true,
        descontoPrazoMaximo: true,
        charge: { select: { invoiceUrl: true, bankSlipUrl: true } },
        matricula: { select: { aluno: { select: { nome: true } } } },
      },
    });
    if (academic) return mapAcademicCharge(academic, new Date());

    const standalone = await tx.charge.findFirst({
      where: { id: normalizedId, contaId: actor.contaId, cobrancaId: null },
      select: {
        id: true,
        asaasPaymentId: true,
        description: true,
        payerName: true,
        value: true,
        asaasValue: true,
        asaasStatus: true,
        status: true,
        liquidacaoStatus: true,
        dueDate: true,
        liquidadoEm: true,
        statusUpdatedAt: true,
        updatedAt: true,
        createdAt: true,
        billingType: true,
        invoiceUrl: true,
        bankSlipUrl: true,
        interestValue: true,
        fineValue: true,
        discountValue: true,
        discountType: true,
        discountDueDateLimitDays: true,
      },
    });
    if (!standalone) return null;

    const now = new Date();
    const category = resolveMobileBillingCategory({
      localStatus: standalone.status,
      asaasStatus: standalone.asaasStatus,
      liquidacaoStatus: standalone.liquidacaoStatus,
      dueDate: standalone.dueDate,
      startOfToday: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    });
    if (category === 'IGNORED') return null;
    return {
      id: standalone.id,
      category,
      studentName: standalone.payerName?.trim() || 'Pagador não informado',
      description: standalone.description?.trim() || 'Cobrança',
      amount: roundFinanceCurrency(numberFromFinanceDecimal(standalone.asaasValue ?? standalone.value)),
      dueDate: toIso(standalone.dueDate),
      paidAt: toIso(standalone.liquidadoEm),
      eventDate: toIso(standalone.liquidadoEm ?? standalone.statusUpdatedAt ?? standalone.updatedAt),
      createdAt: toIso(standalone.createdAt),
      originalStatus: categoryStatusLabel(category),
      paymentMethod: standalone.billingType,
      invoiceUrl: standalone.invoiceUrl,
      bankSlipUrl: standalone.bankSlipUrl,
      financialRules: {
        interestPercent: standalone.interestValue == null ? null : numberFromFinanceDecimal(standalone.interestValue),
        finePercent: standalone.fineValue == null ? null : numberFromFinanceDecimal(standalone.fineValue),
        discountValue: standalone.discountValue == null ? null : numberFromFinanceDecimal(standalone.discountValue),
        discountType: standalone.discountType,
        discountDueDateLimitDays: standalone.discountDueDateLimitDays,
      },
      origin: 'STANDALONE' as const,
      capabilities: resolveMobileBillingCapabilities({
        origin: 'STANDALONE',
        localStatus: standalone.status,
        asaasStatus: standalone.asaasStatus,
        asaasPaymentId: standalone.asaasPaymentId,
        paymentMethod: standalone.billingType,
        invoiceUrl: standalone.invoiceUrl,
      }),
    } satisfies MobileBillingCharge;
  });
}
