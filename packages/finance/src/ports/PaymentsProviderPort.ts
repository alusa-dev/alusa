/**
 * PaymentsProviderPort — Interface abstrata para provedores de pagamento
 * 
 * Esta porta define o contrato entre o domínio da Alusa e qualquer
 * provedor de pagamentos (atualmente Asaas). Garante que o domínio
 * não conhece detalhes de implementação do provedor.
 * 
 * Regras:
 * - Nenhum termo específico do provedor deve vazar para o domínio
 * - DTOs usam nomenclatura neutra (customerId, subscriptionId)
 * - Erros são mapeados para códigos de domínio
 */

export type PayerType = 'ALUNO' | 'RESPONSAVEL';

export interface PayerInfo {
  type: PayerType;
  id: string;
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  address?: {
    postalCode?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
  };
}

export interface ResolveOrCreateCustomerInput {
  contaId: string;
  payer: PayerInfo;
  externalReference: string;
}

export interface ResolveOrCreateCustomerResult {
  customerId: string;
  created: boolean;
}

export interface CancelSubscriptionInput {
  contaId: string;
  subscriptionId: string;
}

export interface CancelSubscriptionResult {
  success: boolean;
  notFound?: boolean;
}

export type BillingCycle = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
export type BillingType = 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED';

export interface SubscriptionDiscount {
  value?: number;
  dueDateLimitDays?: number;
  type?: 'FIXED' | 'PERCENTAGE';
}

export interface SubscriptionInterest {
  value: number;
}

export interface SubscriptionFine {
  value: number;
  type?: 'FIXED' | 'PERCENTAGE';
}

export interface ProviderCreateSubscriptionInput {
  contaId: string;
  customerId: string;
  value: number;
  nextDueDate: string; // YYYY-MM-DD
  cycle: BillingCycle;
  billingType: BillingType;
  description?: string;
  externalReference: string;
  endDate?: string; // YYYY-MM-DD
  discount?: SubscriptionDiscount;
  interest?: SubscriptionInterest;
  fine?: SubscriptionFine;
}

export interface ProviderCreateSubscriptionResult {
  subscriptionId: string;
  nextDueDate: string;
  status: string;
}

export interface ProviderCreatePaymentInput {
  contaId: string;
  customerId: string;
  billingType: BillingType;
  value: number;
  dueDate: string; // YYYY-MM-DD
  description?: string;
  externalReference: string;
}

export interface ProviderCreatePaymentResult {
  paymentId: string;
  status: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
}

export interface ProviderSubscriptionPayment {
  id: string;
  value: number;
  dueDate: string;
  status: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
}

export interface ProviderListSubscriptionPaymentsResult {
  data: ProviderSubscriptionPayment[];
  totalCount: number;
}

export interface PaymentsProviderPort {
  resolveOrCreateCustomerForPayer(
    input: ResolveOrCreateCustomerInput
  ): Promise<ResolveOrCreateCustomerResult>;

  cancelSubscription(
    input: CancelSubscriptionInput
  ): Promise<CancelSubscriptionResult>;

  createSubscription(
    input: ProviderCreateSubscriptionInput
  ): Promise<ProviderCreateSubscriptionResult>;

  createPayment(
    input: ProviderCreatePaymentInput
  ): Promise<ProviderCreatePaymentResult>;

  listSubscriptionPayments(
    subscriptionId: string,
    opts: { contaId: string; limit?: number; offset?: number }
  ): Promise<ProviderListSubscriptionPaymentsResult>;
}
