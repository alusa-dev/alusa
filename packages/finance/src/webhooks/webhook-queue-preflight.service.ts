import {
  markExhaustedWebhooks,
  recoverStuckWebhooks,
  type MarkExhaustedResult,
  type RecoverStuckResult,
} from './webhook-reconciliation.service';

export interface WebhookQueuePreflightOptions {
  contaId?: string;
  stuckTimeoutMinutes?: number;
  stuckLimit?: number;
  exhaustedLimit?: number;
  maxAttempts?: number;
}

export interface WebhookQueuePreflightResult {
  stuck: RecoverStuckResult;
  exhausted: MarkExhaustedResult;
  generatedAt: Date;
}

/**
 * Passos leves de manutenção da fila executados antes do drain.
 * Recupera webhooks travados e marca exauridos (DLQ) sem alterar o fluxo de ingresso.
 */
export async function runWebhookQueuePreflight(
  options: WebhookQueuePreflightOptions = {},
): Promise<WebhookQueuePreflightResult> {
  const [stuck, exhausted] = await Promise.all([
    recoverStuckWebhooks({
      contaId: options.contaId,
      timeoutMinutes: options.stuckTimeoutMinutes ?? 5,
      limit: options.stuckLimit ?? 100,
    }),
    markExhaustedWebhooks({
      contaId: options.contaId,
      maxAttempts: options.maxAttempts,
      limit: options.exhaustedLimit ?? 200,
    }),
  ]);

  return {
    stuck,
    exhausted,
    generatedAt: new Date(),
  };
}
