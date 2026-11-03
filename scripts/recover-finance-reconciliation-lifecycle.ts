import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getPayment, getSubscription, listPayments } from '../packages/asaas/src';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';
import {
  classifyPreviewedExternalSubscription,
  previewExternalSubscriptionCandidates,
} from '../packages/finance/src/reconciliation/asaas-resource-origin.service';
import { acquireWebhookJobLock, releaseWebhookJobLock, renewWebhookJobLock } from '../packages/finance/src/foundation/webhook-job-lock.service';
import { reconcileWithAsaas } from '../packages/finance/src/webhooks/webhook-reconciliation.service';
import { assertCompleteAsaasPage } from '../packages/finance/src/use-cases/asaas-pagination';
import { resolvePaymentSubscriptionWebhookEvidence } from '../packages/finance/src/reconciliation/payment-subscription-webhook-evidence';

type Manifest = {
  version: 1;
  contaId: string;
  reviewedAt: string;
  reason: string;
  approvedExternalSubscriptionIds: string[];
  approvedExternalPaymentIds: string[];
  openIssues: Array<{
    id: string; issueType: string; entityType: string; entityId: string | null;
    asaasId: string | null; lastSeenAt: string;
  }>;
  externalEvidence: Array<{
    issueId: string; paymentId: string; subscriptionIds: string[];
    descriptions: string[]; externalReferences: string[];
  }>;
  reviewedHistoricalPayments?: Array<{
    issueId: string; paymentId: string; subscriptionId: string;
    externalReference: string; reason: string;
    expectedStatus: 'RECEIVED_IN_CASH'; expectedValue: number;
    expectedDueDate: string; expectedPaymentDate: string;
    expectedIssueReason: 'alusa_subscription_without_local_entity';
    expectedIssueLastSeenAt: string; expectedCauseId: string;
  }>;
};

type RecoveryAuditContext = { operatorLabel: string; runId: string };
type RecoveryOptions = { manifestPath: string; apply: boolean; auditContext: RecoveryAuditContext };

function readOptions(argv: string[]): RecoveryOptions {
  const valueAfter = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const manifestPath = valueAfter('--manifest');
  if (!manifestPath) throw new Error('Uso: pnpm finance:recover-reconciliation -- --manifest <arquivo> [--operator <rótulo>] [--apply]');
  const operatorLabel = valueAfter('--operator')?.trim() || '';
  const apply = argv.includes('--apply');
  if (apply && !operatorLabel) throw new Error('Modo apply exige --operator <rótulo-operacional> para auditoria SYSTEM.');
  return {
    manifestPath,
    apply,
    auditContext: { operatorLabel: operatorLabel.slice(0, 120), runId: randomUUID() },
  };
}

function auditFields(context: RecoveryAuditContext) {
  return { actorType: 'SYSTEM' as const, actorId: null, correlationId: context.runId };
}

function auditMetadata(context: RecoveryAuditContext) {
  return { operatorLabel: context.operatorLabel, runId: context.runId };
}

function assertUniqueIds(label: string, values: string[]): void {
  if (values.some((value) => !value.trim()) || new Set(values).size !== values.length) {
    throw new Error(`Manifesto inválido: ${label} deve conter IDs não vazios e sem duplicatas.`);
  }
}

function validateManifest(manifest: Manifest): void {
  if (manifest.version !== 1 || !manifest.contaId || !manifest.reason || !manifest.reviewedAt) {
    throw new Error('Manifesto inválido: versão, tenant, revisão e justificativa são obrigatórios.');
  }
  assertUniqueIds('approvedExternalSubscriptionIds', manifest.approvedExternalSubscriptionIds);
  assertUniqueIds('approvedExternalPaymentIds', manifest.approvedExternalPaymentIds);
  if (manifest.approvedExternalSubscriptionIds.length > 100 || manifest.approvedExternalPaymentIds.length > 120 || manifest.openIssues.length > 300) {
    throw new Error('Manifesto excede o limite operacional desta recuperação tenant-scoped.');
  }
  const approvedSubscriptions = new Set(manifest.approvedExternalSubscriptionIds);
  const approvedPayments = new Set(manifest.approvedExternalPaymentIds);
  const evidencePayments = new Set(manifest.externalEvidence.map((item) => item.paymentId));
  if (approvedPayments.size !== evidencePayments.size || [...approvedPayments].some((id) => !evidencePayments.has(id))) {
    throw new Error('Manifesto inválido: cada pagamento externo aprovado precisa de evidência exata.');
  }
  for (const evidence of manifest.externalEvidence) {
    if (!evidence.issueId || !evidence.descriptions.length || evidence.subscriptionIds.length !== 1 || !approvedSubscriptions.has(evidence.subscriptionIds[0])) {
      throw new Error(`Manifesto inválido: vínculo ou descrição ausente para ${evidence.paymentId}.`);
    }
  }
  for (const historical of manifest.reviewedHistoricalPayments ?? []) {
    if (!historical.issueId || !historical.paymentId || !historical.subscriptionId || !historical.externalReference || !historical.reason.trim() ||
        historical.expectedStatus !== 'RECEIVED_IN_CASH' || !Number.isFinite(historical.expectedValue) || historical.expectedValue <= 0 ||
        !historical.expectedDueDate || !historical.expectedPaymentDate || historical.expectedIssueReason !== 'alusa_subscription_without_local_entity' ||
        !historical.expectedIssueLastSeenAt || !historical.expectedCauseId) {
      throw new Error('Manifesto inválido: disposição histórica exige snapshot remoto, causa e versão da issue aprovados.');
    }
  }
}

async function listSubscriptionPreviews(contaId: string) {
  const previews = new Map<string, { eligible: boolean; conflict: string | null }>();
  let cursor: string | null = null;
  do {
    const page = await previewExternalSubscriptionCandidates({ contaId, pageSize: 50, cursor });
    for (const item of page.items) previews.set(item.subscriptionId, { eligible: item.eligible, conflict: item.conflict });
    cursor = page.nextCursor;
  } while (cursor);
  return previews;
}

