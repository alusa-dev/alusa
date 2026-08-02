import { createSubscription as createAsaasSubscription, type BillingType, type Cycle } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';

import { buildSafeAsaasIdempotencyKey, hashPayload } from '../core';
import { assertAsaasTenantOperational } from '../foundation/asaas-operational-guard';
import { requireKycApproved } from '../foundation/kyc-guard';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';
import { createAsaasPaymentDetailed } from './create-payment';
import { ensureCustomer, type EnsureCustomerPayerRef } from './ensure-customer';
import {
  deletePayment,
  deleteSubscription,
  getPayment,
  getSubscription,
  listPayments,
  listSubscriptions,
} from './asaas-ops';
import {
  markOutboundRemoteConfirmed,
  markOutboundRemoteRequested,
  markOutboundFailed,
  markOutboundResultUnknown,
  reserveOutboundFinancialOperation,
} from './outbound-financial-operation';

export type EnrollmentSubscriptionStageInput = {
  value: number;
  nextDueDate: string;
  billingType: BillingType;
  cycle: Cycle;
  endDate?: string;
  description?: string;
  discount?: { value: number; dueDateLimitDays?: number; type: 'FIXED' | 'PERCENTAGE' };
  interest?: { value: number };
  fine?: { value: number; type?: 'FIXED' | 'PERCENTAGE' };
};

export type EnrollmentFeeStageInput = {
  value: number;
  dueDate: string;
  billingType: BillingType;
  description?: string;
  discount?: { value: number; dueDateLimitDays?: number; type: 'FIXED' | 'PERCENTAGE' };
  interest?: { value: number };
  fine?: { value: number; type: 'FIXED' | 'PERCENTAGE' };
};

export type StageEnrollmentFinancialResourcesInput = {
  contaId: string;
  operationId: string;
  idempotencyKey: string;
  payer: EnsureCustomerPayerRef;
  subscription: EnrollmentSubscriptionStageInput;
  enrollmentFee?: EnrollmentFeeStageInput | null;
  confirmationAttempts?: number;
  confirmationDelayMs?: number;
  claimCompensation?: () => Promise<boolean>;
};

export type StagedEnrollmentFinancialResources = {
  operationId: string;
  customer: { localCustomerId: string; asaasCustomerId: string };
  subscription: {
    asaasSubscriptionId: string;
    externalReference: string;
    firstPayment: StagedPayment;
  };
  enrollmentFee: StagedPayment | null;
};

export type StagedPayment = {
  asaasPaymentId: string;
  externalReference: string | null;
  value: number;
  dueDate: string;
  status: string;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
};

export type EnrollmentFinancialCompensationResult = {
  complete: boolean;
  deletedPaymentIds: string[];
  deletedFirstSubscriptionPaymentId: string | null;
  deletedEnrollmentFeePaymentId: string | null;
  deletedSubscriptionId: string | null;
  errors: Array<{ resource: 'PAYMENT' | 'SUBSCRIPTION'; id: string; message: string }>;
};

export type StageEnrollmentFinancialResourcesResult =
  | { success: true; data: StagedEnrollmentFinancialResources }
  | {
      success: false;
      error: string;
      resultUnknown: boolean;
      compensation: EnrollmentFinancialCompensationResult;
    };

type Dependencies = {
  ensureCustomer: typeof ensureCustomer;
  requireKycApproved: typeof requireKycApproved;
  assertAsaasTenantOperational: typeof assertAsaasTenantOperational;
  ensureWebhookConfigOperational: typeof ensureWebhookConfigOperational;
  loadAsaasCredentials: typeof loadAsaasCredentials;
  createSubscription: typeof createAsaasSubscription;
  createPayment: typeof createAsaasPaymentDetailed;
  getSubscription: typeof getSubscription;
  listSubscriptions: typeof listSubscriptions;
  getPayment: typeof getPayment;
  listPayments: typeof listPayments;
  deleteSubscription: typeof deleteSubscription;
  deletePayment: typeof deletePayment;
  reserveOperation: typeof reserveOutboundFinancialOperation;
  markRemoteRequested: typeof markOutboundRemoteRequested;
  markRemoteConfirmed: typeof markOutboundRemoteConfirmed;
  markFailed: typeof markOutboundFailed;
  markResultUnknown: typeof markOutboundResultUnknown;
  wait: (milliseconds: number) => Promise<void>;
};

