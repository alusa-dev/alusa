import type { AsaasWebhookEventType } from '@alusa/asaas';

import { ASAAS_EVENT_REGISTRY } from './asaas-event-registry';

/**
 * Capacidades que podem compor a configuração do webhook da subconta.
 *
 * Pix Automático é deliberadamente opcional: o produto ainda não cria
 * autorizações nem instruções de pagamento desse produto. Mantê-lo como uma
 * capacidade separada evita enviar eventos de uma feature não habilitada para
 * contas Asaas que ainda não são elegíveis.
 */
export type WebhookProvisioningCapability = 'CORE_FINANCE' | 'PIX_AUTOMATIC';

export const DEFAULT_WEBHOOK_PROVISIONING_CAPABILITIES = Object.freeze(
  ['CORE_FINANCE'] as const,
);

/**
 * Retorna apenas eventos registrados no contrato oficial local e pelas
 * capacidades explicitamente habilitadas para a conta.
 *
 * O registry é mantido alinhado ao enum oficial do pacote @alusa/asaas. A
 * seleção usa somente o registry em runtime para não acoplar o provisionador
 * a exports opcionais de mocks/consumidores que carregam o pacote Asaas.
 *
 * CORE_FINANCE cobre o fluxo atual da Alusa. PIX_AUTOMATIC só deve ser usado
 * depois que elegibilidade, autorização, instruções de pagamento e handlers
 * idempotentes forem implementados.
 */
export function getWebhookEventsForCapabilities(
  capabilities: readonly WebhookProvisioningCapability[] = DEFAULT_WEBHOOK_PROVISIONING_CAPABILITIES,
): AsaasWebhookEventType[] {
  const enabled = new Set(capabilities);

  return Object.entries(ASAAS_EVENT_REGISTRY)
    .filter(([, definition]) => {
      if (definition.category === 'PIX_AUTOMATIC') return enabled.has('PIX_AUTOMATIC');
      return enabled.has('CORE_FINANCE');
    })
    .map(([event]) => event as AsaasWebhookEventType);
}

/** Configuração atual: Pix Automático permanece desativado por padrão. */
export const PROVISIONED_WEBHOOK_EVENTS = Object.freeze(
  getWebhookEventsForCapabilities(),
);