async function hasLocalPaymentLink(contaId: string, paymentId: string, db: Prisma.TransactionClient = prisma, entityId?: string | null): Promise<boolean> {
  const byIdAndPayment = { OR: [...(entityId ? [{ id: entityId }] : []), { asaasPaymentId: paymentId }] };
  const [charge, cobranca, pagamento] = await Promise.all([
    db.charge.findFirst({ where: { contaId, ...byIdAndPayment }, select: { id: true } }),
    db.cobranca.findFirst({ where: { contaId, OR: [...(entityId ? [{ id: entityId }] : []), { asaasPaymentId: paymentId }, { asaasId: paymentId }] }, select: { id: true } }),
    db.pagamento.findFirst({ where: { contaId, ...byIdAndPayment }, select: { id: true } }),
  ]);
  return Boolean(charge || cobranca || pagamento);
}

async function assertNoLocalPaymentLink(contaId: string, paymentId: string): Promise<void> {
  if (await hasLocalPaymentLink(contaId, paymentId)) throw new Error(`Pagamento ${paymentId} possui vínculo financeiro local; interrompido.`);
}

async function hasLocalSubscriptionLink(contaId: string, subscriptionId: string, db: Prisma.TransactionClient = prisma, entityId?: string | null): Promise<boolean> {
  const byIdAndSubscription = { OR: [...(entityId ? [{ id: entityId }] : []), { asaasSubscriptionId: subscriptionId }] };
  const [subscription, standalone, agreement, matricula, operation, futureAgreement] = await Promise.all([
    db.subscription.findFirst({ where: { contaId, ...byIdAndSubscription }, select: { id: true } }),
    db.standaloneSubscription.findFirst({ where: { contaId, ...byIdAndSubscription }, select: { id: true } }),
    db.billingAgreement.findFirst({ where: { contaId, ...byIdAndSubscription }, select: { id: true } }),
    db.matricula.findFirst({ where: { contaId, ...byIdAndSubscription }, select: { id: true } }),
    db.enrollmentCreationOperation.findFirst({ where: { contaId, asaasSubscriptionId: subscriptionId }, select: { id: true } }),
    db.acordoFinanceiroFuturo.findFirst({ where: { contaId, asaasSubscriptionId: subscriptionId }, select: { id: true } }),
  ]);
  return Boolean(subscription || standalone || agreement || matricula || operation || futureAgreement);
}

async function validateApprovedExternalPayment(input: {
  apiKey: string; evidence: Manifest['externalEvidence'][number]; approvedSubscriptionIds: string[];
}): Promise<void> {
  const payment = await getPayment({ apiKey: input.apiKey, paymentId: input.evidence.paymentId });
  const expectedSubscriptionId = input.evidence.subscriptionIds[0];
  const knownDescriptions = new Set(input.evidence.descriptions.map((description) => description.trim()));
  const knownReferences = input.evidence.externalReferences;
  if (payment.id !== input.evidence.paymentId || payment.subscription !== expectedSubscriptionId ||
      !input.approvedSubscriptionIds.includes(expectedSubscriptionId) || !knownDescriptions.has(payment.description?.trim() ?? '') ||
      (knownReferences.length > 0 ? !knownReferences.includes(payment.externalReference ?? '') : Boolean(payment.externalReference))) {
    throw new Error(`Identidade, assinatura, descrição ou referência do pagamento ${input.evidence.paymentId} mudou desde a revisão.`);
  }
}

export async function resolveExternalChildReview(input: {
  manifest: Manifest; evidence: Manifest['externalEvidence'][number]; requireClassified?: boolean;
}): Promise<'READY' | 'ALREADY_RESOLVED' | 'SKIPPED_STALE'> {
  const issue = await prisma.financeReconciliationIssue.findFirst({
    where: { id: input.evidence.issueId, contaId: input.manifest.contaId },
  });
  if (!issue || issue.issueType !== 'PAYMENT_NEEDS_REVIEW' || issue.entityType !== 'PAYMENT' || issue.asaasId !== input.evidence.paymentId) {
    throw new Error(`Issue ${input.evidence.issueId} não corresponde à evidência aprovada.`);
  }
  if (issue.status === 'RESOLVED' && issue.resolution === 'Pagamento vinculado à assinatura explicitamente classificada EXTERNAL; sem replay financeiro.') {
    return 'ALREADY_RESOLVED';
  }
  if (issue.status !== 'OPEN') return 'SKIPPED_STALE';
  const metadata = issue.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
    ? issue.metadata as Record<string, unknown> : {};
  const causeId = typeof metadata.lastCauseId === 'string' ? metadata.lastCauseId : null;
  if (metadata.reason !== 'resource_origin_unknown' || !causeId) throw new Error(`Issue ${issue.id} não é uma revisão de origem desconhecida válida.`);
  const subscriptionId = input.evidence.subscriptionIds[0];
  const canonicalEventId = await resolvePaymentSubscriptionWebhookEvidence(prisma, {
    contaId: input.manifest.contaId, paymentId: input.evidence.paymentId, subscriptionId, causeId,
    event: typeof metadata.event === 'string' ? metadata.event : '',
  });
  if (!canonicalEventId) {
    throw new Error(`Issue ${issue.id} não possui evento com vínculo exato à assinatura aprovada.`);
  }
  const classification = await prisma.asaasResourceOrigin.findUnique({
    where: { uq_asaas_resource_origin_tenant_resource: {
      contaId: input.manifest.contaId, resourceType: 'SUBSCRIPTION', asaasId: subscriptionId,
    } },
    select: { origin: true },
  });
  if (input.requireClassified !== false && classification?.origin !== 'EXTERNAL') throw new Error(`Assinatura ${subscriptionId} não está classificada como externa.`);
  await assertNoLocalPaymentLink(input.manifest.contaId, input.evidence.paymentId);
  return 'READY';
}

