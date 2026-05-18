import {
  deleteInstallmentPayments as asaasDeleteInstallmentPayments,
  deletePayment as asaasDeletePayment,
  listPayments as asaasListPayments,
  getPayment as asaasGetPayment,
  getPaymentStatus as asaasGetPaymentStatus,
  getInstallment as asaasGetInstallment,
  notifyPayment as asaasNotifyPayment,
  receiveInCash as asaasReceiveInCash,
  undoReceivedInCash as asaasUndoReceivedInCash,
  refundPayment as asaasRefundPayment,
  getBillingInfo as asaasGetBillingInfo,
  updatePayment as asaasUpdatePayment,
  getSubscription as asaasGetSubscription,
  updateSubscription as asaasUpdateSubscription,
  deleteSubscription as asaasDeleteSubscription,
  createSubscription as asaasCreateSubscription,
  listSubscriptionPayments as asaasListSubscriptionPayments,
  listInstallmentPayments as asaasListInstallmentPayments,
  updateSubscriptionCreditCard as asaasUpdateSubscriptionCreditCard,
  type ListInstallmentPaymentsParams as AsaasListInstallmentPaymentsParams,
  type ListSubscriptionPaymentsParams as AsaasListSubscriptionPaymentsParams,
  type UpdateSubscriptionCreditCardInput as AsaasUpdateSubscriptionCreditCardInput,
  type BillingType,
  type Cycle,
  type AsaasNotificationType,
  type AsaasPayment,
  type AsaasPaymentStatusResponse,
  type ListPaymentsParams as AsaasListPaymentsParams,
  type DeleteInstallmentPaymentsResponse,
  type CreatePaymentInput,
  type AsaasSubscription,
  type UpdateSubscriptionInput,
  type BillingInfoResponse,
} from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';

import { requireKycApproved } from '../foundation/kyc-guard';
import { buildSafeAsaasIdempotencyKey } from '../core';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';

export class AsaasEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsaasEnvError';
  }
}

export class KycNotApprovedError extends Error {
  constructor(message = 'KYC não aprovado') {
    super(message);
    this.name = 'KycNotApprovedError';
  }
}

export function isAsaasEnabled(): boolean {
  return process.env.FEATURE_ASAAS === 'true';
}

export function getCurrentBrasiliaDate(): {
  dateObj: Date;
  dateStr: string;
  year: number;
  month: number;
  day: number;
} {
  const now = new Date();

  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = dtf.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const yearStr = get('year') ?? '1970';
  const monthStr = get('month') ?? '01';
  const dayStr = get('day') ?? '01';

  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const dateStr = `${yearStr}-${monthStr}-${dayStr}`;
  const dateObj = new Date(`${dateStr}T12:00:00.000Z`);

  return { dateObj, dateStr, year, month, day };
}

export function formatDate(input: Date | string): string {
  if (typeof input === 'string') {
    // assume YYYY-MM-DD or ISO; keep YYYY-MM-DD
    return input.slice(0, 10);
  }

  const y = input.getFullYear();
  const m = String(input.getMonth() + 1).padStart(2, '0');
  const d = String(input.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type ReadCacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const READ_CACHE_TTL_MS = 10_000;
const SUBSCRIPTION_PAYMENTS_CACHE_TTL_MS = 5_000;
const readCache = new Map<string, ReadCacheEntry<unknown>>();
const readInFlight = new Map<string, Promise<unknown>>();

function isReadCacheEnabled(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env.ASAAS_READ_CACHE !== 'false';
}

function getCachedRead<T>(key: string): T | null {
  if (!isReadCacheEnabled()) return null;

  const entry = readCache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    readCache.delete(key);
    return null;
  }

  return entry.value as T;
}

function setCachedRead<T>(key: string, value: T, ttlMs: number): void {
  if (!isReadCacheEnabled()) return;

  readCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

async function withReadCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  if (!isReadCacheEnabled()) {
    return loader();
  }

  const cached = getCachedRead<T>(key);
  if (cached) {
    return cached;
  }

  const existing = readInFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const request = loader()
    .then((value) => {
      setCachedRead(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      readInFlight.delete(key);
    });

  readInFlight.set(key, request as Promise<unknown>);
  return request;
}

function invalidateReadCache(prefixes: string[]): void {
  if (!isReadCacheEnabled()) return;

  for (const key of [...readCache.keys()]) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      readCache.delete(key);
    }
  }
}

