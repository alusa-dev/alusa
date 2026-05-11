import { registerAsaasHooksIntegration as initializeAsaasHooksIntegration } from './foundation/asaas-hooks-integration';

// ═══════════════════════════════════════════════════════════════════════════
// CORE - Definições fundamentais (Fase 0 refatoração)
// ═══════════════════════════════════════════════════════════════════════════
export * from './core';

// Customer Service
export { canInactivateCustomer, inactivateCustomerIfSafe } from './customer/asaas-customer.service';
export type {
  CustomerInactivationResult,
  SafeInactivationResult,
} from './customer/asaas-customer.service';

// ─────────────────────────────────────────────────────────────────────────────
// Audit Actions (constantes padronizadas)
// ─────────────────────────────────────────────────────────────────────────────
export { AUDIT_ACTIONS, type AuditAction } from './foundation/audit-actions';
export {
  ASAAS_READ_INTENTS,
  getAsaasReadIntentStats,
  recordAsaasReadIntent,
  resetAsaasReadIntentStats,
  type AsaasReadIntent,
  type AsaasReadIntentStats,
} from './foundation/asaas-read-intent';

// ─────────────────────────────────────────────────────────────────────────────
// Charge Status Mapper (FONTE ÚNICA DE VERDADE)
// Use estas funções para mapear status Asaas → interno
// ─────────────────────────────────────────────────────────────────────────────
export {
  mapAsaasPaymentStatusToCobranca,
  mapAsaasPaymentStatusToCharge,
  ASAAS_TO_COBRANCA_MAP,
  ASAAS_TO_CHARGE_MAP,
  getUnifiedBadgeStatus,
  isTerminalCobrancaStatus,
  isTerminalChargeStatus,
  TERMINAL_COBRANCA_STATUSES,
  TERMINAL_CHARGE_STATUSES,
} from './mappers/charge-status';
export {
  getCobrancaStatusBadge as getCobrancaBadgeConfig,
  getChargeStatusBadge as getChargeBadgeConfig,
} from './mappers/charge-status';
export type {
  BadgeStatusType,
  StatusBadgeConfig as ChargeBadgeConfig,
} from './mappers/charge-status';

// Legacy mappers (manter compatibilidade - preferir charge-status)
export { mapAsaasStatusToInternal, getStatusBadgeConfig } from './mappers/status-mapper';

export {
  mapRequestWithdrawDTOToInput,
  mapRequestWithdrawOutputToDTO,
  mapTransferDetailOutputToDTO,
  mapTransferToListItemDTO,
  mapListTransfersOutputToDTO,
  mapListTransfersQueryToInput,
} from './mappers/transfers.mapper';
export {
  mapCreateSubscriptionDTOToInput,
  mapCreateSubscriptionOutputToDTO,
  mapSubscriptionToListItemDTO,
  mapListSubscriptionsOutputToDTO,
  mapListSubscriptionsQueryToInput,
} from './mappers/subscriptions.mapper';

export {
  mapCreateInstallmentPlanDTOToInput,
  mapCreateInstallmentPlanOutputToDTO,
  mapInstallmentPlanToListItemDTO,
  mapListInstallmentPlansOutputToDTO,
  mapListInstallmentPlansQueryToInput,
} from './mappers/installments.mapper';

export {
  mapCreateStandaloneInstallmentDTOToInput,
  mapCreateStandaloneInstallmentOutputToDTO,
} from './mappers/standalone-installments.mapper';

export {
  mapCreateInvoiceDTOToInput,
  mapCreateInvoiceOutputToDTO,
  mapInvoiceToListItemDTO,
  mapListInvoicesOutputToDTO,
  mapListInvoicesQueryToInput,
} from './mappers/invoices.mapper';

// DTOs – transfers
export {
  requestWithdrawDTOSchema,
  type RequestWithdrawDTO,
} from './dtos/transfers/request-withdraw.dto';
export {
  requestWithdrawResultDTOSchema,
  type RequestWithdrawResultDTO,
  type TransferStatusDTO,
} from './dtos/transfers/request-withdraw-result.dto';
export {
  listTransfersQueryDTOSchema,
  type ListTransfersQueryDTO,
  type ListTransfersQueryParsed,
} from './dtos/transfers/list-transfers-query.dto';
export {
  listTransfersResultDTOSchema,
  type ListTransfersResultDTO,
  type TransferListItemDTO,
} from './dtos/transfers/list-transfers-result.dto';
export {
  transferDetailResultDTOSchema,
  transferDetailRecipientDTOSchema,
  type TransferDetailResultDTO,
  type TransferDetailRecipientDTO,
} from './dtos/transfers/get-transfer-detail-result.dto';

// DTOs – subscriptions
export {
  createSubscriptionDTOSchema,
  type CreateSubscriptionDTO,
} from './dtos/subscriptions/create-subscription.dto';
export {
  createSubscriptionResultDTOSchema,
  subscriptionStatusSchema,
  type CreateSubscriptionResultDTO,
  type SubscriptionStatusDTO,
} from './dtos/subscriptions/create-subscription-result.dto';
export {
  listSubscriptionsQueryDTOSchema,
  type ListSubscriptionsQueryDTO,
  type ListSubscriptionsQueryParsed,
} from './dtos/subscriptions/list-subscriptions-query.dto';
export {
  listSubscriptionsResultDTOSchema,
  subscriptionListItemDTOSchema,
  type ListSubscriptionsResultDTO,
  type SubscriptionListItemDTO,
} from './dtos/subscriptions/list-subscriptions-result.dto';

