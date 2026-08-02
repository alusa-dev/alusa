import {
  assertAsaasTenantOperational,
  ensureWebhookReady,
} from '../foundation/asaas-operational-guard';

export async function ensureWebhookConfigOperational(
  contaId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // O status local pode continuar ACTIVE depois que o Asaas interrompe a fila
  // remotamente. Operações financeiras críticas devem conferir e reparar o
  // webhook soberano antes de executar a mutação, sem depender apenas do job
  // periódico de health check.
  const isTestRuntime = env.NODE_ENV === 'test' || env.VITEST === 'true';
  if (!isTestRuntime) {
    await ensureWebhookReady(contaId);
  }
  await assertAsaasTenantOperational(contaId);
}
