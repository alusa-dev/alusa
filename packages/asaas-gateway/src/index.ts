/**
 * @alusa/asaas-gateway
 *
 * Contratos técnicos Alusa↔Asaas (sem I/O de negócio).
 *
 * @see docs/adr-asaas-layer-boundaries.md
 */

// Webhook
export { WebhookVerifier, sha256Hex, extractWebhookToken } from './webhook/webhook-verifier';
export type { WebhookVerifyResult, WebhookVerifierDeps } from './webhook/webhook-verifier';

// External Reference (formato v1 legado)
export {
  parseExternalReference,
  buildExternalReference,
  ExternalReferencePrefix,
} from './external-reference/external-reference';
export type { ParsedExternalReference, ExternalReferenceType } from './external-reference/external-reference';

// Errors
export { AsaasGatewayError } from './errors/asaas-gateway-error';

// Types & DTOs
export * from './types';