// DTOs – installments
export {
  createInstallmentPlanDTOSchema,
  type CreateInstallmentPlanDTO,
} from './dtos/installments/create-installment-plan.dto';
export {
  createStandaloneInstallmentDTOSchema,
  type CreateStandaloneInstallmentDTO,
} from './dtos/installments/create-standalone-installment.dto';
export {
  createInstallmentPlanResultDTOSchema,
  installmentStatusSchema,
  type CreateInstallmentPlanResultDTO,
  type InstallmentStatusDTO,
} from './dtos/installments/create-installment-plan-result.dto';
export {
  listInstallmentPlansQueryDTOSchema,
  type ListInstallmentPlansQueryDTO,
  type ListInstallmentPlansQueryParsed,
} from './dtos/installments/list-installment-plans-query.dto';
export {
  listInstallmentPlansResultDTOSchema,
  installmentPlanListItemDTOSchema,
  type ListInstallmentPlansResultDTO,
  type InstallmentPlanListItemDTO,
} from './dtos/installments/list-installment-plans-result.dto';

// DTOs – invoices
export { createInvoiceDTOSchema, type CreateInvoiceDTO } from './dtos/invoices/create-invoice.dto';
export {
  createInvoiceResultDTOSchema,
  invoiceStatusSchema,
  type CreateInvoiceResultDTO,
  type InvoiceStatusDTO,
} from './dtos/invoices/create-invoice-result.dto';
export {
  listInvoicesQueryDTOSchema,
  type ListInvoicesQueryDTO,
  type ListInvoicesQueryParsed,
} from './dtos/invoices/list-invoices-query.dto';
export {
  listInvoicesResultDTOSchema,
  invoiceListItemDTOSchema,
  type ListInvoicesResultDTO,
  type InvoiceListItemDTO,
} from './dtos/invoices/list-invoices-result.dto';

// Use Cases
export { createAsaasCustomer } from './use-cases/create-customer';
export type { CreateCustomerInput } from './use-cases/create-customer';

// Errors
export { MissingBirthDateError } from './errors/missing-birth-date-error';
export { MissingCompanyTypeError } from './errors/missing-company-type-error';
export { AsaasSandboxSubaccountDailyLimitError } from './errors/asaas-sandbox-subaccount-daily-limit-error';

export { createAsaasPayment } from './use-cases/create-payment';
export type { CreatePaymentInput } from './use-cases/create-payment';
export { getPaymentStatus } from './use-cases/asaas-ops';
export {
  getPaymentCommandPreflightStats,
  readPaymentFullPreflight,
  readPaymentStatusPreflight,
  resetPaymentCommandPreflightStats,
} from './use-cases/payment-command-preflight';

// Fase 3 (charges)
export { ensureCustomer } from './use-cases/ensure-customer';
export type {
  EnsureCustomerInput,
  EnsureCustomerOutput,
  EnsureCustomerError,
  EnsureCustomerPayerRef,
} from './use-cases/ensure-customer';

export { createCharge } from './use-cases/create-charge';
export type {
  CreateChargeInput,
  CreateChargeOutput,
  CreateChargeError,
} from './use-cases/create-charge';

export { createStandaloneCharge } from './use-cases/create-standalone-charge';
export type {
  CreateStandaloneChargeInput,
  CreateStandaloneChargeOutput,
  CreateStandaloneChargeError,
  ChargeType,
} from './use-cases/create-standalone-charge';

export { listCharges } from './use-cases/list-charges';
export type { ListChargesInput, ChargeListItem } from './use-cases/list-charges';

export { listChargesAggregated } from './use-cases/list-charges-aggregated';
export type {
  ListChargesAggregatedInput,
  ListChargesAggregatedOutput,
  ChargeOrigin,
} from './use-cases/list-charges-aggregated';
export type { ChargeListItemDTO, UnifiedChargeStatus } from './dtos/charge-list-item.dto';

// Fila operacional (FASE 1)
export { getOperationalChargesSummary, listOperationalCharges } from './use-cases/list-operational-charges';
export type {
  ListOperationalChargesInput,
  ListOperationalChargesOutput,
  OperationalChargesSummaryOutput,
} from './use-cases/list-operational-charges';
export { getDashboardFinanceKpisLocal } from './use-cases/get-dashboard-finance-kpis-local';
export type {
  DashboardFinanceKpisLocalSnapshot,
  DashboardPendingPaymentsKpi,
  GetDashboardFinanceKpisLocalInput,
} from './use-cases/get-dashboard-finance-kpis-local';
export { reconcileAcademicChargesWithAsaas } from './use-cases/reconcile-academic-charges';
export type { ReconcileAcademicChargesResult } from './use-cases/reconcile-academic-charges';

// Cobranças avulsas (FASE 2)
export { listStandaloneCharges } from './use-cases/list-standalone-charges';
export type {
  ListStandaloneChargesInput,
  ListStandaloneChargesOutput,
  StandaloneChargeItem,
} from './use-cases/list-standalone-charges';

// Parcelamentos agregados (FASE 2)
export { listInstallmentPlansAggregated } from './use-cases/list-installment-plans-aggregated';
export type {
  ListInstallmentPlansAggregatedInput,
  ListInstallmentPlansAggregatedOutput,
  InstallmentGroupItemDTO,
} from './use-cases/list-installment-plans-aggregated';

