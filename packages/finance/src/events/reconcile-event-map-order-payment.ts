import { getPayment } from '@alusa/asaas';
import { prisma } from '@alusa/database';
import { EventsError, loadDecryptedAsaasCredentials } from '@alusa/lib';
import { Prisma } from '@prisma/client';

import { logEventsFinance } from './events-finance-observability';

export type ReconcileEventMapOrderPaymentInput = {
  contaId: string;
  userId?: string | null;
  eventId: string;
  orderId: string;
};

export type ReconcileEventMapOrderPaymentResult = {
  ok: true;
  updated: boolean;
  orderId: string;
  asaasPaymentId: string | null;
  previousPaymentMethod: string | null;
  paymentMethod: string | null;
  message?: string;
};

type EventMapOrderPaymentRecord = {
  id: string;
  contaId: string;
  eventId: string;
  asaasPaymentId: string | null;
  paymentMethod: string | null;
  wasUpdated?: boolean;
};

type AsaasCredentials = {
  apiKey?: string | null;
} | null;

type AsaasPaymentSnapshot = {
  billingType?: string | null;
};

type RecordReconciliationAuditInput = {
  input: ReconcileEventMapOrderPaymentInput;
  order: EventMapOrderPaymentRecord;
  previousPaymentMethod: string | null;
  paymentMethod: string | null;
};

export type ReconcileEventMapOrderPaymentDependencies = {
  findOrder: (input: ReconcileEventMapOrderPaymentInput) => Promise<EventMapOrderPaymentRecord | null>;
  loadCredentials: (contaId: string) => Promise<AsaasCredentials>;
  getPayment: (params: { apiKey: string; paymentId: string }) => Promise<AsaasPaymentSnapshot>;
  updateOrderPaymentMethod: (params: {
    contaId: string;
    eventId: string;
    orderId: string;
    paymentMethod: string;
  }) => Promise<EventMapOrderPaymentRecord>;
  recordAudit: (params: RecordReconciliationAuditInput) => Promise<void>;
};

function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

const defaultDependencies: ReconcileEventMapOrderPaymentDependencies = {
  findOrder: async (input) => prisma.eventMapOrder.findFirst({
    where: {
      id: input.orderId,
      contaId: input.contaId,
      eventId: input.eventId,
    },
    select: {
      id: true,
      contaId: true,
      eventId: true,
      asaasPaymentId: true,
      paymentMethod: true,
    },
  }),
  loadCredentials: (contaId) => loadDecryptedAsaasCredentials(contaId),
  getPayment: (params) => getPayment(params),
  updateOrderPaymentMethod: async (params) => {
    const updated = await prisma.eventMapOrder.updateMany({
      where: {
        id: params.orderId,
        contaId: params.contaId,
        eventId: params.eventId,
        paymentMethod: null,
      },
      data: {
        paymentMethod: params.paymentMethod,
      },
    });

    const order = await prisma.eventMapOrder.findFirst({
      where: {
        id: params.orderId,
        contaId: params.contaId,
        eventId: params.eventId,
      },
      select: {
        id: true,
        contaId: true,
        eventId: true,
        asaasPaymentId: true,
        paymentMethod: true,
      },
    });

    if (!order) {
      throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.', 404);
    }

    if (updated.count === 0 && !order.paymentMethod) {
      throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.', 404);
    }

    return { ...order, wasUpdated: updated.count > 0 };
  },
  recordAudit: async (params) => {
    await prisma.eventAudit.create({
      data: {
        contaId: params.input.contaId,
        eventId: params.input.eventId,
        actorUserId: params.input.userId ?? null,
        action: 'events.publicOrder.payment.reconcile',
        entityType: 'EventMapOrder',
        entityId: params.order.id,
        before: toAuditJson({ paymentMethod: params.previousPaymentMethod }),
        after: toAuditJson({ paymentMethod: params.paymentMethod }),
        metadata: toAuditJson({
          asaasPaymentId: params.order.asaasPaymentId,
        }),
      },
    });

    await prisma.auditLog.create({
      data: {
        contaId: params.input.contaId,
        actorType: params.input.userId ? 'USER' : 'SYSTEM',
        actorId: params.input.userId ?? null,
        action: 'events.publicOrder.payment.reconcile',
        entityType: 'EventMapOrder',
        entityId: params.order.id,
        metadata: toAuditJson({
          eventId: params.input.eventId,
          asaasPaymentId: params.order.asaasPaymentId,
          previousPaymentMethod: params.previousPaymentMethod,
          paymentMethod: params.paymentMethod,
        }),
      },
    });
  },
};

