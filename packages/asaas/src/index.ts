/**
 * @alusa/asaas
 * 
 * Cliente HTTP puro para API do Asaas (ADRs 001-009)
 * 
 * Exports públicos explícitos (sem export *)
 */

// Client
export { AsaasHttp, AsaasHttpError } from './client/AsaasHttp';
export type { AsaasHttpConfig, AsaasHttpOptions } from './client/AsaasHttp';
export { createAsaasClient } from './client/AsaasClient';
export {
  AsaasBaseUrlError,
  getAsaasBaseUrlForApiKeyOrThrow,
  getAsaasBaseUrlFromEnvOrThrow,
  normalizeAndValidateAsaasBaseUrl,
  parseAsaasEnvironmentFromApiKey,
  parseAsaasEnvironmentFromEnv,
} from './client/asaasBaseUrl';
export type { AsaasEnvironment } from './client/asaasBaseUrl';

// Concurrency & Rate Limit
export { ConcurrencyLimiter, globalGetLimiter } from './client/concurrency-limiter';
export {
  extractRateLimitHeaders,
  RateLimitTracker,
  globalRateLimitTracker,
} from './client/rate-limit-tracker';
export type { RateLimitInfo } from './client/rate-limit-tracker';

// Circuit Breaker
export { CircuitBreaker, CircuitOpenError, globalCircuitBreaker } from './client/circuit-breaker';
export type { CircuitBreakerConfig, CircuitState } from './client/circuit-breaker';

// Quota Tracker
export { QuotaTracker, globalQuotaTracker } from './client/quota-tracker';
export type { QuotaStatus } from './client/quota-tracker';

// Hooks (observer pattern para consumers)
export { globalAsaasHooks } from './client/asaas-hooks';
export type {
  ApiCallHookPayload,
  CircuitOpenHookPayload,
  QuotaWarningHookPayload,
  RateLimitHitHookPayload,
} from './client/asaas-hooks';

// Types
export type {
  BillingType,
  Cycle,
  AsaasInvoice,
  AsaasInvoiceStatus,
  AsaasInvoiceTaxes,
  CreateInvoiceInput,
  PaymentStatus,
  SubscriptionStatus,
  MyAccountDocumentGroupStatus,
  MyAccountDocumentType,
  AsaasMyAccountDocumentItem,
  AsaasAccountDocumentResponsibleType,
  AsaasAccountDocumentResponsible,
  AsaasMyAccountDocumentGroup,
  AsaasMyAccountDocumentsResponse,
  MyAccountKycAreaStatus,
  AsaasMyAccountStatus,
  AsaasMyAccount,
  AsaasMyAccountCommercialInfo,
  UpdateMyAccountCommercialInfoInput,
  UploadMyAccountDocumentResponse,
  AsaasCustomer,
  CreateCustomerInput,
  AsaasPayment,
  AsaasPaymentStatusResponse,
  AsaasCreditCard,
  AsaasCreditCardHolderInfo,
  CreatePaymentInput,
  AsaasSubscription,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  PixQrCodeResponse,
  DecodePixQrCodeInput,
  AsaasDecodedPixQrCode,
  PayPixQrCodeInput,
  AsaasPixTransaction,
  CreatePixTransferInput,
  CreateBankTransferInput,
  AsaasTransfer,
  AsaasMyAccountFees,
  CreateSubaccountInput,
  AsaasSubaccount,
  AsaasCompanyType,
  AsaasWebhookSendType,
  AsaasWebhookConfigInput,
  AsaasErrorResponse,
  AsaasFinanceBalance,
  AsaasFinancialTransaction,
  AsaasFinancialTransactionType,
  AsaasAnticipation,
  AsaasAnticipationConfiguration,
  AsaasAnticipationLimits,
  AsaasAnticipationLimitsInfo,
  AsaasAnticipationListResponse,
  AsaasAnticipationSimulation,
  AsaasAnticipationStatus,
  AsaasWebhookEventType,
  AsaasWebhookPayload,
} from './types/asaas';