// Detalhe de parcelamento (FASE 4)
export { getInstallmentPlanDetail } from './use-cases/get-installment-plan-detail';
export type {
  GetInstallmentPlanDetailInput,
  InstallmentPlanDetailDTO,
  ParcelaItemDTO,
} from './use-cases/get-installment-plan-detail';

// Conta (encerramento)
export { encerrarContaAlusa } from './use-cases/account/close-account';
export type {
  CloseAccountResult,
  CloseAccountResultType,
  CloseAccountErrorCode,
} from './use-cases/account/close-account';

// Fase 4 (saldo / extrato)
export { getBalance } from './use-cases/get-balance';
export type { GetBalanceInput, GetBalanceOutput, GetBalanceError } from './use-cases/get-balance';
export { getTransferFees } from './use-cases/get-transfer-fees';
export type {
  GetTransferFeesInput,
  GetTransferFeesOutput,
  GetTransferFeesError,
} from './use-cases/get-transfer-fees';
export { getTransferDetail } from './use-cases/get-transfer-detail';
export type {
  GetTransferDetailInput,
  GetTransferDetailOutput,
  TransferDetailRecipient,
} from './use-cases/get-transfer-detail';
export { getAccountOverview } from './use-cases/get-account-overview';
export type {
  GetAccountOverviewInput,
  GetAccountOverviewOutput,
  GetAccountOverviewError,
  AccountOverviewTransferItem,
} from './use-cases/get-account-overview';
export { getAccountBalanceSummary } from './use-cases/get-account-balance-summary';
export type {
  GetAccountBalanceSummaryInput,
  GetAccountBalanceSummaryOutput,
  GetAccountBalanceSummaryError,
} from './use-cases/get-account-balance-summary';

// Ledger (extrato baseado em financialTransactions)
export { listLedgerEntries } from './use-cases/list-ledger-entries';
export type {
  ListLedgerEntriesInput,
  ListLedgerEntriesError,
} from './use-cases/list-ledger-entries';
export {
  ledgerEntryDTOSchema,
  listLedgerEntriesResultDTOSchema,
  listLedgerEntriesQueryDTOSchema,
  ledgerCategorySchema,
  ledgerSignSchema,
} from './dtos/ledger';

export {
  anticipationStatusSchema,
  anticipationTargetInputDTOSchema,
  anticipationTargetTypeSchema,
  listAnticipationCandidatesQueryDTOSchema,
  listAnticipationsQueryDTOSchema,
  updateAnticipationConfigurationInputDTOSchema,
} from './dtos/anticipations';
export type {
  AnticipationTargetInputDTO,
  ListAnticipationCandidatesQueryDTO,
  ListAnticipationsQueryDTO,
  UpdateAnticipationConfigurationInputDTO,
} from './dtos/anticipations';
export type {
  LedgerEntryDTO,
  LedgerCategory,
  LedgerSign,
  ListLedgerEntriesResultDTO,
  ListLedgerEntriesQueryDTO,
} from './dtos/ledger';
export {
  mapAsaasTransactionToLedgerEntry,
  resolveCategory,
  resolveSign,
} from './mappers/ledger.mapper';
export type { AsaasTransactionRaw } from './mappers/ledger.mapper';

// Extrato (contrato canônico da página)
export { getExtrato } from './use-cases/get-extrato';
export type { GetExtratoInput, GetExtratoError } from './use-cases/get-extrato';
export {
  ledgerEntryTypeSchema,
  ledgerEntryStatusSchema,
  ledgerEntrySchema,
  extratoSummarySchema,
  extratoFiltersSchema,
  extratoPaginationSchema,
  extratoSyncSchema,
  extratoResponseSchema,
  extratoQueryInputSchema,
} from './dtos/ledger';
export type {
  LedgerEntryType,
  LedgerEntryStatus,
  LedgerEntry,
  ExtratoSummary,
  ExtratoFilters,
  ExtratoPagination,
  ExtratoSync,
  ExtratoResponse,
  ExtratoQueryInput,
} from './dtos/ledger';
export { mapToLedgerEntry, resolveType, resolveStatus, resolveFee } from './mappers/ledger.mapper';

export { enrichLedgerEntries } from './services/ledger-enrichment.service';
export {
  getCustomerNotificationChannels,
  syncCustomerNotificationChannels,
} from './services/customer-notification.service';
export type {
  CustomerNotificationChannelsSnapshot,
  NotificationChannelPreferences,
  NotificationWarning,
  SyncNotificationResult,
} from './services/customer-notification.service';

// Fase 7 (receita ERP / competência)
export { getErpRevenue } from './use-cases/get-erp-revenue';
export type {
  GetErpRevenueInput,
  GetErpRevenueOutput,
  GetErpRevenueError,
  ErpRevenueItem,
} from './use-cases/get-erp-revenue';

export { getAsaasPaymentDetails } from './use-cases/get-asaas-payment-details';
export type { GetAsaasPaymentDetailsResult } from './use-cases/get-asaas-payment-details';

export {
  StoreSaleError,
  createStoreSale,
  listStoreSales,
  getStoreSaleById,
  cancelStoreSale,
  fulfillStoreSale,
  registerStoreSaleReturn,
  listEligibleStoreSaleMatriculas,
} from './use-cases/store-sales';
export type {
  CreateStoreSaleInput,
  StoreSaleItemInput,
  StoreSaleCustomerInput,
  StoreSaleFilterStatus,
  StoreSaleDTO,
  StoreSaleItemDTO,
  StoreSaleChargeDTO,
  StoreSaleInstallmentPlanDTO,
  StoreSaleMatriculaDTO,
  StoreSaleCustomerDTO,
  StoreSaleMerchantDTO,
  ListStoreSalesInput,
  ListStoreSalesOutput,
  GetStoreSaleInput,
  CancelStoreSaleInput,
  FulfillStoreSaleInput,
  RegisterStoreSaleReturnInput,
  ListEligibleStoreSaleMatriculasInput,
  EligibleStoreSaleMatriculaDTO,
} from './use-cases/store-sales';