export async function resolveHistoricalPayment(input: {
  manifest: Manifest; item: NonNullable<Manifest['reviewedHistoricalPayments']>[number];
  apiKey: string; auditContext: RecoveryAuditContext; apply: boolean;
}): Promise<'READY' | 'RESOLVED' | 'ALREADY_RESOLVED' | 'SKIPPED_STALE'> {
  const payment = await getPayment({ apiKey: input.apiKey, paymentId: input.item.paymentId });
  const subscription = await getSubscription({ apiKey: input.apiKey, subscriptionId: input.item.subscriptionId });
  if (payment.id !== input.item.paymentId || payment.subscription !== input.item.subscriptionId ||
      payment.status !== input.item.expectedStatus || Number(payment.value) !== input.item.expectedValue ||
      payment.dueDate !== input.item.expectedDueDate || payment.paymentDate !== input.item.expectedPaymentDate || payment.deleted ||
      payment.externalReference !== input.item.externalReference || !subscription.deleted || subscription.status !== 'INACTIVE') {
    throw new Error(`Evidência remota do pagamento histórico ${input.item.paymentId} não confere com o manifesto.`);
  }
  await assertNoLocalPaymentLink(input.manifest.contaId, input.item.paymentId);
  if (await hasLocalSubscriptionLink(input.manifest.contaId, input.item.subscriptionId)) {
    throw new Error(`Assinatura histórica ${input.item.subscriptionId} possui vínculo local; interrompido.`);
  }
  const issue = await prisma.financeReconciliationIssue.findFirst({
    where: { id: input.item.issueId, contaId: input.manifest.contaId },
  });
  if (!issue || issue.issueType !== 'PAYMENT_MISSING_LOCAL_ENTITY' || issue.asaasId !== input.item.paymentId || issue.status !== 'OPEN') {
    return issue?.status === 'RESOLVED' && issue.resolution?.includes('histórico de matrícula encerrada') ? 'ALREADY_RESOLVED' : 'SKIPPED_STALE';
  }
  const manifestIssue = input.manifest.openIssues.find((candidate) => candidate.id === input.item.issueId);
  if (!manifestIssue || manifestIssue.issueType !== 'PAYMENT_MISSING_LOCAL_ENTITY' || manifestIssue.asaasId !== input.item.paymentId ||
      manifestIssue.lastSeenAt !== input.item.expectedIssueLastSeenAt) {
    throw new Error(`Issue histórica ${issue.id} não consta na lista revisada do manifesto.`);
  }
  const metadata = issue.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
    ? issue.metadata as Record<string, unknown> : {};
  const causeId = typeof metadata.lastCauseId === 'string' ? metadata.lastCauseId : null;
  if (metadata.reason !== input.item.expectedIssueReason || causeId !== input.item.expectedCauseId ||
      issue.lastSeenAt.toISOString() !== input.item.expectedIssueLastSeenAt) {
    throw new Error(`Issue ${issue.id} mudou de motivo, causa ou versão desde a revisão.`);
  }
  if (!input.apply) return 'READY';
  return prisma.$transaction(async (tx) => {
    if (await hasLocalPaymentLink(input.manifest.contaId, input.item.paymentId, tx) ||
        await hasLocalSubscriptionLink(input.manifest.contaId, input.item.subscriptionId, tx)) return 'SKIPPED_STALE';
    const changed = await tx.financeReconciliationIssue.updateMany({
      where: {
        id: issue.id, contaId: input.manifest.contaId, status: 'OPEN',
        issueType: 'PAYMENT_MISSING_LOCAL_ENTITY', asaasId: input.item.paymentId,
        lastSeenAt: issue.lastSeenAt,
        AND: [
          { metadata: { path: ['lastCauseId'], equals: causeId } },
          { metadata: { path: ['reason'], equals: input.item.expectedIssueReason } },
        ],
      },
      data: {
        status: 'RESOLVED', resolvedAt: new Date(),
        resolution: `Operador confirmou histórico de matrícula encerrada: ${input.item.reason.trim()}`.slice(0, 1000),
      },
    });
    if (changed.count === 0) return 'SKIPPED_STALE';
    await tx.auditLog.create({
      data: {
        contaId: input.manifest.contaId, ...auditFields(input.auditContext),
        action: 'finance.reconciliation_issue.resolved', entityType: 'FinanceReconciliationIssue', entityId: issue.id,
        metadata: {
          issueType: issue.issueType, entityType: issue.entityType, entityId: issue.entityId,
          asaasId: issue.asaasId, resolution: 'HISTORICAL_CANCELED_ENROLLMENT_NO_LOCAL_RECONSTRUCTION',
          subscriptionId: input.item.subscriptionId, subscriptionStatus: subscription.status,
          subscriptionDeleted: subscription.deleted ?? false,
          paymentStatus: payment.status, paymentDeleted: payment.deleted,
          paymentValue: payment.value, dueDate: payment.dueDate, paymentDate: payment.paymentDate,
          externalReference: input.item.externalReference, causeId,
          ...auditMetadata(input.auditContext),
        },
      },
    });
    return 'RESOLVED';
  }, { isolationLevel: 'Serializable' });
}

