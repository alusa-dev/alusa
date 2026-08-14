import type { AsaasWebhookEventType } from '@alusa/asaas';

import { ASAAS_EVENT_REGISTRY } from './asaas-event-registry';

/**
 * A conexão externa da escola deve assinar todos os eventos suportados pelo
 * contrato oficial. Eventos sem mutação de domínio continuam sendo recebidos
 * pela inbox e classificados pelo registry como audit-only/unused.
 */
export const PROVISIONED_WEBHOOK_EVENTS = Object.freeze(
  Object.keys(ASAAS_EVENT_REGISTRY) as AsaasWebhookEventType[],
);
