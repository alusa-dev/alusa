/**
 * Tipos oficiais da API Asaas
 * 
 * Baseado em: https://docs.asaas.com/reference
 */

// ==================== COMMON ====================

export type BillingType = 'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'UNDEFINED';

export type Cycle = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';

// ==================== INVOICES (NFS-e) ====================

export type AsaasInvoiceStatus =
  | 'SCHEDULED'
  | 'AUTHORIZED'
  | 'PROCESSING_CANCELLATION'
  | 'CANCELED'
  | 'CANCELLATION_DENIED'
  | 'ERROR'
  | string;

export interface AsaasInvoiceTaxes {
  retainIss: boolean;
  cofins: number;
  csll: number;
  inss: number;
  ir: number;
  pis: number;
  iss: number;
}

export interface CreateInvoiceInput {
  payment?: string;
  installment?: string;
  customer?: string;
  serviceDescription: string;
  observations: string;
  externalReference?: string;
  value: number;
  deductions: number;
  effectiveDate: string; // YYYY-MM-DD
  municipalServiceId?: string;
  municipalServiceCode?: string;
  municipalServiceName: string;
  updatePayment?: boolean;
  taxes: AsaasInvoiceTaxes;
}

export interface AsaasInvoice {
  object?: 'invoice' | string;
  id: string;
  status: AsaasInvoiceStatus;
  customer?: string;
  payment?: string;
  installment?: string | null;
  type?: string;
  statusDescription?: string | null;
  serviceDescription?: string;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  rpsSerie?: string | null;
  rpsNumber?: string | null;
  number?: string | null;
  validationCode?: string | null;
  value?: number;
  deductions?: number;
  effectiveDate?: string;
  observations?: string;
  estimatedTaxesDescription?: string | null;
  externalReference?: string | null;
  taxes?: AsaasInvoiceTaxes;
  municipalServiceId?: string | null;
  municipalServiceCode?: string | null;
  municipalServiceName?: string | null;
}

// ==================== FINANCE (BALANCE) ====================

export interface AsaasFinanceBalance {
  balance: number;
}

// ==================== FINANCIAL TRANSACTIONS ====================

export type AsaasFinancialTransactionType =
  | 'PAYMENT_RECEIVED'
  | 'TRANSFER'
  | 'TRANSFER_FEE'
  | 'TRANSFER_REVERSAL'
  | 'REVERSAL'
  | 'PAYMENT_REVERSAL'
  | 'PAYMENT_REFUND_CANCELLED'
  | 'PAYMENT_FEE'
  | 'PAYMENT_FEE_REVERSAL'
  | 'PAYMENT_CUSTODY_BLOCK'
  | 'PAYMENT_CUSTODY_BLOCK_REVERSAL'
  | 'PHONE_CALL_NOTIFICATION_FEE'
  | 'PROMOTIONAL_CODE_CREDIT'
  | 'DEBIT'
  | 'DEBIT_REVERSAL'
  | 'BILL_PAYMENT'
  | 'BILL_PAYMENT_FEE'
  | 'BILL_PAYMENT_CANCELLED'
  | 'BILL_PAYMENT_FEE_CANCELLED'
  | 'BILL_PAYMENT_REFUNDED'
  | 'INTERNAL_TRANSFER_DEBIT'
  | 'INTERNAL_TRANSFER_CREDIT'
  | 'INTERNAL_TRANSFER_REVERSAL'
  | 'CREDIT'
  | 'PARTIAL_PAYMENT'
  | 'PIX_TRANSACTION_DEBIT'
  | 'PIX_TRANSACTION_CREDIT'
  | string;

export interface AsaasFinancialTransaction {
  object: 'financialTransaction';
  id: string;
  value: number;
  balance: number;
  type: AsaasFinancialTransactionType;
  date: string; // YYYY-MM-DD
  description: string;
  externalReference?: string | null;
  paymentId?: string | null;
  splitId?: string | null;
  transferId?: string | null;
  anticipationId?: string | null;
  billId?: string | null;
  invoiceId?: string | null;
  paymentDunningId?: string | null;
  creditBureauReportId?: string | null;
}

// ==================== ANTICIPATIONS ====================

export type AsaasAnticipationStatus =
  | 'PENDING'
  | 'DENIED'
  | 'CREDITED'
  | 'DEBITED'
  | 'CANCELLED'
  | 'OVERDUE'
  | 'SCHEDULED';

