import {
  assertValidPublicBaseUrl,
  resolveConfiguredWebhookBaseUrl,
  type WebhookBaseUrlSource,
} from '../use-cases/asaas-account/asaas-env';

export type WebhookProcessingMode = 'QUEUE' | 'SYNC';

export interface WebhookProcessingRuntimeWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface WebhookUrlRuntimeStatus {
  configured: boolean;
  source: WebhookBaseUrlSource | null;
  baseUrl: string | null;
  webhookUrl: string | null;
  publicHttps: boolean;
  error: string | null;
}

export interface WebhookProcessingRuntimeStatus {
  mode: WebhookProcessingMode;
  useAsyncQueue: boolean;
  inlineDrain: boolean;
  isProduction: boolean;
  warnings: WebhookProcessingRuntimeWarning[];
}

export function inspectWebhookUrlRuntimeStatus(): WebhookUrlRuntimeStatus {
  const configured = resolveConfiguredWebhookBaseUrl();
  if (!configured) {
    return {
      configured: false,
      source: null,
      baseUrl: null,
      webhookUrl: null,
      publicHttps: false,
      error: 'ASAAS_WEBHOOK_PUBLIC_BASE_URL ou NEXT_PUBLIC_APP_URL não configurada.',
    };
  }

  const webhookUrl = `${configured.value.replace(/\/$/, '')}/api/webhooks/asaas`;

  try {
    assertValidPublicBaseUrl(configured.value, configured.source);

    return {
      configured: true,
      source: configured.source,
      baseUrl: configured.value,
      webhookUrl,
      publicHttps: true,
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      source: configured.source,
      baseUrl: configured.value,
      webhookUrl,
      publicHttps: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function inspectWebhookProcessingRuntimeStatus(
  env: NodeJS.ProcessEnv = process.env,
): WebhookProcessingRuntimeStatus {
  const isProduction = env.NODE_ENV === 'production';
  const useAsyncQueue = isProduction
    ? env.FIN_WEBHOOK_SYNC_OVERRIDE !== 'true'
    : env.FIN_WEBHOOK_ASYNC_ENABLED === 'true';
  const inlineDrain = isProduction
    ? env.FIN_WEBHOOK_INLINE_DRAIN === 'true'
    : env.FIN_WEBHOOK_INLINE_DRAIN !== 'false';

  const warnings: WebhookProcessingRuntimeWarning[] = [];

  if (isProduction && !useAsyncQueue) {
    warnings.push({
      code: 'PRODUCTION_SYNC_OVERRIDE_ENABLED',
      severity: 'critical',
      message:
        'FIN_WEBHOOK_SYNC_OVERRIDE=true em produção força processamento síncrono e foge da topologia recomendada.',
    });
  }

  if (isProduction && inlineDrain) {
    warnings.push({
      code: 'PRODUCTION_INLINE_DRAIN_ENABLED',
      severity: 'warning',
      message:
        'FIN_WEBHOOK_INLINE_DRAIN=true em produção mantém drenagem inline; prefira worker/cron dedicado.',
    });
  }

  if (!isProduction && !useAsyncQueue) {
    warnings.push({
      code: 'LOCAL_SYNC_MODE',
      severity: 'info',
      message:
        'Ambiente local está em modo síncrono. Ative FIN_WEBHOOK_ASYNC_ENABLED=true para validar a mesma topologia da produção.',
    });
  }

  return {
    mode: useAsyncQueue ? 'QUEUE' : 'SYNC',
    useAsyncQueue,
    inlineDrain,
    isProduction,
    warnings,
  };
}
