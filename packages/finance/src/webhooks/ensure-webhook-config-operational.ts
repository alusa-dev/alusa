import { repairWebhookConfigDrift } from './webhook-config-drift.service';

export async function ensureWebhookConfigOperational(contaId: string): Promise<void> {
  try {
    const result = await repairWebhookConfigDrift({
      contaId,
      actor: { type: 'SYSTEM' },
    });

    if (result.repaired) {
      console.info('[webhook-config] Drift reparado antes de mutacao financeira', {
        contaId,
        reason: result.reason,
      });
    }
  } catch (error) {
    console.warn('[webhook-config] Falha nao bloqueante ao verificar/reparar drift', {
      contaId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}