export async function resolveAbsentTerminalLagIssue(input: {
  manifest: Manifest; issueManifest: Manifest['openIssues'][number]; apiKey: string; auditContext: RecoveryAuditContext; apply: boolean;
}): Promise<'READY' | 'RESOLVED' | 'ALREADY_RESOLVED' | 'SKIPPED_STALE'> {
  const issue = await prisma.financeReconciliationIssue.findFirst({
    where: { id: input.issueManifest.id, contaId: input.manifest.contaId },
  });
  if (!issue || issue.issueType !== 'WEBHOOK_LAG' || issue.entityType !== input.issueManifest.entityType ||
      issue.entityId !== input.issueManifest.entityId || issue.asaasId !== input.issueManifest.asaasId || !issue.asaasId) {
    throw new Error(`Issue de atraso ${input.issueManifest.id} não corresponde ao manifesto.`);
  }
  const resolution = 'Recurso Asaas terminal confirmado e ausência da entidade local validada; sem reconstrução financeira.';
  if (issue.status === 'RESOLVED' && issue.resolution === resolution) return 'ALREADY_RESOLVED';
  if (issue.status !== 'OPEN') return 'SKIPPED_STALE';
  const manifestIssue = input.manifest.openIssues.find((candidate) => candidate.id === input.issueManifest.id);
  if (!manifestIssue || manifestIssue.issueType !== 'WEBHOOK_LAG' || manifestIssue.asaasId !== issue.asaasId ||
      manifestIssue.lastSeenAt !== issue.lastSeenAt.toISOString()) {
    throw new Error(`Issue ${issue.id} mudou desde a revisão do manifesto.`);
  }

  let remoteTerminal = false;
  let providerEvidence: { remoteStatus: string; deleted: boolean };
  let resourceType: 'PAYMENT' | 'SUBSCRIPTION';
  if (issue.entityType === 'CHARGE') {
    resourceType = 'PAYMENT';
    const payment = await getPayment({ apiKey: input.apiKey, paymentId: issue.asaasId });
    if (payment.id !== issue.asaasId) throw new Error(`ID remoto do pagamento ${issue.asaasId} não confere.`);
    remoteTerminal = payment.deleted || payment.status === 'DELETED';
    providerEvidence = { remoteStatus: payment.status, deleted: payment.deleted };
    const local = await Promise.all([
      prisma.charge.findFirst({ where: { contaId: input.manifest.contaId, OR: [...(issue.entityId ? [{ id: issue.entityId }] : []), { asaasPaymentId: issue.asaasId }] }, select: { id: true } }),
      prisma.cobranca.findFirst({ where: { contaId: input.manifest.contaId, OR: [...(issue.entityId ? [{ id: issue.entityId }] : []), { asaasPaymentId: issue.asaasId }, { asaasId: issue.asaasId }] }, select: { id: true } }),
      prisma.pagamento.findFirst({ where: { contaId: input.manifest.contaId, asaasPaymentId: issue.asaasId }, select: { id: true } }),
    ]);
    if (local.some(Boolean)) return 'SKIPPED_STALE';
  } else if (issue.entityType === 'SUBSCRIPTION') {
    resourceType = 'SUBSCRIPTION';
    const subscription = await getSubscription({ apiKey: input.apiKey, subscriptionId: issue.asaasId });
    if (subscription.id !== issue.asaasId) throw new Error(`ID remoto da assinatura ${issue.asaasId} não confere.`);
    remoteTerminal = Boolean(subscription.deleted) && subscription.status === 'INACTIVE';
    providerEvidence = { remoteStatus: subscription.status, deleted: Boolean(subscription.deleted) };
    const local = await Promise.all([
      prisma.subscription.findFirst({ where: { contaId: input.manifest.contaId, OR: [...(issue.entityId ? [{ id: issue.entityId }] : []), { asaasSubscriptionId: issue.asaasId }] }, select: { id: true } }),
      prisma.standaloneSubscription.findFirst({ where: { contaId: input.manifest.contaId, OR: [...(issue.entityId ? [{ id: issue.entityId }] : []), { asaasSubscriptionId: issue.asaasId }] }, select: { id: true } }),
      prisma.billingAgreement.findFirst({ where: { contaId: input.manifest.contaId, OR: [...(issue.entityId ? [{ id: issue.entityId }] : []), { asaasSubscriptionId: issue.asaasId }] }, select: { id: true } }),
      prisma.matricula.findFirst({ where: { contaId: input.manifest.contaId, OR: [...(issue.entityId ? [{ id: issue.entityId }] : []), { asaasSubscriptionId: issue.asaasId }] }, select: { id: true } }),
      prisma.enrollmentCreationOperation.findFirst({ where: { contaId: input.manifest.contaId, asaasSubscriptionId: issue.asaasId }, select: { id: true } }),
      prisma.acordoFinanceiroFuturo.findFirst({ where: { contaId: input.manifest.contaId, asaasSubscriptionId: issue.asaasId }, select: { id: true } }),
    ]);
    if (local.some(Boolean)) return 'SKIPPED_STALE';
  } else {
    return 'SKIPPED_STALE';
  }
  if (!remoteTerminal) throw new Error(`Recurso ${issue.asaasId} ainda não está terminal no Asaas.`);
  if (!input.apply) return 'READY';

  return prisma.$transaction(async (tx) => {
    const ownerExists = resourceType === 'PAYMENT'
      ? await hasLocalPaymentLink(input.manifest.contaId, issue.asaasId!, tx, issue.entityId)
      : await hasLocalSubscriptionLink(input.manifest.contaId, issue.asaasId!, tx, issue.entityId);
    if (ownerExists) return 'SKIPPED_STALE';
    const changed = await tx.financeReconciliationIssue.updateMany({
      where: {
        id: issue.id, contaId: input.manifest.contaId, issueType: 'WEBHOOK_LAG',
        entityType: issue.entityType, entityId: issue.entityId, asaasId: issue.asaasId,
        status: 'OPEN', lastSeenAt: issue.lastSeenAt,
      },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolution },
    });
    if (changed.count === 0) return 'SKIPPED_STALE';
    await tx.auditLog.create({ data: {
      contaId: input.manifest.contaId, ...auditFields(input.auditContext),
      action: 'finance.reconciliation_issue.resolved', entityType: 'FinanceReconciliationIssue', entityId: issue.id,
      metadata: {
        issueType: issue.issueType, entityType: issue.entityType, entityId: issue.entityId,
        asaasId: issue.asaasId, resourceType,
        ...providerEvidence,
        resolution: 'ABSENT_LOCAL_ENTITY_AND_REMOTE_TERMINAL_VERIFIED',
        ...auditMetadata(input.auditContext),
      },
    } });
    return 'RESOLVED';
  }, { isolationLevel: 'Serializable' });
}

