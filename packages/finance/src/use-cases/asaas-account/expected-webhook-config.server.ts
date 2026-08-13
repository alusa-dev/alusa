import { PROVISIONED_WEBHOOK_EVENTS } from '../../webhooks/webhook-provisioning-events';
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

export function buildExpectedWebhookConfig(financeProfileId: string, webhookUrl = resolveWebhookUrl()) {
  const authToken = resolveWebhookAuthToken(financeProfileId);

  return {
    name: buildRecommendedWebhookName(financeProfileId),
    url: webhookUrl,
    normalizedUrl: normalizeWebhookUrlBase(webhookUrl),
    apiVersion: 3,
    sendType: RECOMMENDED_WEBHOOK_SEND_TYPE,
    events: [...PROVISIONED_WEBHOOK_EVENTS],
    authToken,
    authTokenHash: hashWebhookAuthToken(authToken),
  };
}