function paymentCachePrefix(contaId: string, paymentId: string): string {
  return `payment:${contaId}:${paymentId}`;
}

function subscriptionCachePrefix(contaId: string, subscriptionId: string): string {
  return `subscription:${contaId}:${subscriptionId}`;
}

function subscriptionPaymentsCachePrefix(contaId: string, subscriptionId: string): string {
  return `subscriptionPayments:${contaId}:${subscriptionId}`;
}

function installmentPaymentsCachePrefix(contaId: string, installmentId: string): string {
  return `installmentPayments:${contaId}:${installmentId}`;
}

async function getCredentialsOrThrow(contaId: string): Promise<{ apiKey: string }> {
  const creds = await loadAsaasCredentials(contaId);
  if (!creds) {
    throw new AsaasEnvError('Credenciais Asaas não configuradas');
  }

  return { apiKey: creds.apiKey };
}

async function assertKycApprovedOrThrow(contaId: string): Promise<void> {
  const result = await requireKycApproved(contaId);
  if (result.success) return;
  if (result.error === 'KYC_NAO_APROVADO') throw new KycNotApprovedError();
  throw new Error('Falha ao validar KYC');
}

async function ensureFinancialMutationOperational(contaId: string): Promise<void> {
  await assertKycApprovedOrThrow(contaId);
  await ensureWebhookConfigOperational(contaId);
}

export async function getPayment(
  paymentId: string,
  opts: { contaId: string },
): Promise<AsaasPayment> {
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  return withReadCache(paymentCachePrefix(opts.contaId, paymentId), READ_CACHE_TTL_MS, () =>
    asaasGetPayment({ apiKey, paymentId }),
  );
}

export async function getPaymentStatus(
  paymentId: string,
  opts: { contaId: string },
): Promise<AsaasPaymentStatusResponse> {
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  return asaasGetPaymentStatus({ apiKey, paymentId });
}

export async function listPayments(
  filters: Omit<AsaasListPaymentsParams, 'apiKey'>,
  opts: { contaId: string },
): Promise<Awaited<ReturnType<typeof asaasListPayments>>> {
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  return asaasListPayments({ apiKey, ...filters });
}

export async function updatePayment(
  paymentId: string,
  payload: Partial<CreatePaymentInput>,
  opts: { contaId: string },
): Promise<AsaasPayment> {
  await assertKycApprovedOrThrow(opts.contaId);
  await ensureWebhookConfigOperational(opts.contaId);
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  const response = await asaasUpdatePayment({ apiKey, paymentId, data: payload });
  invalidateReadCache([paymentCachePrefix(opts.contaId, paymentId)]);
  return response;
}

export async function deletePayment(
  paymentId: string,
  opts: { contaId: string },
): Promise<AsaasPayment> {
  await assertKycApprovedOrThrow(opts.contaId);
  await ensureWebhookConfigOperational(opts.contaId);
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  const response = await asaasDeletePayment({ apiKey, paymentId });
  invalidateReadCache([paymentCachePrefix(opts.contaId, paymentId)]);
  return response;
}

export async function deleteInstallmentPayments(
  installmentId: string,
  opts: { contaId: string },
): Promise<DeleteInstallmentPaymentsResponse> {
  await assertKycApprovedOrThrow(opts.contaId);
  await ensureWebhookConfigOperational(opts.contaId);
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  return asaasDeleteInstallmentPayments({ apiKey, installmentId });
}

export async function confirmCashPayment(
  paymentId: string,
  paymentDate: string,
  value: number,
  notifyCustomer: boolean | undefined,
  opts: { contaId: string },
): Promise<void> {
  await assertKycApprovedOrThrow(opts.contaId);
  await ensureWebhookConfigOperational(opts.contaId);
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  await asaasReceiveInCash({ apiKey, paymentId, paymentDate, value, notifyCustomer });
  invalidateReadCache([paymentCachePrefix(opts.contaId, paymentId)]);
}

export async function reenviarCobranca(input: {
  paymentId: string;
  tipo: AsaasNotificationType;
  contaId: string;
}): Promise<{ success: boolean; message: string }> {
  await ensureFinancialMutationOperational(input.contaId);
  const { apiKey } = await getCredentialsOrThrow(input.contaId);
  const result = await asaasNotifyPayment({ apiKey, paymentId: input.paymentId, tipo: input.tipo });

  return {
    success: result.success,
    message:
      result.message ?? (result.success ? 'Notificação enviada' : 'Falha ao enviar notificação'),
  };
}