export {
  StoreInventoryError,
  listInventoryBalances,
  listInventoryMovements,
  registerInventoryEntry,
  adjustInventory,
  listRestockOrders,
  createRestockOrder,
  receiveRestockOrder,
  cancelRestockOrder,
} from './use-cases/store-inventory';
export type {
  InventoryAlertState,
  InventoryBalanceDTO,
  InventoryMovementDTO,
  RestockOrderDTO,
  RestockOrderItemDTO,
  ListInventoryBalancesInput,
  ListInventoryMovementsInput,
  RegisterInventoryEntryInput,
  AdjustInventoryInput,
  ListRestockOrdersInput,
  CreateRestockOrderInput,
  ReceiveRestockOrderInput,
  CancelRestockOrderInput,
} from './use-cases/store-inventory';

export { processCheckoutCreditCard } from './use-cases/process-checkout-credit-card';
export type {
  ProcessCheckoutCreditCardInput,
  ProcessCheckoutCreditCardOutput,
} from './use-cases/process-checkout-credit-card';

export { ManualSyncError, resendTaxaMatricula } from './use-cases/manual-sync';
export type { ResendTaxaMatriculaInput, ResendTaxaMatriculaOutput } from './use-cases/manual-sync';

// Asaas ops (compat/migração de rotas do web)
export {
  AsaasEnvError,
  KycNotApprovedError,
  isAsaasEnabled,
  getCurrentBrasiliaDate,
  formatDate,
  getPayment,
  updatePayment,
  deletePayment,
  confirmCashPayment,
  undoCashPayment,
  getBillingInfo,
  reenviarCobranca,
  refundCobranca,
  getSubscription,
  getInstallment,
  listSubscriptionPayments,
  updateSubscription,
  updateSubscriptionCreditCard,
  deleteSubscription,
  cancelInstallmentPayments,
  pauseAssinatura,
  ativarAssinatura,
  reativarAssinatura,
  listPayments,
} from './use-cases/asaas-ops';
export { syncPaymentStateFromAsaas } from './use-cases/sync-payment-state-from-asaas';
export type {
  SyncPaymentStateFromAsaasInput,
  SyncPaymentStateFromAsaasOutput,
} from './use-cases/sync-payment-state-from-asaas';
export { getFinanceiroKpisFromAsaas } from './use-cases/get-financeiro-kpis-from-asaas';
export type {
  FinanceiroKpiSnapshot,
  FinanceiroKpisSnapshot,
  GetFinanceiroKpisFromAsaasInput,
  GetFinanceiroKpisFromAsaasOutput,
} from './use-cases/get-financeiro-kpis-from-asaas';

export {
  cancelReceivableAnticipation,
  getAutomaticAnticipationMenuVisibility,
  getReceivableAnticipationConfiguration,
  getReceivableAnticipationLimits,
  listReceivableAnticipationCandidates,
  listReceivableAnticipations,
  requestReceivableAnticipation,
  simulateReceivableAnticipation,
  updateReceivableAnticipationConfiguration,
} from './use-cases/anticipations';
export type {
  AutomaticAnticipationMenuVisibility,
  AnticipationCandidate,
  AnticipationError,
  AnticipationListItem,
  AnticipationLocalContext,
  AnticipationTarget,
  AnticipationTargetType,
  ListAnticipationCandidatesInput,
  ListAnticipationCandidatesOutput,
  ListAnticipationsInput,
  ListAnticipationsOutput,
} from './use-cases/anticipations';

// Fase 5 (saques/transfers)
export { requestWithdraw } from './use-cases/request-withdraw';
export type {
  RequestWithdrawInput,
  RequestWithdrawOutput,
  RequestWithdrawError,
  WithdrawDestination,
} from './use-cases/request-withdraw';

export { listTransfers } from './use-cases/list-transfers';
export type {
  ListTransfersInput,
  TransferListItem,
  ListTransfersOutput,
} from './use-cases/list-transfers';
export { cancelTransfer } from './use-cases/cancel-transfer';
export type {
  CancelTransferError,
  CancelTransferInput,
  CancelTransferOutput,
} from './use-cases/cancel-transfer';
export { listTransferRecipients } from './use-cases/list-transfer-recipients';
export type {
  ListTransferRecipientsInput,
  ListTransferRecipientsOutput,
  TransferRecipientItem,
} from './use-cases/list-transfer-recipients';
export { deleteTransferRecipient } from './use-cases/delete-transfer-recipient';
export type {
  DeleteTransferRecipientInput,
  DeleteTransferRecipientOutput,
} from './use-cases/delete-transfer-recipient';

