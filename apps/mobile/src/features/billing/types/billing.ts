export type BillingPeriod = 'this-month' | 'last-30-days';
export type BillingOrigin = 'ACADEMIC' | 'STANDALONE';

export type BillingMetric = {
  count: number;
  amount: number;
};

export type BillingSummary = {
  period: 'THIS_MONTH' | 'LAST_30_DAYS';
  received: BillingMetric;
  confirmed: BillingMetric;
  awaitingPayment: BillingMetric;
  overdue: BillingMetric;
};

export type BillingSummaryResponse = {
  summary: BillingSummary;
};

export type BillingCategory = 'RECEIVED' | 'CONFIRMED' | 'AWAITING_PAYMENT' | 'OVERDUE' | 'REFUNDED' | 'CANCELLED';

export type BillingCharge = {
  id: string;
  category: BillingCategory;
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

export type BillingChargesResponse = {
  charges: BillingCharge[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type BillingChargeResponse = {
  charge: BillingCharge;
};

export type InstallmentPlanStatus = 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'CANCELADO';

export type InstallmentPlan = {
  id: string;
  origin: 'ACADEMIC' | 'STANDALONE';
  studentName: string;
  payerName: string;
  totalValue: number;
  installmentValue: number;
  installmentCount: number;
  installmentsPaid: number;
  billingType: string;
  firstDueDate: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELED';
  createdAt: string;
  matriculaId: string | null;
  contratoId: string | null;
  asaasInstallmentId: string | null;
  statusConsolidado: InstallmentPlanStatus;
  proximoVencimento: string | null;
};

export type InstallmentPlansResponse = {
  items: InstallmentPlan[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type InstallmentItem = {
  id: string;
  numero: number;
  valor: number;
  vencimento: string;
  status: string;
  displayStatus?: {
    status: string;
    label: string;
    hint: string | null;
    variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  };
  dataPagamento: string | null;
  invoiceUrl: string | null;
};

export type InstallmentDetail = {
  id: string;
  origin: 'ACADEMIC' | 'STANDALONE';
  cliente: string;
  clienteEmail?: string;
  clienteTelefone?: string;
  valorTotal: number;
  numeroParcelas: number;
  parcelasPagas: number;
  status: InstallmentPlanStatus;
  billingType: string;
  firstDueDate: string;
  matriculaId: string | null;
  contratoId: string | null;
  createdAt: string;
  parcelas: InstallmentItem[];
};

export type InstallmentDetailResponse = {
  detail: InstallmentDetail;
};

export type SubscriptionStatus = 'REQUESTED' | 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'DELETED' | 'FAILED';

export type SubscriptionPlan = {
  id: string;
  asaasSubscriptionId: string | null;
  externalReference: string;
  status: SubscriptionStatus;
  statusLabel: string;
  payerName: string;
  studentName: string;
  value: number;
  cycle: string;
  cycleLabel: string;
  billingType: string;
  description: string | null;
  nextDueDate: string | null;
  matriculaId: string;
  createdAt: string;
  type: 'PLANO' | 'COMBO' | 'AVULSA';
};

export type SubscriptionPlansResponse = {
  items: SubscriptionPlan[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type SubscriptionChargeItem = {
  id: string;
  numero: number;
  valor: number;
  vencimento: string;
  status: string;
  displayStatus?: {
    status: string;
    label: string;
    hint: string | null;
    variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  };
  dataPagamento: string | null;
  asaasPaymentId: string | null;
};

export type SubscriptionDetail = {
  id: string;
  asaasSubscriptionId: string | null;
  externalReference: string;
  status: SubscriptionStatus;
  statusLabel: string;
  payerName: string;
  payerEmail: string | null;
  payerPhone: string | null;
  studentName: string;
  value: number;
  cycle: string;
  cycleLabel: string;
  billingType: string;
  description: string | null;
  nextDueDate: string | null;
  matriculaId: string;
  contratoId: string;
  createdAt: string;
  charges: SubscriptionChargeItem[];
  totalCharges: number;
  paidCharges: number;
  receivedValue: number;
};

export type SubscriptionDetailResponse = {
  detail: SubscriptionDetail;
};
