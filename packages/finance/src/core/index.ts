/**
 * Core Module - Exports centralizados
 * 
 * Este módulo contém as definições fundamentais para:
 * - External Reference (identificação determinística)
 * - Status Mapping (Asaas → Alusa)
 * - Idempotency (garantia de processamento único)
 * - Webhook Types (estruturas de dados)
 */

// External Reference
export {
  // Types
  type ExternalReferenceType,
  type ParsedExternalReference,
  // Constants
  EXTERNAL_REF_PREFIX,
  ExternalReferencePrefix,
  // Builders
  buildChargeExternalReference,
  buildSubscriptionExternalReference,
  buildInstallmentExternalReference,
  buildStandaloneExternalReference,
  buildPaymentExternalReference,
  buildPaymentReferencePrefix,
  isPaymentReferenceForParent,
  // Parsers
  parseExternalReference,
  // Validators
  isExternalReferenceOfType,
  extractPrimaryId,
  isV2ExternalReference,
  // Constants
  ASAAS_MAX_EXTERNAL_REF_LENGTH,
} from './external-reference';

// Status Mapping
export {
  // Types
  type AsaasPaymentStatus,
  type InternalPaymentStatus,
  // Mappers
  mapAsaasToInternalStatus,
  mapAsaasToCobrancaStatus,
  mapAsaasToChargeStatus,
  mapInternalToCobrancaStatus,
  mapInternalToChargeStatus,
  // Precedence
  canProgressInternalStatus,
  canProgressCobrancaStatus,
  canProgressChargeStatus,
  computeNextCobrancaStatus,
  computeNextChargeStatus,
  // Liquidação
  computeLiquidacaoStatus,
  // Helpers
  isPaidStatus,
  isActiveStatus,
  isTerminalStatus,
  getAsaasStatusesFor,
} from './status-mapping';

// Idempotency
export {
  // Types
  type IdempotencyCheckResult,
  type IdempotencyRecordInput,
  type IdempotencyGuardScope,
  // Asaas-safe idempotency
  ASAAS_MAX_IDEMPOTENCY_KEY_LENGTH,
  buildSafeAsaasIdempotencyKey,
  // Hash Utils
  hashPayload,
  buildWebhookIdempotencyKey,
  buildChargeIdempotencyKey,
  buildSubscriptionIdempotencyKey,
  buildInstallmentIdempotencyKey,
  // Checks
  checkWebhookIdempotency,
  checkChargeIdempotency,
  checkSubscriptionIdempotency,
  checkInstallmentIdempotency,
  // Webhook Lock
  tryAcquireWebhookLock,
  markWebhookSuccess,
  markWebhookError,
  // Read-before-write
  checkExistingChargeByExternalRef,
  checkExistingSubscriptionByExternalRef,
  acquireGuardLock,
  withIdempotencyGuard,
  buildGuardKey,
  isPrismaUniqueViolation,
} from './idempotency.service';

// Webhook Types
export {
  // Event Types
  type WebhookEventCategory,
  type PaymentEvent,
  type SubscriptionEvent,
  type TransferEvent,
  type WebhookEvent,
  // Payload Types
  type AsaasWebhookBasePayload,
  type PaymentWebhookPayload,
  type SubscriptionWebhookPayload,
  type TransferWebhookPayload,
  type InternalTransferWebhookPayload,
  type AccountWebhookPayload,
  // Result Types
  type WebhookHandlerResult,
  type WebhookProcessResult,
  // Helpers
  isPaymentEvent,
  isSubscriptionEvent,
  isTransferEvent,
  getEventCategory,
  isCriticalEvent,
  CRITICAL_PAYMENT_EVENTS,
  INFO_PAYMENT_EVENTS,
} from './webhook-types';

// Billing Helpers
export {
  deriveDeterministicId,
  toFormaPagamento,
  toBillingType,
} from './billing-helpers';
