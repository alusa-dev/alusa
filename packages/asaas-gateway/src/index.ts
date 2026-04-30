/**
 * @alusa/asaas-gateway
 * 
 * Gateway centralizado para integração com o Asaas.
 * Contém:
 * - Client HTTP padronizado (reutiliza @alusa/asaas)
 * - Verificação de webhook (asaas-access-token)
 * - Feature flags para billing v2
 * - Tipos canônicos para externalReference
 */

// Client
export { AsaasGatewayClient, createAsaasGatewayClient } from './client/asaas-gateway-client';
export type { AsaasGatewayClientConfig } from './client/asaas-gateway-client';

// Webhook
export { WebhookVerifier } from './webhook/webhook-verifier';
export type { WebhookVerifyResult, WebhookVerifierDeps } from './webhook/webhook-verifier';

// External Reference
export {
  parseExternalReference,
  buildExternalReference,
  ExternalReferencePrefix,
} from './external-reference/external-reference';
export type { ParsedExternalReference, ExternalReferenceType } from './external-reference/external-reference';

// Feature Flags
export {
  BillingV2Flags,
  isBillingV2FlagEnabled,
  getBillingV2Flags,
} from './feature-flags/billing-v2-flags';
export type { BillingV2FlagName } from './feature-flags/billing-v2-flags';

// Errors
export { AsaasGatewayError } from './errors/asaas-gateway-error';

// Types & DTOs
export * from './types';