export interface AsaasAnticipation {
  object?: 'receivableAnticipation' | 'anticipation' | string;
  id: string;
  installment?: string | null;
  payment?: string | null;
  status: AsaasAnticipationStatus;
  anticipationDate?: string | null;
  dueDate?: string | null;
  requestDate?: string | null;
  fee: number;
  anticipationDays: number;
  netValue: number;
  totalValue: number;
  value: number;
  denialObservation?: string | null;
}

export interface AsaasAnticipationSimulation {
  installment?: string | null;
  payment?: string | null;
  anticipationDate?: string | null;
  dueDate?: string | null;
  fee: number;
  anticipationDays: number;
  netValue: number;
  totalValue: number;
  value: number;
  isDocumentationRequired: boolean;
}

export interface AsaasAnticipationListResponse {
  object?: 'list' | string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: AsaasAnticipation[];
}

export interface AsaasAnticipationLimitsInfo {
  total: number;
  available: number;
}

export interface AsaasAnticipationLimits {
  creditCard?: AsaasAnticipationLimitsInfo | null;
  bankSlip?: AsaasAnticipationLimitsInfo | null;
}

export interface AsaasAnticipationConfiguration {
  creditCardAutomaticEnabled: boolean;
}

// ==================== MY ACCOUNT (KYC) ====================

export type MyAccountDocumentGroupStatus = 'NOT_SENT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'IGNORED';

export type MyAccountDocumentType =
  | 'ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT'
  | 'CUSTOM'
  | 'EMANCIPATION_OF_MINORS'
  | 'ENTREPRENEUR_REQUIREMENT'
  | 'IDENTIFICATION_SELFIE'
  | 'IDENTIFICATION'
  | 'INVOICE'
  | 'MEI_CERTIFICATE'
  | 'MINUTES_OF_CONSTITUTION'
  | 'MINUTES_OF_ELECTION'
  | 'POWER_OF_ATTORNEY'
  | 'SOCIAL_CONTRACT';

export interface AsaasMyAccountDocumentItem {
  id: string;
  status?: MyAccountDocumentGroupStatus | string;
  type?: MyAccountDocumentType | string;
}

export type AsaasAccountDocumentResponsibleType =
  | 'ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT'
  | 'ASAAS_ACCOUNT_OWNER_EMANCIPATION_AGE'
  | 'ASAAS_ACCOUNT_OWNER'
  | 'ASSOCIATION'
  | 'BANK_ACCOUNT_OWNER_EMANCIPATION_AGE'
  | 'BANK_ACCOUNT_OWNER'
  | 'CUSTOM'
  | 'DIRECTOR'
  | 'INDIVIDUAL_COMPANY'
  | 'LIMITED_COMPANY'
  | 'MEI'
  | 'PARTNER'
  | 'POWER_OF_ATTORNEY';

export interface AsaasAccountDocumentResponsible {
  name?: string;
  // Docs dizem array, mas sandbox pode retornar string — aceitar ambos
  type?: AsaasAccountDocumentResponsibleType | AsaasAccountDocumentResponsibleType[] | string | string[];
}

export interface AsaasMyAccountDocumentGroup {
  id: string;
  status: MyAccountDocumentGroupStatus | string;
  type?: string;
  title?: string;
  description?: string;
  responsible?: AsaasAccountDocumentResponsible;
  onboardingUrl?: string;
  onboardingUrlExpirationDate?: string;
  documents?: AsaasMyAccountDocumentItem[];
}

export interface AsaasMyAccountDocumentsResponse {
  object?: string;
  data: AsaasMyAccountDocumentGroup[];
  // Docs Asaas declaram string, mas runtime pode ser null — tratar defensivamente
  rejectReasons?: string | string[] | null;
}

export type MyAccountKycAreaStatus =
  | 'APPROVED'
  | 'AWAITING_APPROVAL'
  | 'PENDING'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXPIRING_SOON'
  | string;

export interface AsaasMyAccountStatus {
  id?: string;
  commercialInfo?: MyAccountKycAreaStatus;
  commercialInfoExpiration?: {
    isExpired?: boolean;
    scheduledDate?: string | null;
  } | null;
  bankAccountInfo?: MyAccountKycAreaStatus;
  documentation?: MyAccountKycAreaStatus;
  general?: MyAccountKycAreaStatus;
}

export interface AsaasMyAccount {
  id?: string;
  name?: string;
  email?: string;
  cpfCnpj?: string;
  [key: string]: unknown;
}

export type MyAccountPersonType = 'FISICA' | 'JURIDICA' | string;