export async function resolveAlreadyLinkedPaymentIssue(input: {
  manifest: Manifest; issueManifest: Manifest['openIssues'][number]; apiKey: string; auditContext: RecoveryAuditContext; apply: boolean;
}): Promise<'READY' | 'RESOLVED' | 'ALREADY_RESOLVED' | 'SKIPPED_STALE'> {
  const issue = await prisma.financeReconciliationIssue.findFirst({
    where: { id: input.issueManifest.id, contaId: input.manifest.contaId },
  });
  if (!issue || issue.issueType !== 'PAYMENT_MISSING_LOCAL_ENTITY' || issue.asaasId !== input.issueManifest.asaasId || !issue.asaasId) {
    throw new Error(`Issue de entidade local ausente ${input.issueManifest.id} não corresponde ao manifesto.`);
  }
  const resolution = 'Entidade Charge/Cobranca existente confirmada pela referência canônica da operação de matrícula.';
  if (issue.status === 'RESOLVED' && issue.resolution === resolution) return 'ALREADY_RESOLVED';
  if (issue.status !== 'OPEN') return 'SKIPPED_STALE';
  const manifestIssue = input.manifest.openIssues.find((candidate) => candidate.id === input.issueManifest.id);
  if (!manifestIssue || manifestIssue.issueType !== 'PAYMENT_MISSING_LOCAL_ENTITY' || manifestIssue.asaasId !== issue.asaasId ||
      manifestIssue.lastSeenAt !== issue.lastSeenAt.toISOString()) {
    throw new Error(`Issue ${issue.id} mudou desde a revisão do manifesto.`);
  }
  const metadata = issue.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
    ? issue.metadata as Record<string, unknown> : {};
  if (metadata.manualRepair !== true || typeof metadata.resolvedLocalEntityId !== 'string') {
    throw new Error(`Issue ${issue.id} não contém decisão prévia de reparo manual validável.`);
  }
  const [charge, cobranca] = await Promise.all([
    prisma.charge.findFirst({
      where: { contaId: input.manifest.contaId, asaasPaymentId: issue.asaasId },
      select: { id: true, cobrancaId: true, externalReference: true, status: true },
    }),
    prisma.cobranca.findFirst({
      where: { contaId: input.manifest.contaId, OR: [{ asaasPaymentId: issue.asaasId }, { asaasId: issue.asaasId }] },
      select: { id: true, asaasPaymentId: true, asaasId: true, status: true },
    }),
  ]);
  const referenceMatch = charge?.externalReference.match(/^enrollment-op:([^:]+):(subscription|fee)$/);
  if (!charge || !cobranca || charge.cobrancaId !== cobranca.id || metadata.resolvedLocalEntityId !== cobranca.id || !referenceMatch ||
      charge.status !== 'OPEN' || cobranca.status !== 'PENDENTE') {
    throw new Error(`Pagamento ${issue.asaasId} não possui vínculo canônico Charge/Cobranca inequívoco.`);
  }
  const operationId = referenceMatch[1];
  const operationPaymentField = referenceMatch[2] === 'fee' ? 'asaasEnrollmentFeePaymentId' : 'asaasFirstPaymentId';
  const operation = await prisma.enrollmentCreationOperation.findFirst({
    where: {
      id: operationId, contaId: input.manifest.contaId,
      ...(operationPaymentField === 'asaasEnrollmentFeePaymentId'
        ? { asaasEnrollmentFeePaymentId: issue.asaasId }
        : { asaasFirstPaymentId: issue.asaasId }),
    },
    select: { id: true, asaasFirstPaymentId: true, asaasEnrollmentFeePaymentId: true },
  });
  if (!operation) {
    throw new Error(`Referência canônica ${charge.externalReference} não aponta para operação tenant-scoped correspondente.`);
  }
  const payment = await getPayment({ apiKey: input.apiKey, paymentId: issue.asaasId });
  if (payment.id !== issue.asaasId || payment.externalReference !== charge.externalReference || payment.status !== 'PENDING' || payment.deleted) {
    throw new Error(`GET remoto do pagamento ${issue.asaasId} diverge da referência canônica local.`);
  }
  if (!input.apply) return 'READY';
  const causeId = typeof metadata.lastCauseId === 'string' ? metadata.lastCauseId : null;
  if (!causeId) throw new Error(`Issue ${issue.id} não possui causa original para resolução condicional.`);
  return prisma.$transaction(async (tx) => {
    const currentCharge = await tx.charge.findFirst({
      where: { id: charge.id, contaId: input.manifest.contaId, asaasPaymentId: issue.asaasId },
      select: { id: true, cobrancaId: true, externalReference: true, status: true },
    });
    const currentCobranca = await tx.cobranca.findFirst({
      where: { id: cobranca.id, contaId: input.manifest.contaId, OR: [{ asaasPaymentId: issue.asaasId }, { asaasId: issue.asaasId }] },
      select: { id: true, asaasPaymentId: true, asaasId: true, status: true },
    });
    if (!currentCharge || !currentCobranca || currentCharge.cobrancaId !== currentCobranca.id ||
        currentCharge.externalReference !== charge.externalReference || currentCharge.status !== 'OPEN' || currentCobranca.status !== 'PENDENTE') {
      return 'SKIPPED_STALE';
    }
    const changed = await tx.financeReconciliationIssue.updateMany({
      where: {
        id: issue.id, contaId: input.manifest.contaId, status: 'OPEN',
        issueType: 'PAYMENT_MISSING_LOCAL_ENTITY', asaasId: issue.asaasId,
        lastSeenAt: issue.lastSeenAt,
        AND: [
          { metadata: { path: ['lastCauseId'], equals: causeId } },
          { metadata: { path: ['manualRepair'], equals: true } },
          { metadata: { path: ['resolvedLocalEntityId'], equals: cobranca.id } },
        ],
      },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolution },
    });
    if (changed.count === 0) return 'SKIPPED_STALE';
    await tx.auditLog.create({ data: {
      contaId: input.manifest.contaId, ...auditFields(input.auditContext),
      action: 'finance.reconciliation_issue.resolved', entityType: 'FinanceReconciliationIssue', entityId: issue.id,
      metadata: {
        issueType: issue.issueType, asaasId: issue.asaasId, chargeId: charge.id,
        cobrancaId: cobranca.id, enrollmentCreationOperationId: operation.id,
        externalReference: charge.externalReference,
        resolution: 'EXISTING_CANONICAL_FINANCIAL_ENTITIES_CONFIRMED',
        ...auditMetadata(input.auditContext),
      },
    } });
    return 'RESOLVED';
  }, { isolationLevel: 'Serializable' });
}

