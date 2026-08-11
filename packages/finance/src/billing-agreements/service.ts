import { randomUUID } from 'node:crypto';

import { calculateBillingAgreementChangePreview } from './calculation';
import { BillingAgreementError, isUncertainRemoteError } from './errors';
import { stableFinancialHash } from './fingerprint';
import { sumMoneyCents } from './money';
import type {
  AsaasSubscriptionPaymentSnapshot,
  AsaasSubscriptionSnapshot,
  BillingAgreementLifecycleDependencies,
} from './ports';
import type {
  BillingAgreement,
  BillingAgreementChangeInput,
  BillingAgreementChangePreview,
  BillingAgreementChangeResult,
  BillingAgreementContext,
  BillingAgreementPlan,
  BillingAgreementView,
  BillingChargeImpact,
  BillingRemoteProgress,
  CommitBillingAgreementChangeInput,
} from './types';

const DEFAULT_PREVIEW_TTL_MS = 10 * 60 * 1000;

/** BillingAgreement usa fim exclusivo; o Asaas espera o último vencimento inclusivo. */
function providerEndDate(exclusiveEnd: string | null): string | null {
  if (!exclusiveEnd) return null;
  const date = new Date(`${exclusiveEnd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function withoutCommitMetadata(input: CommitBillingAgreementChangeInput): BillingAgreementChangeInput {
  const {
    uiRequestId: _uiRequestId,
    previewHash: _previewHash,
    previewExpiresAt: _previewExpiresAt,
    expectedAgreementVersion: _expectedAgreementVersion,
    ...change
  } = input;
  return change;
}

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b|not[ -]?found|não encontrad/i.test(message);
}

function assertRemoteSubscriptionCompatible(input: {
  remote: AsaasSubscriptionSnapshot;
  agreement: BillingAgreement;
  expectedCustomerId: string;
  expectedAmountCents: number;
  allowDesiredAmount: boolean;
}): void {
  if (input.remote.deleted) {
    throw new BillingAgreementError('REMOTE_STATE_DIVERGED', 'A assinatura remota já foi removida.');
  }
  if (input.remote.customerId !== input.expectedCustomerId) {
    throw new BillingAgreementError('REMOTE_STATE_DIVERGED', 'O customer remoto não corresponde ao pagador esperado.');
  }
  if (input.remote.billingType !== input.agreement.billingType || input.remote.cycle !== input.agreement.cycle) {
    throw new BillingAgreementError(
      'REMOTE_STATE_DIVERGED',
      'Forma de pagamento ou ciclo remoto diverge do acordo local.',
    );
  }
  if (
    input.remote.valueCents !== input.agreement.confirmedAmountCents &&
    (!input.allowDesiredAmount || input.remote.valueCents !== input.expectedAmountCents)
  ) {
    throw new BillingAgreementError(
      'REMOTE_STATE_DIVERGED',
      'O valor remoto diverge tanto do valor confirmado quanto do valor solicitado.',
      {
        remoteValueCents: input.remote.valueCents,
        confirmedAmountCents: input.agreement.confirmedAmountCents,
        expectedAmountCents: input.expectedAmountCents,
      },
    );
  }
}

async function getAfterDelete(input: {
  deps: BillingAgreementLifecycleDependencies;
  contaId: string;
  subscriptionId: string;
}): Promise<boolean> {
  try {
    const snapshot = await input.deps.asaas.getSubscription({
      contaId: input.contaId,
      subscriptionId: input.subscriptionId,
    });
    return snapshot.deleted;
  } catch (error) {
    if (isNotFoundError(error)) return true;
    throw error;
  }
}

async function getPaymentAfterDelete(input: {
  deps: BillingAgreementLifecycleDependencies;
  contaId: string;
  paymentId: string;
}): Promise<boolean> {
  try {
    const snapshot = await input.deps.asaas.getPayment({
      contaId: input.contaId,
      paymentId: input.paymentId,
    });
    return snapshot.deleted || snapshot.status === 'DELETED';
  } catch (error) {
    if (isNotFoundError(error)) return true;
    throw error;
  }
}

async function updateEligiblePendingPayments(input: {
  deps: BillingAgreementLifecycleDependencies;
  contaId: string;
  plan: BillingAgreementPlan;
  payments: AsaasSubscriptionPaymentSnapshot[];
}): Promise<void> {
  const targets = new Map(
    input.plan.chargeImpacts
      .filter(
        (impact) =>
          impact.action === 'UPDATE_WITH_SUBSCRIPTION' &&
          impact.providerPaymentId &&
          impact.targetAmountCents !== null,
      )
      .map((impact) => [impact.providerPaymentId!, impact]),
  );
  for (const payment of input.payments) {
    const impact = targets.get(payment.id);
    if (
      !impact ||
      (payment.status !== 'PENDING' && payment.status !== 'OVERDUE') ||
      impact.targetAmountCents === null
    ) continue;
    const fresh = await input.deps.asaas.getPayment({
      contaId: input.contaId,
      paymentId: payment.id,
    });
    if (fresh.status !== 'PENDING' && fresh.status !== 'OVERDUE') {
      throw new BillingAgreementError(
        'REMOTE_STATE_DIVERGED',
        'A cobrança deixou de ser editável durante a operação.',
        { paymentId: payment.id, status: fresh.status },
      );
    }
    if (
      fresh.billingType !== 'UNDEFINED' &&
      fresh.billingType !== 'BOLETO' &&
      fresh.billingType !== 'CREDIT_CARD' &&
      fresh.billingType !== 'PIX'
    ) {
      throw new BillingAgreementError(
        'REMOTE_STATE_DIVERGED',
        'A forma de pagamento da cobrança não permite atualização por este fluxo.',
        { paymentId: payment.id, billingType: fresh.billingType },
      );
    }
    await input.deps.asaas.updatePayment({
      contaId: input.contaId,
      paymentId: payment.id,
      valueCents: impact.targetAmountCents,
      billingType: fresh.billingType,
      dueDate: fresh.dueDate,
    });
    const confirmed = await input.deps.asaas.getPayment({
      contaId: input.contaId,
      paymentId: payment.id,
    });
    if (
      confirmed.valueCents !== impact.targetAmountCents ||
      (confirmed.status !== 'PENDING' && confirmed.status !== 'OVERDUE')
    ) {
      throw new BillingAgreementError(
        'REMOTE_OPERATION_UNCERTAIN',
        'Não foi possível confirmar a atualização da cobrança pendente.',
        { paymentId: payment.id },
      );
    }
  }
}

async function cancelEligiblePendingPayments(input: {
  deps: BillingAgreementLifecycleDependencies;
  contaId: string;
  impacts: BillingChargeImpact[];
  actualPayments: AsaasSubscriptionPaymentSnapshot[];
}): Promise<void> {
  const requestedIds = new Set(
    input.impacts
      .filter((impact) => impact.action === 'CANCEL_PENDING' && impact.providerPaymentId)
      .map((impact) => impact.providerPaymentId!),
  );
  for (const payment of input.actualPayments) {
    if (!requestedIds.has(payment.id) || payment.status !== 'PENDING') continue;
    let fresh: AsaasSubscriptionPaymentSnapshot;
    try {
      fresh = await input.deps.asaas.getPayment({
        contaId: input.contaId,
        paymentId: payment.id,
      });
    } catch (error) {
      // Remover a assinatura pode remover suas cobranças pendentes antes da
      // verificação individual. Nesse caso o objetivo já foi atingido.
      if (isNotFoundError(error)) continue;
      throw error;
    }
    if (fresh.status !== 'PENDING') {
      throw new BillingAgreementError(
        'REMOTE_STATE_DIVERGED',
        'A cobrança deixou de ser removível durante a operação.',
        { paymentId: payment.id, status: fresh.status },
      );
    }
    await input.deps.asaas.deletePayment({ contaId: input.contaId, paymentId: payment.id });
    if (!(await getPaymentAfterDelete({ deps: input.deps, contaId: input.contaId, paymentId: payment.id }))) {
      throw new BillingAgreementError(
        'REMOTE_OPERATION_UNCERTAIN',
        'A remoção da cobrança pendente não pôde ser confirmada.',
        { paymentId: payment.id },
      );
    }
  }
}

function replacementExternalReference(agreement: BillingAgreement, customerId: string): string {
  return `${agreement.externalReference}:payer:${stableFinancialHash(customerId).slice(0, 12)}`;
}

async function createOrRecoverSubscription(input: {
  deps: BillingAgreementLifecycleDependencies;
  context: BillingAgreementContext;
  plan: BillingAgreementPlan;
  contaId: string;
  idempotencyKey: string;
  externalReference: string;
  nextDueDate?: string;
}): Promise<AsaasSubscriptionSnapshot> {
  const existing = await input.deps.asaas.findSubscriptionByExternalReference({
    contaId: input.contaId,
    externalReference: input.externalReference,
  });
  if (existing) {
    assertRemoteSubscriptionCompatible({
      remote: existing,
      agreement: input.context.agreement,
      expectedCustomerId: input.plan.payer.customerId,
      expectedAmountCents: input.plan.resultingAmountCents,
      allowDesiredAmount: true,
    });
    if (existing.valueCents !== input.plan.resultingAmountCents) {
      throw new BillingAgreementError('REMOTE_STATE_DIVERGED', 'Assinatura recuperada com valor divergente.');
    }
    return existing;
  }
  const nextDueDate = input.nextDueDate ?? input.context.agreement.nextDueDate;
  if (!nextDueDate) {
    throw new BillingAgreementError('INVALID_INPUT', 'A assinatura exige a data do próximo vencimento.');
  }
  const created = await input.deps.asaas.createSubscription({
    contaId: input.contaId,
    customerId: input.plan.payer.customerId,
    valueCents: input.plan.resultingAmountCents,
    billingType: input.context.agreement.billingType,
    cycle: input.context.agreement.cycle,
    nextDueDate,
    endDate: providerEndDate(input.plan.agreementValidUntil),
    description: input.context.agreement.description,
    externalReference: input.externalReference,
    idempotencyKey: input.idempotencyKey,
  });
  const confirmed = await input.deps.asaas.getSubscription({
    contaId: input.contaId,
    subscriptionId: created.id,
  });
  assertRemoteSubscriptionCompatible({
    remote: confirmed,
    agreement: input.context.agreement,
    expectedCustomerId: input.plan.payer.customerId,
    expectedAmountCents: input.plan.resultingAmountCents,
    allowDesiredAmount: true,
  });
  if (confirmed.valueCents !== input.plan.resultingAmountCents) {
    throw new BillingAgreementError('REMOTE_OPERATION_UNCERTAIN', 'A criação da assinatura não pôde ser confirmada.');
  }
  return confirmed;
}

async function executeRemotePlan(input: {
  deps: BillingAgreementLifecycleDependencies;
  contaId: string;
  context: BillingAgreementContext;
  plan: BillingAgreementPlan;
  change: CommitBillingAgreementChangeInput;
  operationId: string;
  progress: BillingRemoteProgress[];
  onProgress: (_progress: BillingRemoteProgress[]) => Promise<void>;
}): Promise<BillingRemoteProgress> {
  const { plan, context, deps, contaId } = input;
  const previousSubscriptionId = context.agreement.asaasSubscriptionId;
  const baseProgress: BillingRemoteProgress = {
    agreementId: plan.agreementId,
    action: plan.remoteAction,
    previousSubscriptionId,
    resultingSubscriptionId: previousSubscriptionId,
    expectedAmountCents: plan.resultingAmountCents,
    confirmed: false,
  };
  if (
    plan.remoteAction === 'NONE' ||
    plan.remoteAction === 'SCHEDULE_UPDATE' ||
    plan.remoteAction === 'SCHEDULE_PAUSE' ||
    plan.remoteAction === 'SCHEDULE_RESUME' ||
    plan.remoteAction === 'SCHEDULE_CANCEL'
  ) {
    return { ...baseProgress, confirmed: true };
  }

  if (plan.remoteAction === 'CREATE_SUBSCRIPTION') {
    const created = await createOrRecoverSubscription({
      deps,
      context,
      plan,
      contaId,
      idempotencyKey: stableFinancialHash(`${contaId}:${input.change.uiRequestId}:${plan.agreementId}:create`),
      externalReference: context.agreement.externalReference,
      nextDueDate:
        input.change.kind === 'RESUME_AGREEMENT' || input.change.kind === 'RESUME_ALLOCATION'
          ? input.change.nextDueDate
          : undefined,
    });
    return { ...baseProgress, resultingSubscriptionId: created.id, confirmed: true };
  }

  if (!previousSubscriptionId) {
    throw new BillingAgreementError('REMOTE_STATE_DIVERGED', 'O acordo não possui assinatura remota.');
  }
  const before = await deps.asaas.getSubscription({ contaId, subscriptionId: previousSubscriptionId });
  assertRemoteSubscriptionCompatible({
    remote: before,
    agreement: context.agreement,
    expectedCustomerId: context.agreement.payer.customerId,
    expectedAmountCents: plan.resultingAmountCents,
    allowDesiredAmount: true,
  });
  const paymentsBefore = await deps.asaas.listSubscriptionPayments({
    contaId,
    subscriptionId: previousSubscriptionId,
  });

  if (plan.remoteAction === 'REPLACE_SUBSCRIPTION') {
    const externalReference = replacementExternalReference(context.agreement, plan.payer.customerId);
    const replacement = await createOrRecoverSubscription({
      deps,
      context,
      plan,
      contaId,
      idempotencyKey: stableFinancialHash(`${contaId}:${input.change.uiRequestId}:${plan.agreementId}:replace`),
      externalReference,
    });
    const replacementProgress: BillingRemoteProgress = {
      ...baseProgress,
      resultingSubscriptionId: replacement.id,
      confirmed: false,
    };
    const progressWithReplacement = [
      ...input.progress.filter((item) => item.agreementId !== plan.agreementId),
      replacementProgress,
    ];
    await input.onProgress(progressWithReplacement);

    if (input.change.effectivePolicy === 'CURRENT_CYCLE_FULL') {
      const replacementPayments = await deps.asaas.listSubscriptionPayments({
        contaId,
        subscriptionId: replacement.id,
      });
      const oldPending = paymentsBefore.filter((payment) => payment.status === 'PENDING');
      const hasEquivalent = oldPending.every((oldPayment) =>
        replacementPayments.some(
          (newPayment) =>
            newPayment.status === 'PENDING' &&
            newPayment.dueDate === oldPayment.dueDate &&
            newPayment.valueCents === plan.resultingAmountCents,
        ),
      );
      if (!hasEquivalent) {
        throw new BillingAgreementError(
          'REMOTE_STATE_DIVERGED',
          'A nova assinatura foi criada, mas as cobranças equivalentes ainda não foram confirmadas. A antiga foi preservada.',
        );
      }
      await cancelEligiblePendingPayments({
        deps,
        contaId,
        impacts: plan.chargeImpacts,
        actualPayments: paymentsBefore,
      });
    }
    await deps.asaas.deleteSubscription({ contaId, subscriptionId: previousSubscriptionId });
    if (!(await getAfterDelete({ deps, contaId, subscriptionId: previousSubscriptionId }))) {
      throw new BillingAgreementError('REMOTE_OPERATION_UNCERTAIN', 'A assinatura anterior não foi encerrada.');
    }
    return { ...replacementProgress, confirmed: true };
  }

  if (plan.remoteAction === 'DELETE_SUBSCRIPTION') {
    if (plan.resultingAmountCents !== 0) {
      throw new BillingAgreementError('INVALID_INPUT', 'A assinatura só pode ser removida com total zero.');
    }
    await deps.asaas.deleteSubscription({ contaId, subscriptionId: previousSubscriptionId });
    if (!(await getAfterDelete({ deps, contaId, subscriptionId: previousSubscriptionId }))) {
      throw new BillingAgreementError('REMOTE_OPERATION_UNCERTAIN', 'A remoção da assinatura não foi confirmada.');
    }
    await cancelEligiblePendingPayments({
      deps,
      contaId,
      impacts: plan.chargeImpacts,
      actualPayments: paymentsBefore,
    });
    return { ...baseProgress, resultingSubscriptionId: null, confirmed: true };
  }

  const status =
    plan.remoteAction === 'PAUSE_SUBSCRIPTION'
      ? 'INACTIVE'
      : plan.remoteAction === 'RESUME_SUBSCRIPTION'
        ? 'ACTIVE'
        : before.status === 'EXPIRED' && plan.resultingAmountCents > 0
          ? 'ACTIVE'
          : undefined;
  const targetEndDate = providerEndDate(plan.agreementValidUntil);
  if (!targetEndDate && before.endDate) {
    throw new BillingAgreementError(
      'REMOTE_STATE_DIVERGED',
      'A assinatura possui término remoto, mas o acordo projetado ficou sem término; substitua a assinatura.',
    );
  }
  const targetRemoteValue =
    plan.remoteAction === 'PAUSE_SUBSCRIPTION' ? before.valueCents : plan.resultingAmountCents;
  const alreadyConfirmed =
    before.valueCents === targetRemoteValue &&
    (!status || before.status === status) &&
    (!targetEndDate || before.endDate === targetEndDate);
  if (!alreadyConfirmed) {
    await deps.asaas.updateSubscription({
      contaId,
      subscriptionId: previousSubscriptionId,
      valueCents: targetRemoteValue,
      updatePendingPayments: plan.updatePendingPayments,
      status,
      ...(targetEndDate ? { endDate: targetEndDate } : {}),
      nextDueDate:
        (plan.remoteAction === 'RESUME_SUBSCRIPTION' ||
          (input.change.kind === 'RESUME_ALLOCATION' && plan.remoteAction === 'UPDATE_SUBSCRIPTION')) &&
        (input.change.kind === 'RESUME_AGREEMENT' || input.change.kind === 'RESUME_ALLOCATION')
          ? input.change.nextDueDate
          : undefined,
    });
  }
  const after = await deps.asaas.getSubscription({ contaId, subscriptionId: previousSubscriptionId });
  // Inativar uma assinatura interrompe novas cobranças, mas o Asaas preserva
  // seu valor configurado. Total desejado zero por pausa não significa valor
  // remoto zero (que nem é aceito para assinatura).
  const expectedRemoteValue = targetRemoteValue;
  if (
    after.deleted ||
    after.valueCents !== expectedRemoteValue ||
    (status && after.status !== status) ||
    (targetEndDate && after.endDate !== targetEndDate)
  ) {
    throw new BillingAgreementError('REMOTE_OPERATION_UNCERTAIN', 'A atualização da assinatura não pôde ser confirmada.');
  }
  await updateEligiblePendingPayments({ deps, contaId, plan, payments: paymentsBefore });
  if (plan.remoteAction === 'PAUSE_SUBSCRIPTION') {
    await cancelEligiblePendingPayments({
      deps,
      contaId,
      impacts: plan.chargeImpacts,
      actualPayments: paymentsBefore,
    });
  }
  return { ...baseProgress, confirmed: true };
}

async function loadContexts(input: {
  deps: BillingAgreementLifecycleDependencies;
  change: BillingAgreementChangeInput;
}): Promise<{ source: BillingAgreementContext; target: BillingAgreementContext | null }> {
  const source = await input.deps.repository.getAgreementContext({
    contaId: input.change.contaId,
    agreementId: input.change.agreementId,
    effectiveDate: input.change.effectiveDate,
  });
  if (!source) {
    throw new BillingAgreementError('AGREEMENT_NOT_FOUND', 'Acordo financeiro não encontrado.');
  }
  const target =
    input.change.kind === 'TRANSFER_ALLOCATION'
      ? await input.deps.repository.getAgreementContext({
          contaId: input.change.contaId,
          agreementId: input.change.targetAgreementId,
          effectiveDate: input.change.effectiveDate,
        })
      : null;
  if (input.change.kind === 'TRANSFER_ALLOCATION' && !target) {
    throw new BillingAgreementError('TARGET_AGREEMENT_NOT_FOUND', 'Acordo financeiro de destino não encontrado.');
  }
  return { source, target };
}

export function createBillingAgreementLifecycleService(deps: BillingAgreementLifecycleDependencies) {
  const now = deps.now ?? (() => new Date());
  const previewTtlMs = deps.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;
  const createCorrelationId = deps.createCorrelationId ?? randomUUID;

  async function preview(change: BillingAgreementChangeInput): Promise<BillingAgreementChangePreview> {
    const contexts = await loadContexts({ deps, change });
    return calculateBillingAgreementChangePreview({
      change,
      sourceContext: contexts.source,
      targetContext: contexts.target,
      now: now(),
      previewTtlMs,
    });
  }

  async function getAgreement(input: {
    contaId: string;
    agreementId: string;
  }): Promise<BillingAgreementView> {
    const context = await deps.repository.getAgreementContext(input);
    if (!context) throw new BillingAgreementError('AGREEMENT_NOT_FOUND', 'Acordo financeiro não encontrado.');
    const at = now().toISOString().slice(0, 10);
    const activeAllocationTotalCents = activeAgreementAllocationTotal(context, at);
    return {
      ...context,
      activeAllocationTotalCents,
      hasLocalDivergence: activeAllocationTotalCents !== context.agreement.desiredAmountCents,
    };
  }

  async function commit(input: CommitBillingAgreementChangeInput): Promise<BillingAgreementChangeResult> {
    if (!input.uiRequestId.trim()) {
      throw new BillingAgreementError('INVALID_INPUT', 'uiRequestId é obrigatório.');
    }
    const change = withoutCommitMetadata(input);
    const fingerprint = stableFinancialHash({
      change,
      previewHash: input.previewHash,
      expectedAgreementVersion: input.expectedAgreementVersion,
    });
    const agreementIds = [
      change.agreementId,
      ...(change.kind === 'TRANSFER_ALLOCATION' ? [change.targetAgreementId] : []),
    ];
    const locked = await deps.lock.withAgreementLocks({
      contaId: change.contaId,
      agreementIds,
      run: async () => {
        const existing = await deps.repository.getOperationByRequest({
          contaId: change.contaId,
          uiRequestId: input.uiRequestId,
        });
        if (existing?.requestFingerprint !== undefined && existing.requestFingerprint !== fingerprint) {
          throw new BillingAgreementError(
            'IDEMPOTENCY_CONFLICT',
            'O identificador da requisição já foi usado com outro conteúdo.',
          );
        }
        // Um retry idêntico concluído devolve o resultado persistido sem reler
        // versões nem exigir que o preview original ainda esteja vigente.
        if (existing?.status === 'COMPLETED' && existing.result) return existing.result;
        const expiresAt = new Date(input.previewExpiresAt);
        if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
          throw new BillingAgreementError('PREVIEW_EXPIRED', 'O preview financeiro expirou.');
        }
        const contexts = await loadContexts({ deps, change });
        const freshPreview = calculateBillingAgreementChangePreview({
          change,
          sourceContext: contexts.source,
          targetContext: contexts.target,
          now: now(),
          previewTtlMs,
        });
        if (contexts.source.agreement.version !== input.expectedAgreementVersion) {
          throw new BillingAgreementError('AGREEMENT_VERSION_CONFLICT', 'O acordo foi alterado após o preview.');
        }
        if (freshPreview.previewHash !== input.previewHash || freshPreview.blockers.length > 0) {
          throw new BillingAgreementError('PREVIEW_MISMATCH', 'O cenário financeiro mudou; gere um novo preview.', {
            blockers: freshPreview.blockers,
          });
        }
        if (existing?.status === 'REQUIRES_RECONCILIATION') {
          return {
            operationId: existing.id,
            uiRequestId: existing.uiRequestId,
            status: 'REQUIRES_RECONCILIATION' as const,
            agreementIds,
            resultingAmountsCents: Object.fromEntries(
              freshPreview.plans.map((plan) => [plan.agreementId, plan.resultingAmountCents]),
            ),
            versions: Object.fromEntries(
              freshPreview.plans.map((plan) => [plan.agreementId, plan.sourceVersion]),
            ),
            adjustments: freshPreview.adjustments,
            remoteProgress: existing.remoteProgress,
            correlationId: existing.correlationId,
          };
        }

        const correlationId = existing?.correlationId ?? createCorrelationId();
        const reserved = existing
          ? { outcome: 'EXISTING' as const, operation: existing }
          : await deps.repository.reserveOperation({
              contaId: change.contaId,
              uiRequestId: input.uiRequestId,
              requestFingerprint: fingerprint,
              correlationId,
              change,
              preview: freshPreview,
            });
        if (reserved.outcome === 'CONFLICT') {
          throw new BillingAgreementError('IDEMPOTENCY_CONFLICT', 'Conflito de idempotência financeira.');
        }
        const operation = reserved.operation;
        let progress = [...operation.remoteProgress];
        try {
          for (const plan of freshPreview.plans) {
            const context =
              plan.agreementId === contexts.source.agreement.id ? contexts.source : contexts.target;
            if (!context) {
              throw new BillingAgreementError('TARGET_AGREEMENT_NOT_FOUND', 'Acordo de destino não encontrado.');
            }
            const confirmed = await executeRemotePlan({
              deps,
              contaId: change.contaId,
              context,
              plan,
              change: input,
              operationId: operation.id,
              progress,
              onProgress: async (nextProgress) => {
                progress = nextProgress;
                await deps.repository.recordRemoteProgress({
                  contaId: change.contaId,
                  operationId: operation.id,
                  progress,
                });
              },
            });
            progress = [
              ...progress.filter((item) => item.agreementId !== confirmed.agreementId),
              confirmed,
            ];
            await deps.repository.recordRemoteProgress({
              contaId: change.contaId,
              operationId: operation.id,
              progress,
            });
          }
          const expectedVersions = Object.fromEntries(
            freshPreview.plans.map((plan) => [plan.agreementId, plan.sourceVersion]),
          );
          const result = await deps.repository.applyConfirmedChange({
            contaId: change.contaId,
            operationId: operation.id,
            change,
            preview: freshPreview,
            expectedVersions,
            remoteProgress: progress,
            adjustments: freshPreview.adjustments,
            correlationId,
          });
          await deps.audit.record({
            contaId: change.contaId,
            actorId: change.actorId,
            correlationId,
            action: `billing_agreement.${change.kind.toLowerCase()}`,
            entityIds: agreementIds,
            metadata: {
              reason: change.reason,
              uiRequestId: input.uiRequestId,
              previousAmountCents: freshPreview.currentAmountCents,
              resultingAmountCents: freshPreview.resultingAmountCents,
            },
          });
          return result;
        } catch (error) {
          const uncertain = isUncertainRemoteError(error) ||
            error instanceof BillingAgreementError && error.code === 'REMOTE_OPERATION_UNCERTAIN' ||
            progress.some((item) => item.confirmed || item.resultingSubscriptionId !== item.previousSubscriptionId);
          if (uncertain) {
            await deps.repository.markOperationUncertain({
              contaId: change.contaId,
              operationId: operation.id,
              errorCode: error instanceof BillingAgreementError ? error.code : 'REMOTE_OPERATION_UNCERTAIN',
              errorMessage: error instanceof Error ? error.message : String(error),
              remoteProgress: progress,
            });
            return {
              operationId: operation.id,
              uiRequestId: input.uiRequestId,
              status: 'REQUIRES_RECONCILIATION' as const,
              agreementIds,
              resultingAmountsCents: Object.fromEntries(
                freshPreview.plans.map((plan) => [plan.agreementId, plan.resultingAmountCents]),
              ),
              versions: Object.fromEntries(
                freshPreview.plans.map((plan) => [plan.agreementId, plan.sourceVersion]),
              ),
              adjustments: freshPreview.adjustments,
              remoteProgress: progress,
              correlationId,
            };
          }
          await deps.repository.markOperationFailed({
            contaId: change.contaId,
            operationId: operation.id,
            errorCode: error instanceof BillingAgreementError ? error.code : 'REMOTE_OPERATION_FAILED',
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    });
    if (!locked.acquired) {
      throw new BillingAgreementError('OPERATION_BUSY', 'Outra operação está alterando este acordo.');
    }
    return locked.result;
  }

  return { preview, commit, getAgreement };
}

function activeAgreementAllocationTotal(context: BillingAgreementContext, at: string): number {
  return sumMoneyCents(
    context.allocations
      .filter(
        (allocation) =>
          allocation.recurring &&
          (allocation.status === 'ACTIVE' || allocation.status === 'SCHEDULED') &&
          allocation.validFrom <= at &&
          (allocation.validUntil === null || allocation.validUntil > at),
      )
      .map((allocation) => allocation.netAmountCents),
  );
}

export async function previewBillingAgreementChangeWithDependencies(
  input: BillingAgreementChangeInput,
  deps: BillingAgreementLifecycleDependencies,
): Promise<BillingAgreementChangePreview> {
  return createBillingAgreementLifecycleService(deps).preview(input);
}

export async function commitBillingAgreementChangeWithDependencies(
  input: CommitBillingAgreementChangeInput,
  deps: BillingAgreementLifecycleDependencies,
): Promise<BillingAgreementChangeResult> {
  return createBillingAgreementLifecycleService(deps).commit(input);
}

export async function getBillingAgreementViewWithDependencies(
  input: { contaId: string; agreementId: string },
  deps: BillingAgreementLifecycleDependencies,
): Promise<BillingAgreementView> {
  return createBillingAgreementLifecycleService(deps).getAgreement(input);
}