export interface AsaasMyAccountCommercialInfo {
  status?: MyAccountKycAreaStatus;
  personType?: MyAccountPersonType;
  cpfCnpj?: string;
  name?: string;
  birthDate?: string;
  companyName?: string;
  companyType?: string;
  incomeValue?: number;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  city?: string;
  site?: string;
  tradingName?: string;
  availableCompanyNames?: string[];
  commercialInfoExpiration?: {
    isExpired?: boolean;
    scheduledDate?: string;
  };
}

export interface UpdateMyAccountCommercialInfoInput {
  personType: 'FISICA' | 'JURIDICA';
  cpfCnpj: string;
  name: string;
  birthDate?: string;
  companyName?: string;
  companyType?: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION' | string;
  incomeValue: number;
  email: string;
  phone?: string;
  mobilePhone: string;
  postalCode: string;
  address: string;
  addressNumber: string;
  complement?: string;
  province: string;
  site?: string;
}

export interface UploadMyAccountDocumentResponse {
  object?: string;
  id?: string;
  status?: string;
  [key: string]: unknown;
}

// ==================== CUSTOMER ====================

export interface AsaasCustomer {
  object: 'customer';
  id: string;
  dateCreated: string;
  name: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  cpfCnpj: string;
  personType: 'FISICA' | 'JURIDICA';
  deleted: boolean;
  externalReference?: string;
  notificationDisabled: boolean;
}

export interface CreateCustomerInput {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
}

// ==================== PAYMENT ====================

export type PaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'REFUND_IN_PROGRESS'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'
  | 'DELETED';

export interface AsaasPaymentStatusResponse {
  status: PaymentStatus;
}

export interface AsaasPayment {
  object: 'payment';
  id: string;
  dateCreated: string;
  customer: string;
  subscription?: string;
  installment?: string;
  value: number;
  netValue: number;
  originalValue?: number;
  interestValue?: number;
  description?: string;
  billingType: BillingType;
  status: PaymentStatus;
  dueDate: string;
  originalDueDate: string;
  paymentDate?: string;
  confirmedDate?: string;
  clientPaymentDate?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  invoiceNumber?: string;
  transactionReceiptUrl?: string;
  externalReference?: string;
  deleted: boolean;
  /** Data em que o crédito ficou disponível */
  creditDate?: string;
  /** Data estimada em que o crédito ficará disponível */
  estimatedCreditDate?: string;

  creditCard?: {
    creditCardNumber?: string;
    creditCardBrand?: string;
  };
}

