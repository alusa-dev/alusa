import { authenticatedApi } from '@/features/auth/services/auth-service';
import type {
  BillingCategory,
  BillingOrigin,
  BillingChargeResponse,
  BillingChargesResponse,
  BillingPeriod,
  BillingSummaryResponse,
  InstallmentDetailResponse,
  InstallmentPlansResponse,
  SubscriptionDetailResponse,
  SubscriptionPlansResponse,
} from '../types/billing';

export type BillingPayerCandidate = {
  id: string;
  name: string;
  type: 'aluno' | 'responsavel';
  photo?: string | null;
  cpf?: string;
  cpfMasked?: string | null;
  isMinor: boolean;
  hasResponsible: boolean;
  responsibleId: string | null;
  responsibleName: string | null;
  payerResolved: { type: 'aluno' | 'responsavel'; id: string; name: string; hasAsaasCustomerId: boolean };
  financialStatus: 'OK' | 'INCOMPLETE';
};

export type MobileStandaloneChargeInput = {
  payer: { type: 'aluno'; alunoId: string } | { type: 'responsavel'; responsavelId: string };
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
  uiRequestId: string;
};

export type MobileStandaloneChargeResponse = {
  success: true;
  pending?: boolean;
  message?: string;
  data: { chargeId: string; status: string; externalReference: string };
};

export type PaymentSimulationInput = {
  value: number;
  installmentCount: number;
  passFees: boolean;
};

export type PaymentSimulationResult = {
  requestedValue: number;
  chargeValue: number;
  installmentCount: number;
  netValue: number;
  installmentValue: number;
  installmentNetValue: number;
  feeValue: number;
  feePercentage: number | null;
  operationFee: number | null;
};

export type BillingChargeAction =
  | 'CONFIRM_CASH_PAYMENT'
  | 'CANCEL'
  | 'REFUND'
  | 'UNDO_CASH_PAYMENT'
  | 'UPDATE_CHARGE'
  | 'UPDATE_RULES';

export type BillingChargeChanges = {
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

export type BillingChargesSort = 'created-at-desc' | 'created-at-asc' | 'priority' | 'due-date-asc' | 'due-date-desc' | 'amount-desc' | 'amount-asc';

function periodQuery(period: BillingPeriod) {
  return period === 'last-30-days' ? 'last-30-days' : 'this-month';
}

export const billingService = {
  listSubscriptions(input: { page?: number; pageSize?: number; search?: string }) {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      pageSize: String(input.pageSize ?? 20),
    });
    if (input.search?.trim()) params.set('q', input.search.trim());
    return authenticatedApi.request<SubscriptionPlansResponse>({
      method: 'GET',
      path: `/api/mobile/subscriptions?${params.toString()}`,
    });
  },

  getSubscription(subscriptionId: string) {
    return authenticatedApi.request<SubscriptionDetailResponse>({
      method: 'GET',
      path: `/api/mobile/subscriptions/${encodeURIComponent(subscriptionId)}`,
    });
  },

  listInstallments(input: { page?: number; pageSize?: number; search?: string }) {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      pageSize: String(input.pageSize ?? 20),
    });
    if (input.search?.trim()) params.set('q', input.search.trim());
    return authenticatedApi.request<InstallmentPlansResponse>({
      method: 'GET',
      path: `/api/mobile/installments?${params.toString()}`,
    });
  },

  getInstallment(installmentId: string) {
    return authenticatedApi.request<InstallmentDetailResponse>({
      method: 'GET',
      path: `/api/mobile/installments/${encodeURIComponent(installmentId)}`,
    });
  },

  getSummary(period: BillingPeriod) {
    return authenticatedApi.request<BillingSummaryResponse>({
      method: 'GET',
      path: `/api/mobile/billing/summary?period=${periodQuery(period)}`,
    });
  },

  listCharges(input: { period: BillingPeriod; origin?: BillingOrigin; category?: BillingCategory; search?: string; sort?: BillingChargesSort; page?: number; pageSize?: number; offset?: number; limit?: number }) {
    const params = new URLSearchParams({
      period: periodQuery(input.period),
      page: String(input.page ?? 1),
      pageSize: String(input.pageSize ?? 20),
    });
    if (input.offset !== undefined) params.set('offset', String(input.offset));
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    if (input.category) params.set('category', input.category);
    if (input.origin) params.set('origin', input.origin);
    if (input.search?.trim()) params.set('q', input.search.trim());
    if (input.sort) params.set('sort', input.sort);
    return authenticatedApi.request<BillingChargesResponse>({
      method: 'GET',
      path: `/api/mobile/billing/charges?${params.toString()}`,
    });
  },

  getCharge(chargeId: string) {
    return authenticatedApi.request<BillingChargeResponse>({
      method: 'GET',
      path: `/api/mobile/billing/charges/${encodeURIComponent(chargeId)}`,
    });
  },

  executeAction(chargeId: string, action: BillingChargeAction, changes?: BillingChargeChanges) {
    return authenticatedApi.request<{ success: true; message: string }>({
      method: 'POST',
      path: `/api/mobile/billing/charges/${encodeURIComponent(chargeId)}/actions`,
      body: { action, ...(changes ? { changes } : {}) },
    });
  },

  searchPayers(query: string, signal?: AbortSignal) {
    const params = new URLSearchParams({ q: query.trim() });
    return authenticatedApi.request<{ results: BillingPayerCandidate[] }>({
      method: 'GET',
      path: `/api/mobile/billing/payers/search?${params.toString()}`,
      signal,
    });
  },

  createStandaloneCharge(input: MobileStandaloneChargeInput) {
    return authenticatedApi.request<MobileStandaloneChargeResponse>({
      method: 'POST',
      path: '/api/mobile/billing/charges/standalone',
      body: input,
      headers: { 'X-Idempotency-Key': input.uiRequestId },
    });
  },

  simulatePayment(input: PaymentSimulationInput) {
    return authenticatedApi.request<{ data: PaymentSimulationResult }, PaymentSimulationInput>({
      method: 'POST',
      path: '/api/mobile/billing/simulate',
      body: input,
    });
  },
};