// Fase 6 (subscriptions)
export { createSubscription } from './use-cases/create-subscription';
export type {
  CreateSubscriptionInput,
  CreateSubscriptionOutput,
  CreateSubscriptionError,
} from './use-cases/create-subscription';
export { listSubscriptions, listSubscriptionsForFinance } from './use-cases/list-subscriptions';
export type {
  ListSubscriptionsInput,
  SubscriptionListItem,
  ListSubscriptionsOutput,
  ListSubscriptionsFinanceInput,
  SubscriptionFinanceDTO,
  ListSubscriptionsFinanceOutput,
} from './use-cases/list-subscriptions';
export { getSubscriptionWithCharges } from './use-cases/get-subscription-with-charges';
export type {
  GetSubscriptionWithChargesInput,
  SubscriptionChargeDTO,
  SubscriptionDetailsDTO,
  GetSubscriptionWithChargesOutput,
} from './use-cases/get-subscription-with-charges';

// Fase 7 (installments)
export { createInstallmentPlan } from './use-cases/create-installment-plan';
export type {
  CreateInstallmentPlanInput,
  CreateInstallmentPlanOutput,
  CreateInstallmentPlanError,
} from './use-cases/create-installment-plan';

export { createStandaloneInstallmentPlan } from './use-cases/create-standalone-installment-plan';
export type {
  CreateStandaloneInstallmentInput,
  CreateStandaloneInstallmentOutput,
  CreateStandaloneInstallmentError,
} from './use-cases/create-standalone-installment-plan';

export {
  listInstallmentPlans,
  listInstallmentPlansForFinance,
} from './use-cases/list-installment-plans';
export type {
  ListInstallmentPlansInput,
  InstallmentPlanListItem,
  ListInstallmentPlansOutput,
  ListInstallmentPlansFinanceInput,
  InstallmentPlanFinanceDTO,
  ListInstallmentPlansFinanceOutput,
} from './use-cases/list-installment-plans';

// Fase 8 (invoices)
export { createInvoice } from './use-cases/create-invoice';
export type {
  CreateInvoiceInput,
  CreateInvoiceOutput,
  CreateInvoiceError,
} from './use-cases/create-invoice';
export { cancelInvoice } from './use-cases/cancel-invoice';
export type {
  CancelInvoiceInput,
  CancelInvoiceOutput,
  CancelInvoiceError,
} from './use-cases/cancel-invoice';
export { listInvoices } from './use-cases/list-invoices';
export type {
  ListInvoicesInput,
  InvoiceListItem,
  ListInvoicesOutput,
} from './use-cases/list-invoices';

// Refactor Billing v2 - FASE 5 (mutações alinhadas ao Asaas)
export { updateCharge } from './use-cases/update-charge';
export type { UpdateChargeInput, UpdateChargeResult } from './use-cases/update-charge';
export { deleteCharge } from './use-cases/delete-charge';
export type { DeleteChargeInput, DeleteChargeResult } from './use-cases/delete-charge';
export { markChargeAsPaid } from './use-cases/mark-charge-as-paid';
export type {
  MarkChargeAsPaidInput,
  MarkChargeAsPaidResult,
} from './use-cases/mark-charge-as-paid';

// Admin tools
export { testarConexaoAsaas } from './use-cases/admin/test-asaas-connection';
export type {
  TesteAsaasResult,
  CheckStatus,
  TesteAsaasErrorCode,
} from './use-cases/admin/test-asaas-connection';
export { reconnectAsaasAccount } from './use-cases/admin/reconnect-asaas-account';
export type { ReconnectAsaasResult } from './use-cases/admin/reconnect-asaas-account';
export { excluirContaAlusaEAsaas } from './use-cases/admin/delete-asaas-account';
export type {
  DeleteAsaasAccountResult,
  DeleteAsaasAccountStep,
  DeleteAsaasAccountErrorCode,
} from './use-cases/admin/delete-asaas-account';

// Webhooks
export { handlePaymentWebhook } from './webhooks/payment-webhook-handler';
export type { PaymentWebhookPayload } from './webhooks/payment-webhook-handler';
export { handleAsaasWebhookEvent } from './webhooks/asaas-webhook-handler';
export {
  enqueueAsaasWebhookEvent,
  processAsaasWebhookQueue,
} from './webhooks/asaas-webhook-handler';
export { reprocessErroredAsaasWebhooks } from './webhooks/asaas-webhook-handler';
export {
  ASAAS_WEBHOOK_TOKEN_HEADERS,
  resolveAsaasWebhookAccessToken,
  resolveContaIdFromWebhookAuthToken,
} from './webhooks/asaas-webhook-auth';
export { handleTransferWebhook } from './webhooks/transfer-webhook-handler';
export type { TransferWebhookPayload } from './webhooks/transfer-webhook-handler';
export { handleTransferAuthorizationWebhook } from './webhooks/transfer-authorization-webhook-handler';
export type {
  TransferAuthorizationDecision,
  TransferAuthorizationWebhookPayload,
} from './webhooks/transfer-authorization-webhook-handler';
export { handleSubscriptionWebhook } from './webhooks/subscription-webhook-handler';
export type { SubscriptionWebhookPayload } from './webhooks/subscription-webhook-handler';
export {
  getWebhookConfigDriftStatus,
  repairWebhookConfigDrift,
} from './webhooks/webhook-config-drift.service';
export type {
  WebhookConfigDriftStatus,
  RepairWebhookConfigDriftResult,
} from './webhooks/webhook-config-drift.service';

// Webhook Event Registry
export {
  ASAAS_EVENT_REGISTRY,
  isKnownEvent,
  isHandledEvent,
  getEventDefinition,
  getEventsByCategory,
  getHandledEvents,
  getUnhandledEvents,
  getCriticalEvents,
  getRegistryStats,
} from './webhooks/asaas-event-registry';
export type {
  EventImpactLevel,
  EventCategory,
  AsaasEventDefinition,
} from './webhooks/asaas-event-registry';

