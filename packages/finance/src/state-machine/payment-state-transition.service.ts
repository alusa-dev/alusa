import { prisma } from '@alusa/database';
import { Prisma } from '@prisma/client';

import { getCorrelationId } from '../foundation/correlation';
import {
  buildPaymentStateTransitionDedupeKey,
  type ChargeStateDecision,
  type PaymentStateDecision,
  type PaymentStateSource,
} from './payment-state-machine';

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002',
  );
}

/**
 * Persiste a decisão da máquina como trilha técnica append-only.
 * Duplicatas de replay são sucesso lógico e não geram uma segunda linha.
 */
export async function recordPaymentStateTransition(input: {
  contaId: string;
  entityType: 'COBRANCA' | 'CHARGE';
  entityId: string;
  source: PaymentStateSource;
  sourceId: string;
  decision: PaymentStateDecision | ChargeStateDecision;
  providerOccurredAt?: Date | null;
  localVersion?: number | null;
  correlationId?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<{ created: boolean; id: string | null }> {
  const dedupeKey = buildPaymentStateTransitionDedupeKey({
    contaId: input.contaId,
    entityType: input.entityType,
    entityId: input.entityId,
    source: input.source,
    sourceId: input.sourceId,
  });

  try {
    const created = await prisma.financePaymentStateTransition.create({
      data: {
        contaId: input.contaId,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey,
        sourceType: input.source,
        sourceId: input.sourceId,
        eventName: input.decision.eventName,
        providerStatusBefore: input.decision.previousProviderStatus,
        providerStatusAfter: input.decision.nextProviderStatus,
        localStatusBefore: input.decision.previousLocalStatus,
        localStatusAfter: input.decision.nextLocalStatus,
        decision: input.decision.kind,
        reason: input.decision.reason,
        providerOccurredAt: input.providerOccurredAt ?? null,
        localVersion: input.localVersion ?? null,
        correlationId: input.correlationId ?? getCorrelationId() ?? null,
        metadata: input.metadata,
      },
      select: { id: true },
    });
    return { created: true, id: created.id };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const existing = await prisma.financePaymentStateTransition.findUnique({
      where: { uq_finance_payment_state_transition_dedupe: { contaId: input.contaId, dedupeKey } },
      select: { id: true },
    });
    return { created: false, id: existing?.id ?? null };
  }
}