// Invoices (NFS-e)
export { createInvoice } from './invoices/createInvoice';
export type { CreateInvoiceParams } from './invoices/createInvoice';
export { getInvoice } from './invoices/getInvoice';
export type { GetInvoiceParams } from './invoices/getInvoice';
export { cancelInvoice } from './invoices/cancelInvoice';
export type { CancelInvoiceParams } from './invoices/cancelInvoice';

// MyAccount (KYC)
export {
  getMyAccountDocuments,
  uploadMyAccountDocument,
  updateMyAccountDocumentFile,
  deleteMyAccountDocumentFile,
  getMyAccountDocumentFile,
} from './myAccount/getMyAccountDocuments';
export type {
  GetMyAccountDocumentsParams,
  UploadMyAccountDocumentParams,
  UpdateMyAccountDocumentFileParams,
  DeleteMyAccountDocumentFileParams,
  GetMyAccountDocumentFileParams,
  MyAccountDocumentFileResponse,
} from './myAccount/getMyAccountDocuments';

export { getMyAccountStatus } from './myAccount/getMyAccountStatus';
export type { GetMyAccountStatusParams } from './myAccount/getMyAccountStatus';

export { getMyAccountFees } from './myAccount/getMyAccountFees';
export type { GetMyAccountFeesParams } from './myAccount/getMyAccountFees';

export { approveSandboxAccount } from './myAccount/approveSandboxAccount';
export type { ApproveSandboxAccountParams } from './myAccount/approveSandboxAccount';

export { getMyAccount } from './myAccount/getMyAccount';
export type { GetMyAccountParams } from './myAccount/getMyAccount';

export { getMyAccountCommercialInfo } from './myAccount/getMyAccountCommercialInfo';
export { updateMyAccountCommercialInfo } from './myAccount/getMyAccountCommercialInfo';
export type {
  GetMyAccountCommercialInfoParams,
  UpdateMyAccountCommercialInfoParams,
} from './myAccount/getMyAccountCommercialInfo';

export { deleteMyAccount } from './myAccount/deleteMyAccount';
export type { DeleteMyAccountParams, DeleteMyAccountResponse } from './myAccount/deleteMyAccount';

export { getWallets } from './myAccount/getWallets';
export type { GetWalletsParams, GetWalletsResponse, WalletItem } from './myAccount/getWallets';

// Accounts
export { createSubaccount } from './accounts/createSubaccount';
export type { CreateSubaccountParams } from './accounts/createSubaccount';
export { getSubaccount } from './accounts/getSubaccount';
export type { GetSubaccountParams, AsaasSubaccountDetails } from './accounts/getSubaccount';
export { updateSubaccount } from './accounts/updateSubaccount';
export type { UpdateSubaccountParams } from './accounts/updateSubaccount';
export { listSubaccounts, findSubaccountByCpfCnpj, findSubaccountByExternalReference } from './accounts/listSubaccounts';
export type { ListSubaccountsParams, ListSubaccountsResponse, AsaasSubaccountListItem } from './accounts/listSubaccounts';

export { createSubaccountAccessToken } from './accounts/createSubaccountAccessToken';
export type { CreateSubaccountAccessTokenParams, AsaasSubaccountAccessToken } from './accounts/createSubaccountAccessToken';
export { listSubaccountAccessTokens } from './accounts/listSubaccountAccessTokens';
export type { ListSubaccountAccessTokensParams, AsaasSubaccountAccessTokenItem, ListSubaccountAccessTokensResponse } from './accounts/listSubaccountAccessTokens';
export { deleteSubaccountAccessToken } from './accounts/deleteSubaccountAccessToken';
export type { DeleteSubaccountAccessTokenParams, DeleteSubaccountAccessTokenResponse } from './accounts/deleteSubaccountAccessToken';