// Reconciliation
export {
  ASAAS_BILLING_TYPE_MAP,
  FORMA_PAGAMENTO_TO_ASAAS,
  FORMA_PAGAMENTO_LABELS,
  TIPO_COBRANCA_LABELS,
  validateDate,
  dateToISO,
  isoToDate,
} from './reconciliation/asaas-sync';

// Foundation (Fase 0)
export { credentialVault } from './foundation/credential-vault';
export { financeProfileService } from './foundation/finance-profile.service';
export type { FinanceProfileOnboardingData } from './foundation/finance-profile.service';
export { featureFlagsService } from './foundation/feature-flags.service';
export type { FinancialFeatureFlag } from './foundation/feature-flags.service';
export { auditLogService } from './foundation/audit-log.service';
export type { AuditActorRef, AuditEntityRef } from './foundation/audit-log.service';

// Correlation ID
export {
  withCorrelationId,
  getCorrelationId,
  generateCorrelationId,
} from './foundation/correlation';

// Env Validation
export {
  validateEncryptionKey,
  validateFinanceEnv,
  assertFinanceEnvOnBoot,
} from './foundation/env-validation';
export type { EnvValidationResult } from './foundation/env-validation';

// Use cases (Fase 1)
export { createAsaasAccount } from './use-cases/asaas-account/create-asaas-account';
export type { CreateAsaasAccountResult } from './use-cases/asaas-account/create-asaas-account';
export { updateAsaasAccount } from './use-cases/asaas-account/update-asaas-account';
export type { UpdateAsaasAccountResult } from './use-cases/asaas-account/update-asaas-account';
export { createOrUpdateAsaasAccount } from './use-cases/asaas-account/create-or-update-asaas-account';
export type { CreateOrUpdateAsaasAccountResult } from './use-cases/asaas-account/create-or-update-asaas-account';
export { reconcileAsaasAccount } from './use-cases/asaas-account/reconcile-asaas-account';

// Ensure Asaas Subaccount Guard (wizard-based)
export {
  ensureAsaasSubaccount,
  canCreateSubaccount,
} from './use-cases/asaas-account/ensure-asaas-subaccount';
export type {
  EnsureAsaasSubaccountSuccess,
  EnsureAsaasSubaccountError,
  EnsureAsaasSubaccountResult,
  EnsureAsaasSubaccountFailure,
  CanCreateSubaccountResult,
} from './use-cases/asaas-account/ensure-asaas-subaccount';

export { getOnboardingStatus } from './use-cases/get-onboarding-status';
export type { OnboardingStatusResult } from './use-cases/get-onboarding-status';
export { startFinancialOnboarding } from './use-cases/start-financial-onboarding';
export { submitKycData } from './use-cases/submit-kyc-data';
export type { SubmitKycDataResult } from './use-cases/submit-kyc-data';

// KYC (Etapa 3)
export { getKycSummary, getKycSummaryFresh } from './use-cases/kyc/get-kyc-summary';
export type { GetKycSummaryResult } from './use-cases/kyc/get-kyc-summary';
export { getKycAsaasReadCacheStats } from './use-cases/kyc/kyc-asaas-read-cache';
export type {
  AsaasConnectionDTO,
  AsaasConnectionReasonCode,
  AsaasConnectionStatus,
} from './dtos/asaas-connection.dto';
export { getKycViewModel, getKycViewModelFresh } from './use-cases/kyc/get-kyc-view-model';
export { getAccountVerificationStatus } from './use-cases/kyc/get-account-verification-status';
export type {
  KycViewModel,
  KycGateStatus,
  KycUiNextAction,
  KycDocumentItem,
} from './dtos/kyc/kyc-view-model.dto';
export type {
  KycAreaStatus,
  KycSlotInfo,
  KycNextAction,
  KycSnapshot,
  AccountVerificationStatus,
  AccountVerificationResponse,
  VerificationAction,
  VerificationActionMode,
  VerificationActionStatus,
  VerificationSlotInfo,
  VerificationAreaInfo,
} from './dtos/kyc/kyc-snapshot.dto';
export { uploadKycDocumentByGroup } from './use-cases/kyc/upload-kyc-document-by-group';
export type { UploadKycDocumentByGroupResult } from './use-cases/kyc/upload-kyc-document-by-group';
export { viewKycDocumentFile } from './use-cases/kyc/view-kyc-document-file';
export type { ViewKycDocumentFileParams } from './use-cases/kyc/view-kyc-document-file';
export { updateKycDocumentFile } from './use-cases/kyc/update-kyc-document-file';
export type { UpdateKycDocumentFileParams } from './use-cases/kyc/update-kyc-document-file';
export { deleteKycDocumentFile } from './use-cases/kyc/delete-kyc-document-file';
export type {
  DeleteKycDocumentFileParams,
  DeleteKycDocumentFileResult,
} from './use-cases/kyc/delete-kyc-document-file';

// KYC Reconciliation
export { reconcileKycModels } from './use-cases/kyc/kyc-reconciliation.service';
export type {
  KycReconciliationResult,
  KycReconciliationDetail,
} from './use-cases/kyc/kyc-reconciliation.service';