export async function refundCobranca(input: {
  paymentId: string;
  contaId: string;
  value?: number;
  description?: string;
  splitRefunds?: Array<{ id: string; value: number }>;
}): Promise<{ success: boolean; message: string }> {
  await assertKycApprovedOrThrow(input.contaId);
  await ensureWebhookConfigOperational(input.contaId);
  const { apiKey } = await getCredentialsOrThrow(input.contaId);
  await asaasRefundPayment({
    apiKey,
    paymentId: input.paymentId,
    value: input.value,
    description: input.description,
    splitRefunds: input.splitRefunds,
  });
  invalidateReadCache([paymentCachePrefix(input.contaId, input.paymentId)]);
  return { success: true, message: 'Reembolso solicitado' };
}

export async function getSubscription(
  subscriptionId: string,
  opts: { contaId: string },
): Promise<AsaasSubscription> {
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  return withReadCache(
    subscriptionCachePrefix(opts.contaId, subscriptionId),
    READ_CACHE_TTL_MS,
    () => asaasGetSubscription({ apiKey, subscriptionId }),
  );
}

export async function getInstallment(
  installmentId: string,
  opts: { contaId: string },
): Promise<Awaited<ReturnType<typeof asaasGetInstallment>>> {
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  return asaasGetInstallment({ apiKey, installmentId });
}

export async function listSubscriptionPayments(
  subscriptionId: string,
  opts: {
    contaId: string;
    limit?: number;
    offset?: number;
    status?: AsaasListSubscriptionPaymentsParams['status'];
  },
): Promise<Awaited<ReturnType<typeof asaasListSubscriptionPayments>>> {
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  const cacheKey = `${subscriptionPaymentsCachePrefix(opts.contaId, subscriptionId)}:${opts.limit ?? 'default'}:${opts.offset ?? 0}:${opts.status ?? 'ALL'}`;
  return withReadCache(cacheKey, SUBSCRIPTION_PAYMENTS_CACHE_TTL_MS, () =>
    asaasListSubscriptionPayments({
      apiKey,
      subscriptionId,
      limit: opts.limit,
      offset: opts.offset,
      status: opts.status,
    }),
  );
}

export async function listInstallmentPayments(
  installmentId: string,
  opts: {
    contaId: string;
    limit?: AsaasListInstallmentPaymentsParams['limit'];
    offset?: AsaasListInstallmentPaymentsParams['offset'];
  },
): Promise<Awaited<ReturnType<typeof asaasListInstallmentPayments>>> {
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  const cacheKey = `${installmentPaymentsCachePrefix(opts.contaId, installmentId)}:${opts.limit ?? 'default'}:${opts.offset ?? 0}`;

  return withReadCache(cacheKey, SUBSCRIPTION_PAYMENTS_CACHE_TTL_MS, () =>
    asaasListInstallmentPayments({
      apiKey,
      installmentId,
      limit: opts.limit,
      offset: opts.offset,
    }),
  );
}

export async function updateSubscription(
  subscriptionId: string,
  payload: UpdateSubscriptionInput,
  opts: { contaId: string },
): Promise<AsaasSubscription> {
  await assertKycApprovedOrThrow(opts.contaId);
  await ensureWebhookConfigOperational(opts.contaId);
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  const response = await asaasUpdateSubscription({ apiKey, subscriptionId, data: payload });
  invalidateReadCache([
    subscriptionCachePrefix(opts.contaId, subscriptionId),
    subscriptionPaymentsCachePrefix(opts.contaId, subscriptionId),
  ]);
  return response;
}

export async function updateSubscriptionCreditCard(
  subscriptionId: string,
  payload: AsaasUpdateSubscriptionCreditCardInput,
  opts: { contaId: string },
): Promise<Awaited<ReturnType<typeof asaasUpdateSubscriptionCreditCard>>> {
  await assertKycApprovedOrThrow(opts.contaId);
  await ensureWebhookConfigOperational(opts.contaId);
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  const response = await asaasUpdateSubscriptionCreditCard({
    apiKey,
    subscriptionId,
    data: payload,
  });
  invalidateReadCache([
    subscriptionCachePrefix(opts.contaId, subscriptionId),
    subscriptionPaymentsCachePrefix(opts.contaId, subscriptionId),
  ]);
  return response;
}