type StagedRemoteIds = {
  asaasSubscriptionId: string | null;
  firstSubscriptionPaymentId: string | null;
  enrollmentFeePaymentId: string | null;
};

const defaultDependencies: Dependencies = {
  ensureCustomer,
  requireKycApproved,
  assertAsaasTenantOperational,
  ensureWebhookConfigOperational,
  loadAsaasCredentials,
  createSubscription: createAsaasSubscription,
  createPayment: createAsaasPaymentDetailed,
  getSubscription,
  listSubscriptions,
  getPayment,
  listPayments,
  deleteSubscription,
  deletePayment,
  reserveOperation: reserveOutboundFinancialOperation,
  markRemoteRequested: markOutboundRemoteRequested,
  markRemoteConfirmed: markOutboundRemoteConfirmed,
  markFailed: markOutboundFailed,
  markResultUnknown: markOutboundResultUnknown,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

class EnrollmentFinancialStageError extends Error {
  constructor(
    message: string,
    readonly resultUnknown = false,
  ) {
    super(message);
    this.name = 'EnrollmentFinancialStageError';
  }
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validateInput(input: StageEnrollmentFinancialResourcesInput) {
  if (!input.operationId.trim() || !input.idempotencyKey.trim()) {
    throw new EnrollmentFinancialStageError('ENROLLMENT_OPERATION_IDEMPOTENCY_REQUIRED');
  }
  if (!Number.isFinite(input.subscription.value) || input.subscription.value <= 0) {
    throw new EnrollmentFinancialStageError('SUBSCRIPTION_VALUE_INVALID');
  }
  if (!isIsoDate(input.subscription.nextDueDate)) {
    throw new EnrollmentFinancialStageError('SUBSCRIPTION_DUE_DATE_INVALID');
  }
  if (input.subscription.endDate && !isIsoDate(input.subscription.endDate)) {
    throw new EnrollmentFinancialStageError('SUBSCRIPTION_END_DATE_INVALID');
  }
  if (
    input.subscription.endDate &&
    input.subscription.endDate < input.subscription.nextDueDate
  ) {
    throw new EnrollmentFinancialStageError('SUBSCRIPTION_END_DATE_BEFORE_FIRST_DUE_DATE');
  }
  if (input.enrollmentFee) {
    if (!Number.isFinite(input.enrollmentFee.value) || input.enrollmentFee.value <= 0) {
      throw new EnrollmentFinancialStageError('ENROLLMENT_FEE_VALUE_INVALID');
    }
    if (!isIsoDate(input.enrollmentFee.dueDate)) {
      throw new EnrollmentFinancialStageError('ENROLLMENT_FEE_DUE_DATE_INVALID');
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 404,
  );
}

function toStagedPayment(payment: Awaited<ReturnType<typeof getPayment>>): StagedPayment {
  return {
    asaasPaymentId: payment.id,
    externalReference: payment.externalReference ?? null,
    value: Number(payment.value),
    dueDate: payment.dueDate,
    status: payment.status,
    invoiceUrl: payment.invoiceUrl ?? null,
    bankSlipUrl: payment.bankSlipUrl ?? null,
  };
}

function paymentMatches(input: {
  payment: Awaited<ReturnType<typeof getPayment>>;
  customerId: string;
  value: number;
  dueDate: string;
  externalReference?: string;
  subscriptionId?: string;
}) {
  const payment = input.payment;
  return (
    !payment.deleted &&
    payment.customer === input.customerId &&
    Math.abs(Number(payment.value) - input.value) <= 0.001 &&
    payment.dueDate === input.dueDate &&
    (!input.externalReference || payment.externalReference === input.externalReference) &&
    (!input.subscriptionId || payment.subscription === input.subscriptionId)
  );
}

async function findUniqueSubscriptionByReference(
  contaId: string,
  externalReference: string,
  deps: Dependencies,
) {
  const matches = await deps
    .listSubscriptions({ externalReference, limit: 10, includeDeleted: true }, { contaId })
    .then((result) => result.data.filter((item) => !item.deleted));
  if (matches.length > 1) {
    throw new EnrollmentFinancialStageError(
      'MULTIPLE_REMOTE_SUBSCRIPTIONS_FOR_EXTERNAL_REFERENCE',
      true,
    );
  }
  return matches[0] ?? null;
}

async function findUniquePaymentByReference(
  contaId: string,
  externalReference: string,
  deps: Dependencies,
) {
  const matches = await deps
    .listPayments({ externalReference, limit: 10, includeDeleted: true }, { contaId })
    .then((result) => result.data.filter((item) => !item.deleted));
  if (matches.length > 1) {
    throw new EnrollmentFinancialStageError(
      'MULTIPLE_REMOTE_PAYMENTS_FOR_EXTERNAL_REFERENCE',
      true,
    );
  }
  return matches[0] ?? null;
}

async function markUnknown(input: {
  jobId: string;
  contaId: string;
  resource: 'PAYMENT' | 'SUBSCRIPTION';
  entityId: string;
  externalReference: string;
  error: unknown;
}, deps: Dependencies) {
  await deps.markResultUnknown(input).catch(() => undefined);
}

async function stageSubscription(input: {
  request: StageEnrollmentFinancialResourcesInput;
  customerId: string;
  apiKey: string;
  externalReference: string;
  stagedIds: StagedRemoteIds;
}, deps: Dependencies) {
  const payload = {
    customer: input.customerId,
    billingType: input.request.subscription.billingType,
    value: input.request.subscription.value,
    nextDueDate: input.request.subscription.nextDueDate,
    cycle: input.request.subscription.cycle,
    endDate: input.request.subscription.endDate,
    description: input.request.subscription.description,
    externalReference: input.externalReference,
    discount: input.request.subscription.discount,
    interest: input.request.subscription.interest,
    fine: input.request.subscription.fine,
  };
  const idempotencyKey = buildSafeAsaasIdempotencyKey(
    `${input.request.idempotencyKey}:subscription`,
  );
  const operation = await deps.reserveOperation({
    contaId: input.request.contaId,
    type: 'CREATE_SUBSCRIPTION',
    idempotencyKey,
    resource: 'SUBSCRIPTION',
    entityId: input.request.operationId,
    externalReference: input.externalReference,
    requestFingerprint: hashPayload(payload),
    metadata: { enrollmentCreationOperationId: input.request.operationId },
  });

  let subscription = operation.payload.remoteId
    ? await deps
        .getSubscription(operation.payload.remoteId, { contaId: input.request.contaId })
        .catch(() => null)
    : null;
  subscription ??= await findUniqueSubscriptionByReference(
    input.request.contaId,
    input.externalReference,
    deps,
  );

  if (!subscription) {
    const claimed = await deps.markRemoteRequested(operation.job.id);
    if (!claimed) {
      throw new EnrollmentFinancialStageError('SUBSCRIPTION_OPERATION_ALREADY_IN_PROGRESS', true);
    }
    try {
      const created = await deps.createSubscription({
        apiKey: input.apiKey,
        idempotencyKey,
        data: payload,
      });
      subscription = await deps
        .getSubscription(created.id, { contaId: input.request.contaId })
        .catch(() => created);
    } catch (error) {
      subscription = await findUniqueSubscriptionByReference(
        input.request.contaId,
        input.externalReference,
        deps,
      ).catch(() => null);
      if (!subscription) {
        await markUnknown(
          {
            jobId: operation.job.id,
            contaId: input.request.contaId,
            resource: 'SUBSCRIPTION',
            entityId: input.request.operationId,
            externalReference: input.externalReference,
            error,
          },
          deps,
        );
        throw new EnrollmentFinancialStageError('SUBSCRIPTION_RESULT_UNKNOWN', true);
      }
    }
  }

  // Registre o ID assim que ele for conhecido. Qualquer validação ou persistência
  // posterior ainda precisa conseguir compensar o recurso remoto.
  input.stagedIds.asaasSubscriptionId = subscription.id;

  const mismatch =
    !subscription.id ||
    subscription.deleted ||
    subscription.externalReference !== input.externalReference ||
    subscription.status !== 'ACTIVE' ||
    subscription.customer !== input.customerId ||
    Math.abs(Number(subscription.value) - input.request.subscription.value) > 0.001 ||
    subscription.billingType !== input.request.subscription.billingType ||
    subscription.cycle !== input.request.subscription.cycle ||
    (input.request.subscription.endDate != null &&
      subscription.endDate !== input.request.subscription.endDate);
  if (mismatch) {
    await markUnknown(
      {
        jobId: operation.job.id,
        contaId: input.request.contaId,
        resource: 'SUBSCRIPTION',
        entityId: input.request.operationId,
        externalReference: input.externalReference,
        error: 'REMOTE_SUBSCRIPTION_CONFIRMATION_MISMATCH',
      },
      deps,
    );
    throw new EnrollmentFinancialStageError('REMOTE_SUBSCRIPTION_CONFIRMATION_MISMATCH', true);
  }

  await deps.markRemoteConfirmed(operation.job.id, subscription.id, {
    providerStatus: subscription.status,
  });
  return subscription;
}

async function confirmFirstPayment(input: {
  request: StageEnrollmentFinancialResourcesInput;
  customerId: string;
  subscriptionId: string;
}, deps: Dependencies) {
  const attempts = Math.max(1, Math.min(input.request.confirmationAttempts ?? 3, 6));
  const delay = Math.max(0, Math.min(input.request.confirmationDelayMs ?? 250, 2_000));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const payments = await deps.listPayments(
      { subscription: input.subscriptionId, limit: 20, includeDeleted: true },
      { contaId: input.request.contaId },
    );
    const payment = payments.data.find((candidate) =>
      paymentMatches({
        payment: candidate,
        customerId: input.customerId,
        value: input.request.subscription.value,
        dueDate: input.request.subscription.nextDueDate,
        subscriptionId: input.subscriptionId,
      }),
    );
    if (payment) return payment;
    if (attempt < attempts && delay > 0) await deps.wait(delay);
  }
  throw new EnrollmentFinancialStageError('FIRST_SUBSCRIPTION_PAYMENT_NOT_CONFIRMED', true);
}

async function stageEnrollmentFee(input: {
  request: StageEnrollmentFinancialResourcesInput;
  fee: EnrollmentFeeStageInput;
  customerId: string;
  externalReference: string;
  stagedIds: StagedRemoteIds;
}, deps: Dependencies) {
  const paymentInput = {
    contaId: input.request.contaId,
    customer: input.customerId,
    billingType: input.fee.billingType,
    value: input.fee.value,
    dueDate: input.fee.dueDate,
    description: input.fee.description,
    externalReference: input.externalReference,
    idempotencyKey: `${input.request.idempotencyKey}:fee`,
    discount: input.fee.discount,
    interest: input.fee.interest,
    fine: input.fee.fine,
  };
  const idempotencyKey = buildSafeAsaasIdempotencyKey(paymentInput.idempotencyKey);
  const operation = await deps.reserveOperation({
    contaId: input.request.contaId,
    type: 'CREATE_PAYMENT',
    idempotencyKey,
    resource: 'PAYMENT',
    entityId: input.request.operationId,
    externalReference: input.externalReference,
    requestFingerprint: hashPayload(paymentInput),
    metadata: { enrollmentCreationOperationId: input.request.operationId, kind: 'ENROLLMENT_FEE' },
  });

  let payment = operation.payload.remoteId
    ? await deps.getPayment(operation.payload.remoteId, { contaId: input.request.contaId }).catch(() => null)
    : null;
  payment ??= await findUniquePaymentByReference(
    input.request.contaId,
    input.externalReference,
    deps,
  );

  if (!payment) {
    const claimed = await deps.markRemoteRequested(operation.job.id);
    if (!claimed) {
      throw new EnrollmentFinancialStageError('ENROLLMENT_FEE_OPERATION_ALREADY_IN_PROGRESS', true);
    }
    const created = await deps.createPayment(paymentInput);
    if (created.success) {
      payment = await deps
        .getPayment(created.data.id, { contaId: input.request.contaId })
        .catch(() => null);
    }
    if (!payment) {
      payment = await findUniquePaymentByReference(
        input.request.contaId,
        input.externalReference,
        deps,
      ).catch(() => null);
    }
    if (!payment && !created.success && !created.error.resultUnknown) {
      await deps.markFailed(operation.job.id, created.error.message, {
        providerErrorCode: created.error.code,
        providerHttpStatus: created.error.httpStatus,
      });
      const rejectedDueDate = /data de vencimento inferior|due date.*past/i.test(
        created.error.message,
      );
      throw new EnrollmentFinancialStageError(
        rejectedDueDate ? 'ENROLLMENT_FEE_DUE_DATE_INVALID' : 'ENROLLMENT_FEE_REJECTED',
        false,
      );
    }
    if (!payment) {
      await markUnknown(
        {
          jobId: operation.job.id,
          contaId: input.request.contaId,
          resource: 'PAYMENT',
          entityId: input.request.operationId,
          externalReference: input.externalReference,
          error: created.success ? 'PAYMENT_GET_FAILED_AFTER_CREATE' : created.error.message,
        },
        deps,
      );
      throw new EnrollmentFinancialStageError('ENROLLMENT_FEE_RESULT_UNKNOWN', true);
    }
  }

  input.stagedIds.enrollmentFeePaymentId = payment.id;

  if (
    !paymentMatches({
      payment,
      customerId: input.customerId,
      value: input.fee.value,
      dueDate: input.fee.dueDate,
      externalReference: input.externalReference,
    })
  ) {
    await markUnknown(
      {
        jobId: operation.job.id,
        contaId: input.request.contaId,
        resource: 'PAYMENT',
        entityId: input.request.operationId,
        externalReference: input.externalReference,
        error: 'REMOTE_ENROLLMENT_FEE_CONFIRMATION_MISMATCH',
      },
      deps,
    );
    throw new EnrollmentFinancialStageError('REMOTE_ENROLLMENT_FEE_CONFIRMATION_MISMATCH', true);
  }

  await deps.markRemoteConfirmed(operation.job.id, payment.id, { providerStatus: payment.status });
  return payment;
}

export async function compensateStagedEnrollmentFinancialResources(
  input: {
    contaId: string;
    operationId?: string | null;
    asaasSubscriptionId?: string | null;
    firstSubscriptionPaymentId?: string | null;
    enrollmentFeePaymentId?: string | null;
  },
  dependencyOverrides: Partial<Dependencies> = {},
): Promise<EnrollmentFinancialCompensationResult> {
  const deps = { ...defaultDependencies, ...dependencyOverrides };
  const result: EnrollmentFinancialCompensationResult = {
    complete: true,
    deletedPaymentIds: [],
    deletedFirstSubscriptionPaymentId: null,
    deletedEnrollmentFeePaymentId: null,
    deletedSubscriptionId: null,
    errors: [],
  };
  const paymentIds = new Set<string>();
  const firstSubscriptionPaymentId = input.firstSubscriptionPaymentId ?? null;
  if (firstSubscriptionPaymentId) paymentIds.add(firstSubscriptionPaymentId);
  let enrollmentFeePaymentId = input.enrollmentFeePaymentId ?? null;
  if (enrollmentFeePaymentId) paymentIds.add(enrollmentFeePaymentId);

  let asaasSubscriptionId = input.asaasSubscriptionId ?? null;
  if (input.operationId) {
    try {
      const discoveredSubscription = await findUniqueSubscriptionByReference(
        input.contaId,
        `enrollment-op:${input.operationId}:subscription`,
        deps,
      );
      asaasSubscriptionId ??= discoveredSubscription?.id ?? null;
      const discoveredFee = await findUniquePaymentByReference(
        input.contaId,
        `enrollment-op:${input.operationId}:fee`,
        deps,
      );
      if (discoveredFee) {
        enrollmentFeePaymentId ??= discoveredFee.id;
        paymentIds.add(discoveredFee.id);
      }
    } catch (error) {
      result.errors.push({
        resource: 'SUBSCRIPTION',
        id: input.operationId,
        message: `DISCOVERY_FAILED:${errorMessage(error)}`,
      });
    }
  }

  if (asaasSubscriptionId) {
    try {
      const payments = await deps.listPayments(
        { subscription: asaasSubscriptionId, limit: 100, includeDeleted: true },
        { contaId: input.contaId },
      );
      for (const payment of payments.data) {
        if (!payment.deleted) paymentIds.add(payment.id);
      }
    } catch (error) {
      result.errors.push({
        resource: 'SUBSCRIPTION',
        id: asaasSubscriptionId,
        message: `LIST_PAYMENTS_FAILED:${errorMessage(error)}`,
      });
    }
  }

  for (const paymentId of paymentIds) {
    try {
      await deps.deletePayment(paymentId, { contaId: input.contaId });
      result.deletedPaymentIds.push(paymentId);
      if (paymentId === firstSubscriptionPaymentId) {
        result.deletedFirstSubscriptionPaymentId = paymentId;
      }
      if (paymentId === enrollmentFeePaymentId) {
        result.deletedEnrollmentFeePaymentId = paymentId;
      }
    } catch (error) {
      if (isNotFound(error)) {
        result.deletedPaymentIds.push(paymentId);
        if (paymentId === firstSubscriptionPaymentId) {
          result.deletedFirstSubscriptionPaymentId = paymentId;
        }
        if (paymentId === enrollmentFeePaymentId) {
          result.deletedEnrollmentFeePaymentId = paymentId;
        }
      } else {
        result.errors.push({ resource: 'PAYMENT', id: paymentId, message: errorMessage(error) });
      }
    }
  }

  if (asaasSubscriptionId) {
    try {
      await deps.deleteSubscription(asaasSubscriptionId, { contaId: input.contaId });
      result.deletedSubscriptionId = asaasSubscriptionId;
    } catch (error) {
      if (isNotFound(error)) {
        result.deletedSubscriptionId = asaasSubscriptionId;
      } else {
        result.errors.push({
          resource: 'SUBSCRIPTION',
          id: asaasSubscriptionId,
          message: errorMessage(error),
        });
      }
    }
  }

  result.complete = result.errors.length === 0;
  return result;
}

export async function stageEnrollmentFinancialResources(
  input: StageEnrollmentFinancialResourcesInput,
  dependencyOverrides: Partial<Dependencies> = {},
): Promise<StageEnrollmentFinancialResourcesResult> {
  const deps = { ...defaultDependencies, ...dependencyOverrides };
  const stagedIds: StagedRemoteIds = {
    asaasSubscriptionId: null,
    firstSubscriptionPaymentId: null,
    enrollmentFeePaymentId: null,
  };

  try {
    validateInput(input);
    const kyc = await deps.requireKycApproved(input.contaId);
    if (!kyc.success) throw new EnrollmentFinancialStageError(kyc.error);
    await deps.assertAsaasTenantOperational(input.contaId);
    await deps.ensureWebhookConfigOperational(input.contaId);
    const credentials = await deps.loadAsaasCredentials(input.contaId);
    if (!credentials) throw new EnrollmentFinancialStageError('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const customer = await deps.ensureCustomer({ contaId: input.contaId, payer: input.payer });
    if (!customer.success) throw new EnrollmentFinancialStageError(customer.error);

    const subscriptionExternalReference = `enrollment-op:${input.operationId}:subscription`;
    const feeExternalReference = `enrollment-op:${input.operationId}:fee`;
    const subscription = await stageSubscription(
      {
        request: input,
        customerId: customer.data.customerId,
        apiKey: credentials.apiKey,
        externalReference: subscriptionExternalReference,
        stagedIds,
      },
      deps,
    );

    const firstPayment = await confirmFirstPayment(
      { request: input, customerId: customer.data.customerId, subscriptionId: subscription.id },
      deps,
    );
    stagedIds.firstSubscriptionPaymentId = firstPayment.id;

    let enrollmentFee: Awaited<ReturnType<typeof getPayment>> | null = null;
    if (input.enrollmentFee) {
      enrollmentFee = await stageEnrollmentFee(
        {
          request: input,
          fee: input.enrollmentFee,
          customerId: customer.data.customerId,
          externalReference: feeExternalReference,
          stagedIds,
        },
        deps,
      );
    }

    return {
      success: true,
      data: {
        operationId: input.operationId,
        customer: {
          localCustomerId: customer.data.localCustomerId,
          asaasCustomerId: customer.data.customerId,
        },
        subscription: {
          asaasSubscriptionId: subscription.id,
          externalReference: subscriptionExternalReference,
          firstPayment: toStagedPayment(firstPayment),
        },
        enrollmentFee: enrollmentFee ? toStagedPayment(enrollmentFee) : null,
      },
    };
  } catch (error) {
    const ownsCompensation = input.claimCompensation
      ? await input.claimCompensation().catch(() => false)
      : true;
    if (!ownsCompensation) {
      return {
        success: false,
        error: 'ENROLLMENT_OPERATION_LEASE_LOST',
        resultUnknown: true,
        compensation: {
          complete: false,
          deletedPaymentIds: [],
          deletedFirstSubscriptionPaymentId: null,
          deletedEnrollmentFeePaymentId: null,
          deletedSubscriptionId: null,
          errors: [
            {
              resource: 'SUBSCRIPTION',
              id: input.operationId,
              message: 'COMPENSATION_SKIPPED_LEASE_LOST',
            },
          ],
        },
      };
    }
    const compensation = await compensateStagedEnrollmentFinancialResources(
      {
        contaId: input.contaId,
        operationId: input.operationId,
        asaasSubscriptionId: stagedIds.asaasSubscriptionId,
        firstSubscriptionPaymentId: stagedIds.firstSubscriptionPaymentId,
        enrollmentFeePaymentId: stagedIds.enrollmentFeePaymentId,
      },
      deps,
    );
    const stagedError = error instanceof EnrollmentFinancialStageError ? error : null;
    const compensationResolvedRemoteUncertainty =
      compensation.complete &&
      Boolean(compensation.deletedSubscriptionId) &&
      Boolean(compensation.deletedFirstSubscriptionPaymentId) &&
      (!input.enrollmentFee || Boolean(compensation.deletedEnrollmentFeePaymentId));
    return {
      success: false,
      error: stagedError?.message ?? errorMessage(error),
      // Erros tipados são classificados pelo ponto que conhece se houve POST.
      // Uma exceção inesperada é conservadoramente incerta: nunca autoriza retry
      // cego de uma criação financeira.
      resultUnknown: Boolean(
        (stagedError
          ? stagedError.resultUnknown && !compensationResolvedRemoteUncertainty
          : true) || !compensation.complete,
      ),
      compensation,
    };
  }
}