// Customers
export { createCustomer } from './customers/createCustomer';
export type { CreateCustomerParams } from './customers/createCustomer';
export { getCustomer } from './customers/getCustomer';
export type { GetCustomerParams } from './customers/getCustomer';
export { listCustomers } from './customers/listCustomers';
export type { ListCustomersParams, AsaasListResponse } from './customers/listCustomers';
export { updateCustomer } from './customers/updateCustomer';
export type { UpdateCustomerParams } from './customers/updateCustomer';
export { deleteCustomer } from './customers/deleteCustomer';
export type { DeleteCustomerParams } from './customers/deleteCustomer';

export { restoreCustomer } from './customers/restoreCustomer';
export type { RestoreCustomerParams } from './customers/restoreCustomer';
// Payments
export { createPayment } from './payments/createPayment';
export type { CreatePaymentParams } from './payments/createPayment';
export { listPayments } from './payments/listPayments';
export type { ListPaymentsParams } from './payments/listPayments';
export { getPayment } from './payments/getPayment';
export type { GetPaymentParams } from './payments/getPayment';
export { getPaymentStatus } from './payments/getPaymentStatus';
export type { GetPaymentStatusParams } from './payments/getPaymentStatus';
export { updatePayment } from './payments/updatePayment';
export type { UpdatePaymentParams } from './payments/updatePayment';
export { deletePayment } from './payments/deletePayment';
export type { DeletePaymentParams } from './payments/deletePayment';
export { refundPayment } from './payments/refundPayment';
export type { RefundPaymentParams } from './payments/refundPayment';
export { getPixQrCode } from './payments/getPixQrCode';
export type { GetPixQrCodeParams } from './payments/getPixQrCode';
export { decodePixQrCode } from './pix/decodePixQrCode';
export type { DecodePixQrCodeParams } from './pix/decodePixQrCode';
export { payPixQrCode } from './pix/payPixQrCode';
export type { PayPixQrCodeParams } from './pix/payPixQrCode';
export { receiveInCash } from './payments/receiveInCash';
export type { ReceiveInCashParams, ReceiveInCashResponse } from './payments/receiveInCash';
export { undoReceivedInCash } from './payments/undoReceivedInCash';
export type { UndoReceivedInCashParams } from './payments/undoReceivedInCash';
export { getBillingInfo } from './payments/getBillingInfo';
export type { GetBillingInfoParams, BillingInfoResponse, BillingInfoPix, BillingInfoBankSlip, BillingInfoCreditCard } from './payments/getBillingInfo';
export { notifyPayment } from './payments/notifyPayment';
export type { NotifyPaymentParams, NotifyPaymentResponse, AsaasNotificationType } from './payments/notifyPayment';
export { payWithCreditCard } from './payments/payWithCreditCard';
export type { PayWithCreditCardParams, PayWithCreditCardInput } from './payments/payWithCreditCard';

// Credit Card
export { tokenizeCreditCard } from './creditCard/tokenizeCreditCard';
export type {
  TokenizeCreditCardParams,
  TokenizeCreditCardInput,
  TokenizeCreditCardResponse,
} from './creditCard/tokenizeCreditCard';