export async function deleteSubscription(
  subscriptionId: string,
  opts: { contaId: string },
): Promise<AsaasSubscription> {
  await assertKycApprovedOrThrow(opts.contaId);
  await ensureWebhookConfigOperational(opts.contaId);
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  const response = await asaasDeleteSubscription({ apiKey, subscriptionId });
  invalidateReadCache([
    subscriptionCachePrefix(opts.contaId, subscriptionId),
    subscriptionPaymentsCachePrefix(opts.contaId, subscriptionId),
  ]);
  return response;
}

export async function cancelInstallmentPayments(
  installmentId: string,
  opts: { contaId: string },
): Promise<DeleteInstallmentPaymentsResponse> {
  await assertKycApprovedOrThrow(opts.contaId);
  await ensureWebhookConfigOperational(opts.contaId);
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  return asaasDeleteInstallmentPayments({ apiKey, installmentId });
}

export async function pauseAssinatura(input: {
  subscriptionId: string;
  contaId: string;
}): Promise<{ success: boolean; message: string }> {
  await assertKycApprovedOrThrow(input.contaId);
  await ensureWebhookConfigOperational(input.contaId);
  const { apiKey } = await getCredentialsOrThrow(input.contaId);
  await asaasUpdateSubscription({
    apiKey,
    subscriptionId: input.subscriptionId,
    data: { status: 'INACTIVE' },
  });
  invalidateReadCache([
    subscriptionCachePrefix(input.contaId, input.subscriptionId),
    subscriptionPaymentsCachePrefix(input.contaId, input.subscriptionId),
  ]);
  return { success: true, message: 'Assinatura pausada' };
}

export async function ativarAssinatura(input: {
  subscriptionId: string;
  contaId: string;
  nextDueDate: string;
}): Promise<{ success: boolean; message: string }> {
  await assertKycApprovedOrThrow(input.contaId);
  await ensureWebhookConfigOperational(input.contaId);
  const { apiKey } = await getCredentialsOrThrow(input.contaId);
  await asaasUpdateSubscription({
    apiKey,
    subscriptionId: input.subscriptionId,
    data: { status: 'ACTIVE', nextDueDate: input.nextDueDate },
  });
  invalidateReadCache([
    subscriptionCachePrefix(input.contaId, input.subscriptionId),
    subscriptionPaymentsCachePrefix(input.contaId, input.subscriptionId),
  ]);
  return { success: true, message: 'Assinatura ativada' };
}

/**
 * Desfaz o recebimento em dinheiro de uma cobrança.
 * O status do pagamento volta para o estado anterior (PENDING ou OVERDUE).
 */
export async function undoCashPayment(
  paymentId: string,
  opts: { contaId: string },
): Promise<AsaasPayment> {
  await ensureFinancialMutationOperational(opts.contaId);
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  const response = await asaasUndoReceivedInCash({ apiKey, paymentId });
  invalidateReadCache([paymentCachePrefix(opts.contaId, paymentId)]);
  return response;
}

/**
 * Obtém informações de cobrança (billing info) - QR Code Pix, boleto, etc.
 */
export async function getBillingInfo(
  paymentId: string,
  opts: { contaId: string },
): Promise<BillingInfoResponse> {
  const { apiKey } = await getCredentialsOrThrow(opts.contaId);
  return asaasGetBillingInfo({ apiKey, paymentId });
}

export async function reativarAssinatura(input: {
  customer: string;
  billingType: BillingType;
  nextDueDate: string;
  value: number;
  cycle: Cycle;
  description?: string;
  endDate?: string;
  externalReference?: string;
  contaId: string;
}): Promise<{ success: boolean; message: string; data?: { id: string } }> {
  await ensureFinancialMutationOperational(input.contaId);
  const { apiKey } = await getCredentialsOrThrow(input.contaId);
  const billingTypeSentToAsaas: BillingType = input.billingType;
  const safeIdempotencyKey = input.externalReference
    ? buildSafeAsaasIdempotencyKey(input.externalReference)
    : undefined;
  const subscription = await asaasCreateSubscription({
    apiKey,
    idempotencyKey: safeIdempotencyKey,
    data: {
      customer: input.customer,
      billingType: billingTypeSentToAsaas,
      nextDueDate: input.nextDueDate,
      value: input.value,
      cycle: input.cycle,
      description: input.description,
      endDate: input.endDate,
      externalReference: input.externalReference,
    },
  });

  return { success: true, message: 'Assinatura reativada', data: { id: subscription.id } };
}
