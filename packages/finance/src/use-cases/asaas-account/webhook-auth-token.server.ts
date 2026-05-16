import { createHash, createHmac } from 'node:crypto';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toTrimmed(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getExplicitWebhookAuthToken(): string | null {
  return toTrimmed(process.env.ASAAS_WEBHOOK_AUTH_TOKEN);
}

export function resolveWebhookAuthToken(financeProfileId: string): string {
  return deriveWebhookAuthToken(financeProfileId);
}

export function hasWebhookAuthTokenConfig(): boolean {
  return Boolean(toTrimmed(process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET));
}

function getWebhookAuthTokenSecretOrThrow(): string {
  const secret = toTrimmed(process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET);
  if (!secret) {
    throw new Error(
      [
        'ASAAS_WEBHOOK_AUTH_TOKEN_SECRET não configurada.',
        '',
        'Esta variável é BACKEND-ONLY (não use NEXT_PUBLIC_*) e precisa estar disponível no runtime do Next.js.',
        'Em dev, defina em: apps/web/.env.local',
        'Ex.: ASAAS_WEBHOOK_AUTH_TOKEN_SECRET=seu_secret_aqui',
      ].join('\n'),
    );
  }
  return secret;
}

export function deriveWebhookAuthToken(financeProfileId: string): string {
  // Sempre usa HMAC por tenant — garante token único por subconta.
  // ASAAS_WEBHOOK_AUTH_TOKEN (token global) não é usado aqui: causaria colisão
  // de hash (@unique em AsaasAccount.webhookAuthTokenHash) em ambientes multi-tenant.
  const secret = getWebhookAuthTokenSecretOrThrow();

  // Token estável por tenant; não persistimos em claro.
  // Base64url para ser header-safe.
  const digest = createHmac('sha256', secret)
    .update(`financeProfile:${financeProfileId}`)
    .digest('base64url');

  return digest;
}

export function hashWebhookAuthToken(webhookAuthToken: string): string {
  return sha256Hex(webhookAuthToken);
}