// Subscriptions
export { createSubscription } from './subscriptions/createSubscription';
export type { CreateSubscriptionParams } from './subscriptions/createSubscription';
export { getSubscription } from './subscriptions/getSubscription';
export type { GetSubscriptionParams } from './subscriptions/getSubscription';
export { updateSubscription } from './subscriptions/updateSubscription';
export type { UpdateSubscriptionParams } from './subscriptions/updateSubscription';
export { deleteSubscription } from './subscriptions/deleteSubscription';
export type { DeleteSubscriptionParams } from './subscriptions/deleteSubscription';
export { getSubscriptionPaymentBook } from './subscriptions/getSubscriptionPaymentBook';
export type { GetSubscriptionPaymentBookParams } from './subscriptions/getSubscriptionPaymentBook';
export { pauseSubscription } from './subscriptions/pauseSubscription';
export type { PauseSubscriptionParams } from './subscriptions/pauseSubscription';
export { activateSubscription } from './subscriptions/activateSubscription';
export type { ActivateSubscriptionParams } from './subscriptions/activateSubscription';
export { listSubscriptions } from './subscriptions/listSubscriptions';
export type { ListSubscriptionsParams } from './subscriptions/listSubscriptions';
export { listSubscriptionPayments } from './subscriptions/listSubscriptionPayments';
export type { ListSubscriptionPaymentsParams } from './subscriptions/listSubscriptionPayments';
export { updateSubscriptionCreditCard } from './subscriptions/updateSubscriptionCreditCard';
export type {
  UpdateSubscriptionCreditCardParams,
  UpdateSubscriptionCreditCardInput,
  UpdateSubscriptionCreditCardResponse,
} from './subscriptions/updateSubscriptionCreditCard';

// Installments
export { createInstallment } from './installments/createInstallment';
export type { CreateInstallmentParams } from './installments/createInstallment';
export { getInstallment } from './installments/getInstallment';
export type { GetInstallmentParams } from './installments/getInstallment';
export { deleteInstallmentPayments } from './installments/deleteInstallmentPayments';
export type {
  DeleteInstallmentPaymentsParams,
  DeleteInstallmentPaymentsResponse,
} from './installments/deleteInstallmentPayments';
export { getInstallmentPaymentBook } from './installments/getInstallmentPaymentBook';
export type { GetInstallmentPaymentBookParams } from './installments/getInstallmentPaymentBook';
export { listInstallmentPayments } from './installments/listInstallmentPayments';
export type { ListInstallmentPaymentsParams } from './installments/listInstallmentPayments';

// Transfers
export { createPixTransfer } from './transfers/createPixTransfer';
export type { CreatePixTransferParams } from './transfers/createPixTransfer';
export { createBankTransfer } from './transfers/createBankTransfer';
export type { CreateBankTransferParams } from './transfers/createBankTransfer';
export { listTransfers } from './transfers/listTransfers';
export type { ListTransfersParams } from './transfers/listTransfers';
export { getTransfer } from './transfers/getTransfer';
export type { GetTransferParams } from './transfers/getTransfer';
export { cancelTransfer } from './transfers/cancelTransfer';
export type { CancelTransferParams } from './transfers/cancelTransfer';

// Finance (Balance)
export { getBalance } from './finance/getBalance';
export type { GetBalanceParams } from './finance/getBalance';

// Financial Transactions
export { listFinancialTransactions } from './financialTransactions/listFinancialTransactions';
export type { ListFinancialTransactionsParams } from './financialTransactions/listFinancialTransactions';

// Anticipations
export {
  cancelAnticipation,
  getAnticipation,
  getAnticipationConfiguration,
  getAnticipationLimits,
  listAnticipations,
  requestAnticipation,
  simulateAnticipation,
  updateAnticipationConfiguration,
} from './anticipations/anticipations';
export type {
  CancelAnticipationParams,
  GetAnticipationParams,
  ListAnticipationsParams,
  RequestAnticipationParams,
  SimulateAnticipationParams,
  UpdateAnticipationConfigurationParams,
} from './anticipations/anticipations';

// Webhooks

export { createWebhook } from './webhooks/createWebhook';
export type { CreateWebhookParams } from './webhooks/createWebhook';

export { listWebhooks } from './webhooks/listWebhooks';
export type { ListWebhooksParams, AsaasWebhookConfig, AsaasWebhookListResponse } from './webhooks/listWebhooks';

export { updateWebhook } from './webhooks/updateWebhook';
export type { UpdateWebhookParams } from './webhooks/updateWebhook';

export { removeWebhookBackoff } from './webhooks/removeWebhookBackoff';
export type { RemoveWebhookBackoffParams, RemoveWebhookBackoffResponse } from './webhooks/removeWebhookBackoff';
