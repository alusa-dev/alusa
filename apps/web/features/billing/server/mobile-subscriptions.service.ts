import {
  getSubscriptionWithCharges,
  listSubscriptionsForFinance,
} from '@alusa/finance';

import { assertMobileBillingActor, MobileBillingUnauthorizedError } from './mobile-billing.service';

export type MobileSubscriptionsActor = { userId: string; contaId: string };

export class MobileSubscriptionsUnauthorizedError extends Error {
  constructor() {
    super('Usuário sem acesso à conta ativa.');
    this.name = 'MobileSubscriptionsUnauthorizedError';
  }
}

async function assertActor(actor: MobileSubscriptionsActor) {
  try {
    await assertMobileBillingActor(actor);
  } catch (error) {
    if (error instanceof MobileBillingUnauthorizedError) throw new MobileSubscriptionsUnauthorizedError();
    throw error;
  }
}

export async function listMobileSubscriptions(input: {
  actor: MobileSubscriptionsActor;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  await assertActor(input.actor);
  const result = await listSubscriptionsForFinance({
    contaId: input.actor.contaId,
    page: input.page,
    pageSize: input.pageSize,
    search: input.search?.trim() || undefined,
  });
  return {
    ...result,
    items: result.items.map((item) => ({
      id: item.id,
      asaasSubscriptionId: item.asaasSubscriptionId,
      externalReference: item.externalReference,
      status: item.status,
      statusLabel: item.statusLabel,
      payerName: item.clienteNome,
      studentName: item.alunoNome,
      value: item.valor,
      cycle: item.cycle,
      cycleLabel: item.cycleLabel,
      billingType: item.billingType,
      description: item.description,
      nextDueDate: item.nextDueDate,
      matriculaId: item.matriculaId,
      createdAt: item.createdAt,
      type: item.tipo,
    })),
  };
}

export async function getMobileSubscriptionDetail(actor: MobileSubscriptionsActor, subscriptionId: string) {
  await assertActor(actor);
  const result = await getSubscriptionWithCharges({ contaId: actor.contaId, subscriptionId });
  if (!result.success) return result;
  return {
    success: true as const,
    data: {
      id: result.data.id,
      asaasSubscriptionId: result.data.asaasSubscriptionId,
      externalReference: result.data.externalReference,
      status: result.data.status,
      statusLabel: result.data.statusLabel,
      payerName: result.data.clienteNome,
      payerEmail: result.data.clienteEmail,
      payerPhone: result.data.clienteTelefone,
      studentName: result.data.alunoNome,
      value: result.data.valor,
      cycle: result.data.cycle,
      cycleLabel: result.data.cycleLabel,
      billingType: result.data.billingType,
      description: result.data.description,
      nextDueDate: result.data.nextDueDate,
      matriculaId: result.data.matriculaId,
      contratoId: result.data.contratoId,
      createdAt: result.data.createdAt,
      charges: result.data.cobrancas,
      totalCharges: result.data.totalCobrancas,
      paidCharges: result.data.cobrancasPagas,
      receivedValue: result.data.valorRecebido,
    },
  };
}
