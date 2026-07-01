import { randomUUID } from 'node:crypto';

import {
  expectedEventsForPaymentCommand,
  failPaymentCommand,
  markPaymentCommandSent,
  registerPaymentCommand,
  type PaymentCommandEntityType,
  type PaymentCommandJobType,
} from './payment-command-ledger';

export type RunAsaasPaymentCommandInput<T> = {
  contaId: string;
  type: PaymentCommandJobType;
  entityType: PaymentCommandEntityType;
  entityId: string;
  asaasPaymentId: string;
  actorId: string;
  chargeId?: string | null;
  cobrancaId?: string | null;
  providerStatus?: string | null;
  correlationId?: string;
  metadata?: Record<string, unknown>;
  run: () => Promise<T>;
};

export type RunAsaasPaymentCommandOutput<T> = {
  result: T;
  commandJobId: string;
  correlationId: string;
};

export async function runAsaasPaymentCommand<T>(
  input: RunAsaasPaymentCommandInput<T>,
): Promise<RunAsaasPaymentCommandOutput<T>> {
  const correlationId = input.correlationId ?? randomUUID();
  const command = await registerPaymentCommand({
    contaId: input.contaId,
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    asaasPaymentId: input.asaasPaymentId,
    expectedEvents: expectedEventsForPaymentCommand(input.type),
    correlationId,
    actorId: input.actorId,
    chargeId: input.chargeId ?? null,
    cobrancaId: input.cobrancaId ?? null,
    metadata: input.metadata,
  });

  try {
    const result = await input.run();
    await markPaymentCommandSent({
      jobId: command.id,
      providerStatus: input.providerStatus ?? null,
    });
    return { result, commandJobId: command.id, correlationId };
  } catch (error) {
    await failPaymentCommand({ jobId: command.id, error });
    throw error;
  }
}