function normalizePaymentMethod(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export async function reconcileEventMapOrderPayment(
  input: ReconcileEventMapOrderPaymentInput,
  dependencies: ReconcileEventMapOrderPaymentDependencies = defaultDependencies,
): Promise<ReconcileEventMapOrderPaymentResult> {
  const order = await dependencies.findOrder(input);
  if (!order) {
    throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.', 404);
  }

  if (!order.asaasPaymentId) {
    return {
      ok: true,
      updated: false,
      orderId: order.id,
      asaasPaymentId: null,
      previousPaymentMethod: order.paymentMethod,
      paymentMethod: order.paymentMethod,
      message: 'Pedido sem cobrança Asaas vinculada.',
    };
  }

  if (order.paymentMethod) {
    return {
      ok: true,
      updated: false,
      orderId: order.id,
      asaasPaymentId: order.asaasPaymentId,
      previousPaymentMethod: order.paymentMethod,
      paymentMethod: order.paymentMethod,
      message: 'Pedido já está consistente.',
    };
  }

  const credentials = await dependencies.loadCredentials(input.contaId);
  if (!credentials?.apiKey) {
    throw new EventsError(
      'ASAAS_CREDENTIALS_NOT_FOUND',
      'Conta sem credenciais Asaas configuradas.',
      409,
    );
  }

  let payment: AsaasPaymentSnapshot;
  try {
    payment = await dependencies.getPayment({
      apiKey: credentials.apiKey,
      paymentId: order.asaasPaymentId,
    });
  } catch (error) {
    logEventsFinance(
      'eventMapOrder.reconcile.failed',
      {
        contaId: input.contaId,
        eventId: input.eventId,
        orderId: input.orderId,
        asaasPaymentId: order.asaasPaymentId,
        message: error instanceof Error ? error.message : String(error),
      },
      'warn',
    );

    throw new EventsError(
      'ASAAS_PAYMENT_RECONCILE_FAILED',
      'Falha ao consultar Asaas. Tente novamente.',
      502,
      { orderId: order.id, asaasPaymentId: order.asaasPaymentId },
    );
  }

  const paymentMethod = normalizePaymentMethod(payment.billingType);
  if (!paymentMethod) {
    return {
      ok: true,
      updated: false,
      orderId: order.id,
      asaasPaymentId: order.asaasPaymentId,
      previousPaymentMethod: order.paymentMethod,
      paymentMethod: order.paymentMethod,
      message: 'Cobrança Asaas não retornou forma de pagamento.',
    };
  }

  const updatedOrder = await dependencies.updateOrderPaymentMethod({
    contaId: input.contaId,
    eventId: input.eventId,
    orderId: order.id,
    paymentMethod,
  });

  if (updatedOrder.wasUpdated === false) {
    return {
      ok: true,
      updated: false,
      orderId: order.id,
      asaasPaymentId: order.asaasPaymentId,
      previousPaymentMethod: order.paymentMethod,
      paymentMethod: updatedOrder.paymentMethod,
      message: 'Pedido já está consistente.',
    };
  }

  await dependencies.recordAudit({
    input,
    order,
    previousPaymentMethod: order.paymentMethod,
    paymentMethod: updatedOrder.paymentMethod,
  });

  logEventsFinance('eventMapOrder.reconcile', {
    contaId: input.contaId,
    eventId: input.eventId,
    orderId: order.id,
    asaasPaymentId: order.asaasPaymentId,
    updated: true,
  });

  return {
    ok: true,
    updated: true,
    orderId: order.id,
    asaasPaymentId: order.asaasPaymentId,
    previousPaymentMethod: order.paymentMethod,
    paymentMethod: updatedOrder.paymentMethod,
  };
}