export async function resolveVerifiedEventCancellation(input: {
  manifest: Manifest; issueManifest: Manifest['openIssues'][number];
  apiKey: string; auditContext: RecoveryAuditContext; apply: boolean;
}): Promise<'READY' | 'RESOLVED' | 'ALREADY_RESOLVED' | 'SKIPPED_STALE'> {
  const issue = await prisma.financeReconciliationIssue.findFirst({
    where: { id: input.issueManifest.id, contaId: input.manifest.contaId },
  });
  if (!issue || issue.issueType !== 'BILLING_OPERATION_UNCERTAIN' || issue.entityType !== 'PAYMENT' ||
      issue.asaasId !== input.issueManifest.asaasId || !issue.entityId || issue.entityId !== input.issueManifest.entityId) {
    throw new Error(`Issue de operação ${input.issueManifest.id} não corresponde ao manifesto.`);
  }
  const metadata = issue.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
    ? issue.metadata as Record<string, unknown> : {};
  const orderId = issue.entityId;
  const paymentId = issue.asaasId;
  const externalReference = `event-map-order:${orderId}`;
  if (!paymentId || metadata.orderId !== orderId || metadata.paymentId !== paymentId || metadata.externalReference !== externalReference) {
    throw new Error(`Issue ${issue.id} não contém identidade exata de pedido e pagamento de evento.`);
  }
  if (issue.status === 'RESOLVED' && issue.resolution === 'Pedido de evento cancelado e pagamento Asaas excluído confirmado por identidade exata.') return 'ALREADY_RESOLVED';
  if (issue.status !== 'OPEN') return 'SKIPPED_STALE';
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, contaId: input.manifest.contaId },
    select: { id: true, status: true, asaasPaymentId: true, paymentProvider: true },
  });
  if (!order || !['CANCELLED', 'EXPIRED'].includes(order.status) || order.asaasPaymentId !== paymentId || order.paymentProvider !== 'ASAAS') {
    throw new Error(`Pedido ${orderId} não está encerrado com o mesmo pagamento Asaas.`);
  }
  const payment = await getPayment({ apiKey: input.apiKey, paymentId });
  if (payment.id !== paymentId || payment.externalReference !== externalReference || (!payment.deleted && payment.status !== 'DELETED')) {
    throw new Error(`Pagamento remoto ${paymentId} não está excluído com a referência exata do pedido.`);
  }
  const pageSize = 100;
  let offset = 0;
  let totalCount: number | undefined;
  const referencePayments = [] as Awaited<ReturnType<typeof listPayments>>['data'];
  do {
    const page = await listPayments({ apiKey: input.apiKey, externalReference, offset, limit: pageSize, includeDeleted: true });
    totalCount = assertCompleteAsaasPage(page, offset, pageSize, totalCount);
    referencePayments.push(...page.data);
    offset += page.data.length;
    if (page.hasMore && page.data.length === 0) throw new Error('Busca completa da referência de evento retornou página vazia.');
    if (!page.hasMore) break;
  } while (offset < (totalCount ?? 0));
  if (referencePayments.length !== 1 || referencePayments[0]?.id !== paymentId ||
      (!referencePayments[0]?.deleted && referencePayments[0]?.status !== 'DELETED')) {
    throw new Error(`A referência ${externalReference} não possui um único pagamento remoto excluído comprovado.`);
  }
  if (!input.apply) return 'READY';
  const causeId = typeof metadata.lastCauseId === 'string' ? metadata.lastCauseId : null;
  if (!causeId) throw new Error(`Issue ${issue.id} não possui causa para resolução condicional.`);
  return prisma.$transaction(async (tx) => {
    const currentOrder = await tx.eventMapOrder.findFirst({
      where: { id: orderId, contaId: input.manifest.contaId },
      select: { id: true, status: true, asaasPaymentId: true, paymentProvider: true },
    });
    if (!currentOrder || !['CANCELLED', 'EXPIRED'].includes(currentOrder.status) ||
        currentOrder.asaasPaymentId !== paymentId || currentOrder.paymentProvider !== 'ASAAS') return 'SKIPPED_STALE';
    const changed = await tx.financeReconciliationIssue.updateMany({
      where: {
        id: issue.id, contaId: input.manifest.contaId, status: 'OPEN',
        issueType: 'BILLING_OPERATION_UNCERTAIN', entityType: 'PAYMENT',
        entityId: orderId, asaasId: paymentId, lastSeenAt: issue.lastSeenAt,
        AND: [{ metadata: { path: ['lastCauseId'], equals: causeId } }],
      },
      data: {
        status: 'RESOLVED', resolvedAt: new Date(),
        resolution: 'Pedido de evento cancelado e pagamento Asaas excluído confirmado por identidade exata.',
      },
    });
    if (changed.count === 0) return 'SKIPPED_STALE';
    await tx.auditLog.create({
      data: {
        contaId: input.manifest.contaId, ...auditFields(input.auditContext),
        action: 'finance.reconciliation_issue.resolved', entityType: 'FinanceReconciliationIssue', entityId: issue.id,
        metadata: {
          issueType: issue.issueType, entityId: orderId, asaasId: paymentId,
          resolution: 'EXACT_CANCELED_EVENT_ORDER_AND_DELETED_PAYMENT', externalReference, causeId,
          orderStatus: order.status, paymentStatus: payment.status, paymentDeleted: payment.deleted,
          ...auditMetadata(input.auditContext),
        },
      },
    });
    return 'RESOLVED';
  }, { isolationLevel: 'Serializable' });
}

