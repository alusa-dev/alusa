/**
 * Tipos oficiais da API Asaas
 *
 * Baseado em: https://docs.asaas.com/reference
 */
export type BillingType = 'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'UNDEFINED';
export type Cycle = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
export type AsaasInvoiceStatus = 'SCHEDULED' | 'AUTHORIZED' | 'PROCESSING_CANCELLATION' | 'CANCELED' | 'CANCELLATION_DENIED' | 'ERROR' | string;
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
    effectiveDate: string;
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
export interface AsaasFinanceBalance {
    balance: number;
}
export type AsaasFinancialTransactionType = 'PAYMENT_RECEIVED' | 'TRANSFER' | 'TRANSFER_FEE' | 'TRANSFER_REVERSAL' | 'REVERSAL' | 'PAYMENT_REVERSAL' | 'PAYMENT_REFUND_CANCELLED' | 'PAYMENT_FEE' | 'PAYMENT_FEE_REVERSAL' | 'PAYMENT_CUSTODY_BLOCK' | 'PAYMENT_CUSTODY_BLOCK_REVERSAL' | 'PHONE_CALL_NOTIFICATION_FEE' | 'PROMOTIONAL_CODE_CREDIT' | 'DEBIT' | 'DEBIT_REVERSAL' | 'BILL_PAYMENT' | 'BILL_PAYMENT_FEE' | 'BILL_PAYMENT_CANCELLED' | 'BILL_PAYMENT_FEE_CANCELLED' | 'BILL_PAYMENT_REFUNDED' | 'INTERNAL_TRANSFER_DEBIT' | 'INTERNAL_TRANSFER_CREDIT' | 'INTERNAL_TRANSFER_REVERSAL' | 'CREDIT' | 'PARTIAL_PAYMENT' | 'PIX_TRANSACTION_DEBIT' | 'PIX_TRANSACTION_CREDIT' | string;
export interface AsaasFinancialTransaction {
    object: 'financialTransaction';
    id: string;
    value: number;
    balance: number;
    type: AsaasFinancialTransactionType;
    date: string;
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
export type MyAccountDocumentGroupStatus = 'NOT_SENT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'IGNORED';
export type MyAccountDocumentType = 'ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT' | 'CUSTOM' | 'EMANCIPATION_OF_MINORS' | 'ENTREPRENEUR_REQUIREMENT' | 'IDENTIFICATION_SELFIE' | 'IDENTIFICATION' | 'INVOICE' | 'MEI_CERTIFICATE' | 'MINUTES_OF_CONSTITUTION' | 'MINUTES_OF_ELECTION' | 'POWER_OF_ATTORNEY' | 'SOCIAL_CONTRACT';
export interface AsaasMyAccountDocumentItem {
    id: string;
    status?: MyAccountDocumentGroupStatus | string;
    type?: MyAccountDocumentType | string;
}
export type AsaasAccountDocumentResponsibleType = 'ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT' | 'ASAAS_ACCOUNT_OWNER_EMANCIPATION_AGE' | 'ASAAS_ACCOUNT_OWNER' | 'ASSOCIATION' | 'BANK_ACCOUNT_OWNER_EMANCIPATION_AGE' | 'BANK_ACCOUNT_OWNER' | 'CUSTOM' | 'DIRECTOR' | 'INDIVIDUAL_COMPANY' | 'LIMITED_COMPANY' | 'MEI' | 'PARTNER' | 'POWER_OF_ATTORNEY';
export interface AsaasAccountDocumentResponsible {
    name?: string;
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
    rejectReasons?: string | string[] | null;
}
export type MyAccountKycAreaStatus = 'APPROVED' | 'AWAITING_APPROVAL' | 'PENDING' | 'REJECTED' | 'EXPIRED' | 'EXPIRING_SOON' | string;
export interface AsaasMyAccountStatus {
    id?: string;
    commercialInfo?: MyAccountKycAreaStatus;
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
export type PaymentStatus = 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'OVERDUE' | 'REFUNDED' | 'REFUND_IN_PROGRESS' | 'RECEIVED_IN_CASH' | 'REFUND_REQUESTED' | 'CHARGEBACK_REQUESTED' | 'CHARGEBACK_DISPUTE' | 'AWAITING_CHARGEBACK_REVERSAL' | 'DUNNING_REQUESTED' | 'DUNNING_RECEIVED' | 'AWAITING_RISK_ANALYSIS' | 'DELETED';
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
    installmentValue?: number;
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
export interface CreateInstallmentInput {
    installmentCount: number;
    customer: string;
    value: number;
    totalValue?: number;
    billingType: BillingType;
    dueDate: string;
    description?: string;
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
export interface PixQrCodeResponse {
    encodedImage: string;
    payload: string;
    expirationDate: string;
}
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
    status: 'PENDING' | 'BANK_PROCESSING' | 'DONE' | 'CANCELLED' | 'FAILED';
    transferFee?: number;
    effectiveDate?: string;
    scheduleDate?: string;
    endToEndIdentifier?: string;
    transactionReceiptUrl?: string;
    operationType: 'PIX' | 'TED' | 'INTERNAL' | string;
    type?: 'PIX' | 'TED' | 'INTERNAL' | 'BANK_ACCOUNT' | 'ASAAS_ACCOUNT' | string;
    authorized?: boolean;
    failReason?: string;
    externalReference?: string;
    description?: string;
    recurring?: string | null;
    walletId?: string | null;
    bankAccount?: AsaasTransferBankAccount;
    account?: AsaasTransferInternalAccount;
}
export type AsaasCompanyType = 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';
export type AsaasWebhookSendType = 'NON_SEQUENTIALLY' | 'SEQUENTIALLY';
export type AsaasWebhookEventType = 'PAYMENT_AUTHORIZED' | 'PAYMENT_AWAITING_RISK_ANALYSIS' | 'PAYMENT_APPROVED_BY_RISK_ANALYSIS' | 'PAYMENT_REPROVED_BY_RISK_ANALYSIS' | 'PAYMENT_CREATED' | 'PAYMENT_UPDATED' | 'PAYMENT_CONFIRMED' | 'PAYMENT_RECEIVED' | 'PAYMENT_ANTICIPATED' | 'PAYMENT_OVERDUE' | 'PAYMENT_DELETED' | 'PAYMENT_RESTORED' | 'PAYMENT_REFUNDED' | 'PAYMENT_REFUND_IN_PROGRESS' | 'PAYMENT_REFUND_DENIED' | 'PAYMENT_RECEIVED_IN_CASH_UNDONE' | 'PAYMENT_CHARGEBACK_REQUESTED' | 'PAYMENT_CHARGEBACK_DISPUTE' | 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL' | 'PAYMENT_DUNNING_RECEIVED' | 'PAYMENT_DUNNING_REQUESTED' | 'PAYMENT_BANK_SLIP_VIEWED' | 'PAYMENT_CHECKOUT_VIEWED' | 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED' | 'PAYMENT_PARTIALLY_REFUNDED' | 'PAYMENT_SPLIT_CANCELLED' | 'PAYMENT_SPLIT_DIVERGENCE_BLOCK' | 'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED' | 'INVOICE_CREATED' | 'INVOICE_UPDATED' | 'INVOICE_SYNCHRONIZED' | 'INVOICE_AUTHORIZED' | 'INVOICE_PROCESSING_CANCELLATION' | 'INVOICE_CANCELED' | 'INVOICE_CANCELLATION_DENIED' | 'INVOICE_ERROR' | 'TRANSFER_CREATED' | 'TRANSFER_PENDING' | 'TRANSFER_IN_BANK_PROCESSING' | 'TRANSFER_BLOCKED' | 'TRANSFER_DONE' | 'TRANSFER_FAILED' | 'TRANSFER_CANCELLED' | 'SUBSCRIPTION_CREATED' | 'SUBSCRIPTION_UPDATED' | 'SUBSCRIPTION_INACTIVATED' | 'SUBSCRIPTION_DELETED' | 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED' | 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED' | 'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING' | 'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL' | 'ACCOUNT_STATUS_DOCUMENT_APPROVED' | 'ACCOUNT_STATUS_DOCUMENT_REJECTED' | 'ACCOUNT_STATUS_DOCUMENT_PENDING' | 'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL' | 'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED' | 'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED' | 'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING' | 'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL' | 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON' | 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED' | 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED' | 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED' | 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING' | 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL' | string;
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
    name: string;
    email: string;
    cpfCnpj: string;
    mobilePhone: string;
    incomeValue: number;
    address: string;
    addressNumber: string;
    province: string;
    postalCode: string;
    loginEmail?: string;
    birthDate?: string;
    companyType?: AsaasCompanyType;
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
    apiKey: string;
    walletId: string;
}
export interface AsaasErrorResponse {
    errors: Array<{
        code?: string;
        description?: string;
    }>;
}
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
//# sourceMappingURL=asaas.d.ts.map