// Errors
export { MissingAsaasApiKeyError } from './errors/missing-asaas-api-key-error';
export { MissingAsaasAccountIdError } from './errors/missing-asaas-account-id-error';
export { DocumentsNotReadyError } from './errors/documents-not-ready-error';
export { InvalidKycGroupIdError } from './errors/invalid-kyc-group-id-error';
export { OnboardingUrlRequiredError } from './errors/onboarding-url-required-error';
export { ProviderPortalRequiredError } from './errors/provider-portal-required-error';

// Wizard Onboarding
export {
  getWizardState,
  saveWizardStep1,
  saveWizardStep2,
  saveWizardStep3,
  saveWizardStep4,
  saveWizardStep5,
  completeWizard,
} from './use-cases/onboarding/wizard-service';
export {
  wizardStep1Schema,
  wizardStep2Schema,
  wizardStep3Schema,
  wizardStep4Schema,
  wizardStep5Schema,
  getMissingFieldsForSubaccount,
  REQUIRED_FIELDS_FOR_SUBACCOUNT,
} from './use-cases/onboarding/wizard-types';
export type {
  WizardStep,
  WizardPersonType,
  WizardCompanyType,
  WizardState,
  WizardStep1Data,
  WizardStep2Data,
  WizardStep3Data,
  WizardStep4Data,
  WizardStep5Data,
  GetWizardStateResult,
  SaveWizardStepResult,
  CompleteWizardResult,
} from './use-cases/onboarding/wizard-types';

// Wizard → Asaas payload mapping
export {
  mapWizardToAsaasPayload,
  validateWizardForAsaas,
} from './use-cases/onboarding/map-wizard-to-asaas-payload';
export type {
  MapWizardToAsaasPayloadResult,
  MapWizardToAsaasPayloadSuccess,
  MapWizardToAsaasPayloadError,
} from './use-cases/onboarding/map-wizard-to-asaas-payload';

// Jobs
export { reconcileAsaasAccountsJob, shouldReconcileNow } from './jobs/reconcile-asaas-accounts';
export type { ReconcileJobResult } from './jobs/reconcile-asaas-accounts';

// Webhook Scheduler
export { runWebhookScheduler } from './webhooks/webhook-scheduler.service';
export type {
  WebhookSchedulerResult,
  WebhookSchedulerOptions,
  SchedulerStepResult,
} from './webhooks/webhook-scheduler.service';

// Webhook Runtime
export {
  inspectWebhookProcessingRuntimeStatus,
  inspectWebhookUrlRuntimeStatus,
} from './webhooks/webhook-runtime-config';
export type {
  WebhookProcessingMode,
  WebhookProcessingRuntimeStatus,
  WebhookProcessingRuntimeWarning,
  WebhookUrlRuntimeStatus,
} from './webhooks/webhook-runtime-config';

// Webhook Observability
export {
  logWebhookProcessing,
  createWebhookLogEntry,
  calculateRegistryMetrics,
  validateCriticalEventsCoverage,
  assertCriticalEventsCovered,
  generateUnhandledReport,
  alertIfUnhandledCritical,
  alertIfUnknownEvent,
  alertTokenRejected,
  alertQueueLagCritical,
  evaluateWebhookSLOs,
} from './webhooks/webhook-observability.service';
export type {
  WebhookLogEntry,
  WebhookMetrics,
  CategoryMetrics,
  WebhookSLOThresholds,
  WebhookSLOResult,
  WebhookSLOViolation,
} from './webhooks/webhook-observability.service';

// Webhook Health Check
export { checkWebhookHealth, getWebhookHealthStatus } from './webhooks/webhook-health.service';
export type {
  WebhookHealthCheckResult,
  WebhookHealthStatus,
} from './webhooks/webhook-health.service';

// Webhook IP Whitelist
export {
  extractClientIp,
  extractClientIps,
  isAsaasWebhookIpAllowed,
  shouldBlockAsaasWebhookByIp,
  getAsaasWebhookIps,
} from './webhooks/webhook-ip-whitelist';

// Webhook Rate Limiter
export { WebhookRateLimiter, globalWebhookRateLimiter } from './webhooks/webhook-rate-limiter';

// Webhook DLQ Admin
export {
  listDlqWebhooks,
  getDlqStats,
  requeueDlqWebhooks,
  requeueAllDlqWebhooks,
} from './webhooks/dlq-admin.service';
export type {
  DlqListOptions,
  DlqListItem,
  DlqListResult,
  DlqStats,
  DlqRequeueResult,
} from './webhooks/dlq-admin.service';

// Webhook Queue Adapter
export { PostgresQueueAdapter, createQueueAdapter } from './webhooks/queue-adapter';
export type {
  QueueAdapter,
  QueueItem,
  QueueItemStatus,
  EnqueueOptions,
  ClaimOptions,
  ClaimResult,
  QueueStats,
  QueueBackend,
} from './webhooks/queue-adapter';

// Asaas API Logger
export {
  logAsaasApiCall,
  getApiCallStats,
  getRecentApiCalls,
  resetApiCallStats,
} from './foundation/asaas-api-logger';
export type { AsaasApiLogEntry, ApiCallStats } from './foundation/asaas-api-logger';

// Alert Channels
export { alertService } from './foundation/alert-channel';
export type {
  AlertSeverity,
  AlertPayload,
  AlertChannel,
  AlertDispatchResult,
} from './foundation/alert-channel';

// Hooks Integration (conecta @alusa/asaas → logger + alertas)
export {
  registerAsaasHooksIntegration,
  resetAsaasHooksIntegration,
} from './foundation/asaas-hooks-integration';