export async function runRecovery(options: RecoveryOptions): Promise<void> {
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8')) as Manifest;
  validateManifest(manifest);
  const lockName = `finance-reconciliation-recovery:${manifest.contaId}`;
  const lock = await acquireWebhookJobLock(lockName, {
    ttlMs: 30 * 60 * 1000,
    metadata: {
      contaId: manifest.contaId, mode: options.apply ? 'apply' : 'dry-run', manifestVersion: manifest.version,
      runId: options.auditContext.runId, operatorLabel: options.auditContext.operatorLabel,
    },
  });
  if (!lock.acquired) throw new Error(`Recuperação já está bloqueada até ${lock.lockedUntil?.toISOString() ?? 'indefinido'}.`);
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void renewWebhookJobLock({ jobName: lock.jobName, workerId: lock.workerId, ttlMs: 30 * 60 * 1000 })
      .then((renewed) => { if (!renewed) leaseLost = true; })
      .catch(() => { leaseLost = true; });
  }, 60_000);
  heartbeat.unref?.();
  const assertLease = () => { if (leaseLost) throw new Error('Lock da recuperação foi perdido; nenhuma próxima alteração será executada.'); };
  try {
    assertLease();
    const credentials = await loadAsaasCredentials(manifest.contaId);
    if (!credentials?.apiKey) throw new Error('Credenciais Asaas indisponíveis para o tenant do manifesto.');
    const previews = await listSubscriptionPreviews(manifest.contaId);
    for (const subscriptionId of manifest.approvedExternalSubscriptionIds) {
      assertLease();
      const [preview, prior] = await Promise.all([
        Promise.resolve(previews.get(subscriptionId)),
        prisma.asaasResourceOrigin.findUnique({
          where: { uq_asaas_resource_origin_tenant_resource: {
            contaId: manifest.contaId, resourceType: 'SUBSCRIPTION', asaasId: subscriptionId,
          } }, select: { origin: true },
        }),
      ]);
      if (prior?.origin !== 'EXTERNAL' && !preview?.eligible) throw new Error(`Assinatura aprovada não elegível no tenant ${manifest.contaId}: ${subscriptionId} (${preview?.conflict ?? 'ausente da prévia'}).`);
      const remote = await getSubscription({ apiKey: credentials.apiKey, subscriptionId });
      if (remote.id !== subscriptionId) throw new Error(`ID remoto não corresponde à assinatura ${subscriptionId}.`);
    }
    for (const evidence of manifest.externalEvidence) {
      assertLease();
      await validateApprovedExternalPayment({ apiKey: credentials.apiKey, evidence, approvedSubscriptionIds: manifest.approvedExternalSubscriptionIds });
      await assertNoLocalPaymentLink(manifest.contaId, evidence.paymentId);
      const issue = manifest.openIssues.find((candidate) => candidate.id === evidence.issueId);
      if (!issue || issue.issueType !== 'PAYMENT_NEEDS_REVIEW' || issue.asaasId !== evidence.paymentId) {
        throw new Error(`Issue de revisão não corresponde ao pagamento ${evidence.paymentId}.`);
      }
      await resolveExternalChildReview({ manifest, evidence, requireClassified: false });
    }
    for (const item of manifest.reviewedHistoricalPayments ?? []) {
      assertLease();
      await resolveHistoricalPayment({ manifest, item, apiKey: credentials.apiKey, auditContext: options.auditContext, apply: false });
    }
    const absentTerminalLagIssues = manifest.openIssues.filter((issue) =>
      issue.issueType === 'WEBHOOK_LAG' && ['CHARGE', 'SUBSCRIPTION'].includes(issue.entityType) && issue.asaasId,
    );
    for (const issue of absentTerminalLagIssues) {
      assertLease();
      await resolveAbsentTerminalLagIssue({ manifest, issueManifest: issue, apiKey: credentials.apiKey, auditContext: options.auditContext, apply: false });
    }
    const manuallyRepairedIssues: Manifest['openIssues'] = [];
    for (const issueRef of manifest.openIssues) {
      if (issueRef.issueType !== 'PAYMENT_MISSING_LOCAL_ENTITY' || !issueRef.asaasId) continue;
      const issue = await prisma.financeReconciliationIssue.findFirst({ where: { id: issueRef.id, contaId: manifest.contaId } });
      const metadata = issue?.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
        ? issue.metadata as Record<string, unknown> : {};
      if (metadata.manualRepair === true && typeof metadata.resolvedLocalEntityId === 'string') manuallyRepairedIssues.push(issueRef);
    }
    for (const issue of manuallyRepairedIssues) {
      assertLease();
      await resolveAlreadyLinkedPaymentIssue({ manifest, issueManifest: issue, apiKey: credentials.apiKey, auditContext: options.auditContext, apply: false });
    }
    const eventCancellationIssues: Manifest['openIssues'] = [];
    for (const issueRef of manifest.openIssues) {
      if (issueRef.issueType !== 'BILLING_OPERATION_UNCERTAIN' || issueRef.entityType !== 'PAYMENT' || !issueRef.asaasId || !issueRef.entityId) continue;
      const issue = await prisma.financeReconciliationIssue.findFirst({ where: { id: issueRef.id, contaId: manifest.contaId } });
      const metadata = issue?.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
        ? issue.metadata as Record<string, unknown> : {};
      if (issue?.status === 'OPEN' && metadata.orderId === issueRef.entityId &&
          metadata.paymentId === issueRef.asaasId && metadata.externalReference === `event-map-order:${issueRef.entityId}`) {
        eventCancellationIssues.push(issueRef);
      }
    }
    for (const issue of eventCancellationIssues) {
      assertLease();
      await resolveVerifiedEventCancellation({ manifest, issueManifest: issue, apiKey: credentials.apiKey, auditContext: options.auditContext, apply: false });
    }

    const result = { subscriptions: manifest.approvedExternalSubscriptionIds.length, payments: manifest.approvedExternalPaymentIds.length, historical: manifest.reviewedHistoricalPayments?.length ?? 0, absentTerminalLagIssues: absentTerminalLagIssues.length, manuallyRepairedIssues: manuallyRepairedIssues.length, eventCancellations: eventCancellationIssues.length, childReviewsResolved: 0, resolved: 0, alreadyResolved: 0, stale: 0 };
    assertLease();
    const reconciliation = await reconcileWithAsaas({
      contaId: manifest.contaId,
      limit: 40,
      maxAsaasCalls: 40,
      maxDurationMs: 90_000,
      // One-off, manifest-locked recovery pass only. Normal cron keeps its
      // six-hour interval; candidate IDs remain bounded by the tenant limit.
      providerCheckIntervalMinutes: 5,
      mode: 'targeted',
      dryRun: !options.apply,
    });
    if (!options.apply) {
      console.log(JSON.stringify({ mode: 'dry-run', contaId: manifest.contaId, ...auditMetadata(options.auditContext), ...result, reconciliation: {
        checkedPayments: reconciliation.checkedPayments, checkedSubscriptions: reconciliation.checkedSubscriptions,
        paymentDrift: reconciliation.paymentDrift, subscriptionDrift: reconciliation.subscriptionDrift,
        asaasCalls: reconciliation.asaasCalls, budgetExhausted: reconciliation.budgetExhausted,
      } }, null, 2));
      return;
    }
    for (const subscriptionId of manifest.approvedExternalSubscriptionIds) {
      assertLease();
      const remote = await getSubscription({ apiKey: credentials.apiKey, subscriptionId });
      if (remote.id !== subscriptionId) throw new Error(`Assinatura ${subscriptionId} mudou entre preflight e apply.`);
    }
    for (const evidence of manifest.externalEvidence) {
      assertLease();
      await validateApprovedExternalPayment({ apiKey: credentials.apiKey, evidence, approvedSubscriptionIds: manifest.approvedExternalSubscriptionIds });
    }
    for (const subscriptionId of manifest.approvedExternalSubscriptionIds) {
      assertLease();
      const classified = await classifyPreviewedExternalSubscription({
        contaId: manifest.contaId, subscriptionId,
        actorId: `system:finance-recovery:${options.auditContext.runId}`,
        auditContext: { actorType: 'SYSTEM', ...options.auditContext },
        reason: `Manifesto revisado ${manifest.reviewedAt}: ${manifest.reason}`,
      });
      result.childReviewsResolved += classified.childPaymentReviewsResolved ?? 0;
    }
    for (const item of manifest.reviewedHistoricalPayments ?? []) {
      assertLease();
      const credentials = await loadAsaasCredentials(manifest.contaId);
      if (!credentials?.apiKey) throw new Error('Credenciais Asaas indisponíveis durante a confirmação histórica.');
      const status = await resolveHistoricalPayment({ manifest, item, apiKey: credentials.apiKey, auditContext: options.auditContext, apply: true });
      if (status === 'RESOLVED') result.resolved += 1;
      else if (status === 'ALREADY_RESOLVED') result.alreadyResolved += 1;
      else result.stale += 1;
    }
    for (const issue of absentTerminalLagIssues) {
      assertLease();
      const status = await resolveAbsentTerminalLagIssue({ manifest, issueManifest: issue, apiKey: credentials.apiKey, auditContext: options.auditContext, apply: true });
      if (status === 'RESOLVED') result.resolved += 1;
      else if (status === 'ALREADY_RESOLVED') result.alreadyResolved += 1;
      else result.stale += 1;
    }
    for (const issue of manuallyRepairedIssues) {
      assertLease();
      const credentials = await loadAsaasCredentials(manifest.contaId);
      if (!credentials?.apiKey) throw new Error('Credenciais Asaas indisponíveis durante a confirmação de entidade canônica existente.');
      const status = await resolveAlreadyLinkedPaymentIssue({ manifest, issueManifest: issue, apiKey: credentials.apiKey, auditContext: options.auditContext, apply: true });
      if (status === 'RESOLVED') result.resolved += 1;
      else if (status === 'ALREADY_RESOLVED') result.alreadyResolved += 1;
      else result.stale += 1;
    }
    for (const issue of eventCancellationIssues) {
      assertLease();
      const credentials = await loadAsaasCredentials(manifest.contaId);
      if (!credentials?.apiKey) throw new Error('Credenciais Asaas indisponíveis durante a verificação de pedido cancelado.');
      const status = await resolveVerifiedEventCancellation({ manifest, issueManifest: issue, apiKey: credentials.apiKey, auditContext: options.auditContext, apply: true });
      if (status === 'RESOLVED') result.resolved += 1;
      else if (status === 'ALREADY_RESOLVED') result.alreadyResolved += 1;
      else result.stale += 1;
    }
    console.log(JSON.stringify({ mode: 'apply', contaId: manifest.contaId, ...auditMetadata(options.auditContext), ...result, reconciliation: {
      checkedPayments: reconciliation.checkedPayments, checkedSubscriptions: reconciliation.checkedSubscriptions,
      paymentDrift: reconciliation.paymentDrift, subscriptionDrift: reconciliation.subscriptionDrift,
      asaasCalls: reconciliation.asaasCalls, budgetExhausted: reconciliation.budgetExhausted,
    } }, null, 2));
  } finally {
    clearInterval(heartbeat);
    await releaseWebhookJobLock({ jobName: lock.jobName, workerId: lock.workerId });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = readOptions(process.argv.slice(2));
  runRecovery(options)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Falha segura na recuperação financeira.');
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
