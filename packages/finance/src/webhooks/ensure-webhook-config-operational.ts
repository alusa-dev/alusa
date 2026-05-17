import { assertAsaasTenantOperational } from '../foundation/asaas-operational-guard';

export async function ensureWebhookConfigOperational(contaId: string): Promise<void> {
  await assertAsaasTenantOperational(contaId);
}