// Account Health Monitor
export { checkAccountHealth } from './foundation/account-health-monitor';
export type {
  AccountHealthCheckResult,
  AccountHealthAlert,
  AccountAlertType,
} from './foundation/account-health-monitor';

// Operational Metrics Exporter
export { collectOperationalMetrics, toPrometheusText } from './foundation/metrics-exporter';
export type { OperationalMetricsSnapshot } from './foundation/metrics-exporter';

// Standalone Webhook Worker
export { startWorker, stopWorker } from './workers/webhook-worker';
export type { WorkerCycleResult } from './workers/webhook-worker';

// Webhook Diagnostics
export { getWebhookOperationalDiagnostics } from './webhooks/webhook-operational-diagnostics.service';
export type {
  GetWebhookOperationalDiagnosticsOptions,
  WebhookOperationalDiagnostics,
  WebhookOperationalRecommendation,
} from './webhooks/webhook-operational-diagnostics.service';

// Webhook Replay
export {
  replayWebhookByEventId,
  replayWebhooksByDateRange,
  canReplayWebhook,
} from './webhooks/webhook-replay.service';
export type {
  ReplayByEventIdParams,
  ReplayByEventIdResult,
  ReplayByDateRangeParams,
  ReplayByDateRangeResult,
} from './webhooks/webhook-replay.service';

initializeAsaasHooksIntegration();

// Webhook Reconciliation (FASE 3)
export {
  detectWebhookGaps,
  getWebhookMetrics,
  getWebhookQueueMetrics,
  archiveProcessedWebhooks,
  reconcileWithAsaas,
  reconcileBilateral,
  listWebhooks,
  getWebhookDetails,
  evaluateRetentionAlert,
  markExhaustedWebhooks,
} from './webhooks/webhook-reconciliation.service';
export type {
  ReconciliationResult,
  ReconciliationOptions,
  QueueMetricsOptions,
  QueueMetricsResult,
  ArchiveWebhooksOptions,
  ArchiveWebhooksResult,
  AsaasReconcileOptions,
  AsaasReconcileResult,
  WebhookGapDetectionResult,
  WebhookMetricsSummary,
  WebhookListItem,
  WebhookListOptions,
  WebhookListResult,
  RetentionAlert,
  RetentionAlertLevel,
  MarkExhaustedOptions,
  MarkExhaustedResult,
  BilateralReconcileOptions,
  BilateralReconcileResult,
  BilateralDriftItem,
} from './webhooks/webhook-reconciliation.service';

// Guards - Charge Status (Progressão Monotônica)
export {
  validateChargeStatusTransition,
  applyChargeStatusWithMonotonicity,
  getAllowedActionsByChargeStatus,
  isActionAllowed,
  isTerminalStatus,
  CHARGE_ACTION_LABELS,
} from './guards/charge-status-guard';
export type {
  ChargeStatusTransitionResult,
  StatusUpdateOrigin,
  ApplyStatusOptions,
  ChargeAction,
} from './guards/charge-status-guard';

// Services
export {
  resolvePayerService,
  resolvePayerFromAluno,
  resolvePayerFromMatricula,
  resolvePayerWithCustomer,
  fetchAsaasPaymentSnapshot,
  persistAsaasPaymentSnapshot,
  syncCobrancaWithAsaas,
  shouldThrottleFetch,
  asaasSyncFlags,
} from './services';
export type {
  ResolvePayerFromAlunoInput,
  ResolvePayerFromMatriculaInput,
  ResolvePayerOutput,
  ResolvePayerErrorCode,
  AsaasPaymentSnapshot,
  FetchAsaasPaymentSnapshotResult,
  PersistAsaasPaymentSnapshotResult,
  SyncCobrancaWithAsaasResult,
} from './services';

// Ports
export type {
  PaymentsProviderPort,
  PayerInfo,
  PayerType,
  BillingCycle,
  BillingType,
  ResolveOrCreateCustomerInput,
  ResolveOrCreateCustomerResult,
  CancelSubscriptionInput,
  CancelSubscriptionResult,
  ProviderCreateSubscriptionInput,
  ProviderCreateSubscriptionResult,
  SubscriptionDiscount,
  SubscriptionInterest,
  SubscriptionFine,
} from './ports/PaymentsProviderPort';

// Adapters
export { AsaasPaymentsProviderAdapter } from './adapters/AsaasPaymentsProviderAdapter';
export type { AsaasAdapterDeps } from './adapters/AsaasPaymentsProviderAdapter';
export { createAsaasPaymentsProvider } from './adapters/createAsaasPaymentsProvider';

// Rematrícula
export { rematricularAluno, retryRematricula } from './use-cases/rematricularAluno';
export type {
  RematricularAlunoInput,
  RematricularAlunoOutput,
  RematricularAlunoError,
  RematricularAlunoResult,
  RematricularAlunoDeps,
  RetryRematriculaInput,
  RetryRematriculaError,
  RetryRematriculaResult,
} from './use-cases/rematricularAluno';

// Troca de Pagador (PR4)
export { changePayer, retryPayerChange } from './use-cases/changePayer';
export type {
  ChangePayerInput,
  ChangePayerOutput,
  ChangePayerError,
} from './use-cases/changePayer';

// Jobs
export { applyMatriculaTimeoutJob } from './jobs/apply-matricula-timeout';
export { cleanupOrphanChargesJob } from './jobs/cleanup-orphan-charges';
export type {
  ApplyMatriculaTimeoutInput,
  ApplyMatriculaTimeoutResult,
} from './jobs/apply-matricula-timeout';
