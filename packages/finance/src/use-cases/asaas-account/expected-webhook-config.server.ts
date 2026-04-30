import { PROVISIONED_WEBHOOK_EVENTS } from '../../webhooks/webhook-provisioning-events';
import { resolveWebhookUrl } from './asaas-env';
import { deriveWebhookAuthToken, hashWebhookAuthToken } from './webhook-auth-token';

export const RECOMMENDED_WEBHOOK_SEND_TYPE = 'SEQUENTIALLY' as const;
export const RECOMMENDED_WEBHOOK_NAME = 'Alusa - Webhook financeiro';

export function normalizeWebhookUrlBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function hasSameWebhookEvents(current: string[] | undefined, expected: string[]): boolean {
  if (!Array.isArray(current)) return false;

  const currentSorted = [...current].sort();
  const expectedSorted = [...expected].sort();

  if (currentSorted.length !== expectedSorted.length) return false;

  return currentSorted.every((value, index) => value === expectedSorted[index]);
}

export function buildExpectedWebhookConfig(financeProfileId: string, webhookUrl = resolveWebhookUrl()) {
  const authToken = deriveWebhookAuthToken(financeProfileId);

  return {
    name: RECOMMENDED_WEBHOOK_NAME,
    url: webhookUrl,
    normalizedUrl: normalizeWebhookUrlBase(webhookUrl),
    sendType: RECOMMENDED_WEBHOOK_SEND_TYPE,
    events: [...PROVISIONED_WEBHOOK_EVENTS],
    authToken,
    authTokenHash: hashWebhookAuthToken(authToken),
  };
}