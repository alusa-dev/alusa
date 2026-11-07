import { randomUUID } from 'node:crypto';

import {
  expectedEventsForPaymentCommand,
  failPaymentCommand,
  claimPaymentRefundCommandForDispatch,
  markPaymentCommandNeedsReconciliation,
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
  /** Retain ambiguous provider outcomes for reconciliation instead of terminal failure. */
  reconcileAmbiguousFailure?: boolean;
  run: (command: { commandJobId: string; correlationId: string }) => Promise<T>;
};

export type RunAsaasPaymentCommandOutput<T> = {
  result: T;
  commandJobId: string;
  correlationId: string;
  alreadyDispatched?: false;
};

export type ProtectedRefundCommandOutput<T> =
  | RunAsaasPaymentCommandOutput<T>
  | { commandJobId: string; correlationId: string; alreadyDispatched: true; commandStatus: string | null };

export function runAsaasPaymentCommand<T>(
  input: RunAsaasPaymentCommandInput<T> & { type: 'PAYMENT_REFUND_COMMAND'; reconcileAmbiguousFailure: true },
): Promise<ProtectedRefundCommandOutput<T>>;
export function runAsaasPaymentCommand<T>(input: RunAsaasPaymentCommandInput<T>): Promise<RunAsaasPaymentCommandOutput<T>>;

export async function runAsaasPaymentCommand<T>(
  input: RunAsaasPaymentCommandInput<T>,
): Promise<ProtectedRefundCommandOutput<T>> {
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

  const refundDispatchGuard = input.reconcileAmbiguousFailure && input.type === 'PAYMENT_REFUND_COMMAND';
  if (refundDispatchGuard) {
    const payload = command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload)
      ? command.payload as { commandStatus?: unknown }
      : null;
    const commandStatus = typeof payload?.commandStatus === 'string' ? payload.commandStatus : null;
    if (commandStatus && commandStatus !== 'REQUESTED') {
      return { commandJobId: command.id, correlationId, alreadyDispatched: true, commandStatus };
    }

    const claim = await claimPaymentRefundCommandForDispatch({
      contaId: input.contaId,
      jobId: command.id,
      asaasPaymentId: input.asaasPaymentId,
      providerStatus: input.providerStatus ?? null,
    });
    if (!claim.claimed) {
      return {
        commandJobId: claim.activeCommand?.id ?? command.id,
        correlationId: claim.activeCommand?.correlationId ?? correlationId,
        alreadyDispatched: true,
        commandStatus: claim.activeCommand?.commandStatus ?? commandStatus,
      };
    }
  }

  try {
    const result = await input.run({ commandJobId: command.id, correlationId });
    if (!refundDispatchGuard) {
      await markPaymentCommandSent({
        jobId: command.id,
        providerStatus: input.providerStatus ?? null,
      });
    }
    return { result, commandJobId: command.id, correlationId, alreadyDispatched: false };
  } catch (error) {
    if (!input.reconcileAmbiguousFailure) {
      await failPaymentCommand({ jobId: command.id, error });
    } else {
      const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : null;
      if (status !== null && status >= 400 && status < 500 && status !== 408) {
        await failPaymentCommand({ jobId: command.id, error });
      } else {
        await markPaymentCommandNeedsReconciliation({ jobId: command.id, error });
      }
    }
    throw error;
  }
}
