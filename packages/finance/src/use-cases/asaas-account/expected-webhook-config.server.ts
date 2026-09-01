import {
  DEFAULT_WEBHOOK_PROVISIONING_CAPABILITIES,
  getWebhookEventsForCapabilities,
  type WebhookProvisioningCapability,
} from '../../webhooks/webhook-provisioning-events';
import { canonicalizePublicHostname, resolveWebhookUrl } from './asaas-env';
import { hashWebhookAuthToken, resolveWebhookAuthToken } from './webhook-auth-token';

export const RECOMMENDED_WEBHOOK_SEND_TYPE = 'SEQUENTIALLY' as const;
export const RECOMMENDED_WEBHOOK_NAME = 'Alusa - Webhook financeiro';

export function buildRecommendedWebhookName(financeProfileId: string): string {
  const suffix = financeProfileId.replace(/[^a-zA-Z0-9]/g, '').slice(-18);
  return suffix ? `${RECOMMENDED_WEBHOOK_NAME} - ${suffix}` : RECOMMENDED_WEBHOOK_NAME;
}

export function normalizeWebhookUrlBase(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hostname = canonicalizePublicHostname(parsed.hostname);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function hasSameWebhookEvents(current: string[] | undefined, expected: string[]): boolean {
  if (!Array.isArray(current)) return false;

  const currentSorted = [...current].sort();
  const expectedSorted = [...expected].sort();

  if (currentSorted.length !== expectedSorted.length) return false;

  return currentSorted.every((value, index) => value === expectedSorted[index]);
}

/**
 * Valida os eventos obrigatórios sem remover capacidades opcionais já
 * habilitadas no mesmo webhook por um fluxo posterior.
 */
export function hasRequiredWebhookEvents(current: string[] | undefined, expected: string[]): boolean {
  if (!Array.isArray(current)) return false;

  const currentSet = new Set(current);
  return expected.every((event) => currentSet.has(event));
}

export function buildExpectedWebhookConfig(
  financeProfileId: string,
  webhookUrl = resolveWebhookUrl(),
  capabilities: readonly WebhookProvisioningCapability[] = DEFAULT_WEBHOOK_PROVISIONING_CAPABILITIES,
) {
  const authToken = resolveWebhookAuthToken(financeProfileId);

  return {
    name: buildRecommendedWebhookName(financeProfileId),
    url: webhookUrl,
    normalizedUrl: normalizeWebhookUrlBase(webhookUrl),
    apiVersion: 3,
    sendType: RECOMMENDED_WEBHOOK_SEND_TYPE,
    events: getWebhookEventsForCapabilities(capabilities),
    authToken,
    authTokenHash: hashWebhookAuthToken(authToken),
  };
}