export interface AsaasCreditCard {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface AsaasCreditCardHolderInfo {
  name: string;
  email?: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone?: string;
}

export interface CreatePaymentInput {
  customer: string;
  /** Valor da cobrança */
  value: number;
  dueDate: string;
  billingType: BillingType;
  description?: string;
  externalReference?: string;
  creditCard?: AsaasCreditCard;
  creditCardHolderInfo?: AsaasCreditCardHolderInfo;
  creditCardToken?: string;
  remoteIp?: string;
  installmentCount?: number;
  /** Valor de cada parcela (para parcelamentos) */
  installmentValue?: number;
  /** Valor total do parcelamento (alternativa a installmentValue) */
  totalValue?: number;
  discount?: {
    value?: number;
    dueDateLimitDays?: number;
    type?: 'FIXED' | 'PERCENTAGE';
  };
  interest?: {
    value: number;
  };
  fine?: {
    value: number;
    type?: 'FIXED' | 'PERCENTAGE';
  };
  postalService?: boolean;
  split?: Array<{
    walletId: string;
    fixedValue?: number;
    percentualValue?: number;
  }>;
}

// ==================== SUBSCRIPTION ====================

export type SubscriptionStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED';

export interface AsaasSubscription {
  object: 'subscription';
  id: string;
  dateCreated: string;
  customer: string;
  value: number;
  netValue: number;
  billingType: BillingType;
  cycle: Cycle;
  description?: string;
  status: SubscriptionStatus;
  nextDueDate: string;
  endDate?: string;
  externalReference?: string;
  deleted: boolean;
}

export interface CreateSubscriptionInput {
  customer: string;
  value: number;
  nextDueDate: string;
  billingType: BillingType;
  cycle: Cycle;
  description?: string;
  endDate?: string;
  externalReference?: string;
  updatePendingPayments?: boolean;
  discount?: {
    value?: number;
    dueDateLimitDays?: number;
    type?: 'FIXED' | 'PERCENTAGE';
  };
  interest?: {
    value: number;
  };
  fine?: {
    value: number;
    type?: 'FIXED' | 'PERCENTAGE';
  };
}

export interface UpdateSubscriptionInput extends Partial<CreateSubscriptionInput> {
  status?: 'ACTIVE' | 'INACTIVE';
}

// ==================== INSTALLMENTS ====================

export interface CreateInstallmentInput {
  installmentCount: number;
  customer: string;
  value: number;
  totalValue?: number;
  billingType: BillingType;
  dueDate: string; // YYYY-MM-DD
  description?: string;
  // Campo para setar externalReference nos payments gerados pelo carnê.
  // (O objeto Installment do Asaas não expõe externalReference no spec.)
  paymentExternalReference?: string;
  postalService?: boolean;
  discount?: {
    value?: number;
    dueDateLimitDays?: number;
    type?: 'FIXED' | 'PERCENTAGE';
  };
  interest?: {
    value: number;
  };
  fine?: {
    value: number;
    type?: 'FIXED' | 'PERCENTAGE';
  };
}

export interface AsaasInstallment {
  object: 'installment';
  id: string;
  installmentCount: number;
  billingType: BillingType | string;
  deleted: boolean;
  customer?: string;
  description?: string;
  dateCreated?: string;
  paymentValue?: number;
  value?: number;
}

// ==================== PIX ====================

export interface PixQrCodeResponse {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

export interface DecodePixQrCodeInput {
  payload: string;
  changeValue?: number;
  expectedPaymentDate?: string;
}

export interface AsaasDecodedPixQrCode {
  payload: string;
  type: 'STATIC' | 'DYNAMIC' | 'DYNAMIC_WITH_ASAAS_ADDRESS_KEY' | 'COMPOSITE' | string;
  transactionOriginType:
    | 'MANUAL'
    | 'ADDRESS_KEY'
    | 'STATIC_QRCODE'
    | 'DYNAMIC_QRCODE'
    | 'PAYMENT_INITIATION_SERVICE'
    | 'AUTOMATIC_RECURRING'
    | string;
  pixKey?: string | null;
  conciliationIdentifier?: string | null;
  dueDate?: string | null;
  expirationDate?: string | null;
  finality?: 'WITHDRAWAL' | 'CHANGE' | string;
  value: number;
  changeValue?: number | null;
  interest?: number | null;
  fine?: number | null;
  discount?: number | null;
  totalValue?: number | null;
  canBePaidWithDifferentValue?: boolean;
  canBeModifyChangeValue?: boolean;
  receiver?: {
    ispb?: string | null;
    ispbName?: string | null;
    name?: string | null;
    tradingName?: string | null;
    cpfCnpj?: string | null;
    personType?: 'JURIDICA' | 'FISICA' | string;
    accountType?: 'CHECKING_ACCOUNT' | 'SALARY_ACCOUNT' | 'INVESTIMENT_ACCOUNT' | 'PAYMENT_ACCOUNT' | string;
  };
  payer?: {
    name?: string | null;
    cpfCnpj?: string | null;
  };
  description?: string | null;
  canBePaid: boolean;
  cannotBePaidReason?: string | null;
}

export interface PayPixQrCodeInput {
  qrCode: {
    payload: string;
    changeValue?: number;
  };
  value: number;
  description?: string;
  scheduleDate?: string;
}

export interface AsaasPixTransaction {
  id: string;
  endToEndIdentifier?: string | null;
  finality?: 'WITHDRAWAL' | 'CHANGE' | string;
  value: number;
  changeValue?: number | null;
  refundedValue?: number;
  effectiveDate?: string | null;
  scheduledDate?: string | null;
  status:
    | 'AWAITING_BALANCE_VALIDATION'
    | 'AWAITING_INSTANT_PAYMENT_ACCOUNT_BALANCE'
    | 'AWAITING_CRITICAL_ACTION_AUTHORIZATION'
    | 'AWAITING_CHECKOUT_RISK_ANALYSIS_REQUEST'
    | 'AWAITING_CASH_IN_RISK_ANALYSIS_REQUEST'
    | 'SCHEDULED'
    | 'AWAITING_REQUEST'
    | 'REQUESTED'
    | 'DONE'
    | 'REFUSED'
    | 'CANCELLED'
    | string;
  type: 'DEBIT' | 'CREDIT' | 'CREDIT_REFUND' | 'DEBIT_REFUND' | 'DEBIT_REFUND_CANCELLATION' | string;
  originType:
    | 'MANUAL'
    | 'ADDRESS_KEY'
    | 'STATIC_QRCODE'
    | 'DYNAMIC_QRCODE'
    | 'PAYMENT_INITIATION_SERVICE'
    | 'AUTOMATIC_RECURRING'
    | string;
  conciliationIdentifier?: string | null;
  description?: string | null;
  transactionReceiptUrl?: string | null;
  refusalReason?: string | null;
  canBeCanceled?: boolean;
  payment?: string | null;
  canBeRefunded?: boolean;
  refundDisabledReason?: string | null;
  chargedFeeValue?: number | null;
  dateCreated?: string | null;
  addressKey?: string | null;
  addressKeyType?: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP' | string;
  transferId?: string | null;
  externalReference?: string | null;
  externalAccount?: {
    ispb?: string | null;
    ispbName?: string | null;
    name?: string | null;
    cpfCnpj?: string | null;
    addressKey?: string | null;
    addressKeyType?: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP' | string;
  };
  qrCode?: {
    conciliationIdentifier?: string | null;
    originalValue?: number | null;
    dueDate?: string | null;
    interest?: number | null;
    fine?: number | null;
    discount?: number | null;
    expirationDate?: string | null;
    description?: string | null;
    payer?: {
      name?: string | null;
      cpfCnpj?: string | null;
    };
  };
}

// ==================== TRANSFER ====================

export interface CreatePixTransferInput {
  value: number;
  pixAddressKey: string;
  pixAddressKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
  description?: string;
  scheduleDate?: string;
  externalReference?: string;
}

export interface CreateBankTransferInput {
  value: number;
  bankAccount: {
    bank: {
      code: string;
    };
    accountName?: string;
    ownerName: string;
    ownerBirthDate?: string;
    cpfCnpj: string;
    agency: string;
    account: string;
    accountDigit: string;
    bankAccountType?: 'CONTA_CORRENTE' | 'CONTA_POUPANCA';
    ispb?: string;
  };
  operationType?: 'PIX' | 'TED' | 'INTERNAL';
  description?: string;
  scheduleDate?: string;
  externalReference?: string;
}

export interface AsaasTransferBankAccount {
  bank?: {
    ispb?: string | null;
    code?: string | null;
    name?: string | null;
  };
  accountName?: string | null;
  ownerName?: string | null;
  cpfCnpj?: string | null;
  agency?: string | null;
  agencyDigit?: string | null;
  account?: string | null;
  accountDigit?: string | null;
  pixAddressKey?: string | null;
}

export interface AsaasTransferInternalAccount {
  name?: string | null;
  cpfCnpj?: string | null;
}

export interface AsaasTransfer {
  object: 'transfer';
  id: string;
  dateCreated: string;
  value: number;
  netValue: number;
  // Statuses oficiais Asaas: https://docs.asaas.com/reference
  // BLOCKED = não existe no Asaas; internamente representa PENDING com authorized:false
  status: 'PENDING' | 'BLOCKED' | 'BANK_PROCESSING' | 'DONE' | 'CANCELLED' | 'FAILED';
  transferFee?: number;
  effectiveDate?: string;
  scheduleDate?: string;
  endToEndIdentifier?: string;
  transactionReceiptUrl?: string;
  operationType: 'PIX' | 'TED' | 'INTERNAL' | string;
  type?: 'PIX' | 'TED' | 'INTERNAL' | 'BANK_ACCOUNT' | 'ASAAS_ACCOUNT' | string;
  // authorized: false = aguardando autorizacao via SMS Token (PENDING + não autorizado)
  authorized?: boolean;
  failReason?: string | null;
  externalReference?: string;
  description?: string;
  recurring?: string | null;
  walletId?: string | null;
  // canBeCancelled: campo oficial retornado pelo GET /v3/transfers/{id}
  canBeCancelled?: boolean;
  bankAccount?: AsaasTransferBankAccount;
  account?: AsaasTransferInternalAccount;
}

export interface AsaasMyAccountFees {
  transfer?: {
    monthlyTransfersWithoutFee?: number;
    ted?: {
      feeValue?: number;
      consideredInMonthlyTransfersWithoutFee?: boolean;
    };
    pix?: {
      feeValue?: number;
      discountValue?: number | null;
      expirationDate?: string | null;
      consideredInMonthlyTransfersWithoutFee?: boolean;
    };
  };
}

// ==================== SUBACCOUNT ====================

export type AsaasCompanyType = 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';
export type AsaasWebhookSendType = 'NON_SEQUENTIALLY' | 'SEQUENTIALLY';

export type AsaasWebhookEventType =
  | 'PAYMENT_AUTHORIZED'
  | 'PAYMENT_AWAITING_RISK_ANALYSIS'
  | 'PAYMENT_APPROVED_BY_RISK_ANALYSIS'
  | 'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
  | 'PAYMENT_CREATED'
  | 'PAYMENT_UPDATED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_ANTICIPATED'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_DELETED'
  | 'PAYMENT_RESTORED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_REFUND_IN_PROGRESS'
  | 'PAYMENT_REFUND_DENIED'
  | 'PAYMENT_RECEIVED_IN_CASH_UNDONE'
  | 'PAYMENT_CHARGEBACK_REQUESTED'
  | 'PAYMENT_CHARGEBACK_DISPUTE'
  | 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
  | 'PAYMENT_DUNNING_RECEIVED'
  | 'PAYMENT_DUNNING_REQUESTED'
  | 'PAYMENT_BANK_SLIP_VIEWED'
  | 'PAYMENT_CHECKOUT_VIEWED'
  | 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
  | 'PAYMENT_PARTIALLY_REFUNDED'
  | 'PAYMENT_SPLIT_CANCELLED'
  | 'PAYMENT_SPLIT_DIVERGENCE_BLOCK'
  | 'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED'
  | 'INVOICE_CREATED'
  | 'INVOICE_UPDATED'
  | 'INVOICE_SYNCHRONIZED'
  | 'INVOICE_AUTHORIZED'
  | 'INVOICE_PROCESSING_CANCELLATION'
  | 'INVOICE_CANCELED'
  | 'INVOICE_CANCELLATION_DENIED'
  | 'INVOICE_ERROR'
  | 'TRANSFER_CREATED'
  | 'TRANSFER_PENDING'
  | 'TRANSFER_IN_BANK_PROCESSING'
  | 'TRANSFER_BLOCKED'
  | 'TRANSFER_DONE'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_CANCELLED'
  | 'SUBSCRIPTION_CREATED'
  | 'SUBSCRIPTION_UPDATED'
  | 'SUBSCRIPTION_INACTIVATED'
  | 'SUBSCRIPTION_DELETED'
  | 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED'
  | 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED'
  | 'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING'
  | 'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL'
  | 'ACCOUNT_STATUS_DOCUMENT_APPROVED'
  | 'ACCOUNT_STATUS_DOCUMENT_REJECTED'
  | 'ACCOUNT_STATUS_DOCUMENT_PENDING'
  | 'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL'
  | 'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED'
  | 'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED'
  | 'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING'
  | 'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL'
  | 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON'
  | 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED'
  | 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED'
  | 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED'
  | 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING'
  | 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL'
  | string;

export interface AsaasWebhookConfigInput {
  name?: string;
  url: string;
  email: string;
  enabled?: boolean;
  interrupted?: boolean;
  apiVersion?: number;
  authToken?: string;
  sendType?: AsaasWebhookSendType;
  events?: (AsaasWebhookEventType | string)[];
}

export interface CreateSubaccountInput {
  // Campos obrigatórios
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone: string;
  incomeValue: number;
  address: string;
  addressNumber: string;
  province: string;
  postalCode: string;

  // Campos opcionais/condicionais
  loginEmail?: string;
  birthDate?: string;     // YYYY-MM-DD (somente PF)
  companyType?: AsaasCompanyType; // somente PJ
  phone?: string;
  site?: string;
  complement?: string;
  externalReference?: string;
  webhooks?: AsaasWebhookConfigInput[];
}

export interface AsaasSubaccount {
  object: 'account';
  id: string;
  name: string;
  email: string;
  cpfCnpj: string;
  apiKey?: string | null;
  walletId?: string | null;
}

export interface AsaasErrorResponse {
  errors: Array<{ code?: string; description?: string }>;
}

// ==================== WEBHOOK ====================

export interface AsaasWebhookPayload {
  id?: string;
  event: string;
  dateCreated?: string;
  account?: {
    id?: string;
    ownerId?: string | null;
  };
  additionalInfo?: {
    scheduledDate?: string;
    [key: string]: unknown;
  };
  payment?: AsaasPayment;
  subscription?: AsaasSubscription;
  transfer?: AsaasTransfer;
  internalTransfer?: {
    id: string;
    value?: number;
    netValue?: number;
    description?: string | null;
    dateCreated?: string | null;
    status?: string;
  };
  [key: string]: unknown;
}
