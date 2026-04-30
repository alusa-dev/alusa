/**
 * Idempotency Service - Garantia de processamento único
 * 
 * ADR: Toda operação de escrita deve ser idempotente:
 * - Mesmo evento processado N vezes = mesmo resultado
 * - Proteção contra reenvio de webhooks
 * - Tolerância a reordenação de eventos
 * 
 * Estratégias:
 * 1. Event-based: eventId do Asaas como chave
 * 2. Reference-based: externalReference como chave composta
 * 3. Payload hash: hash do payload para detectar duplicatas
 */

import { prisma } from '@alusa/database';
import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface IdempotencyCheckResult {
  /** Se já foi processado anteriormente */
  alreadyProcessed: boolean;
  /** ID do registro de idempotência (se existir) */
  recordId?: string;
  /** Quando foi processado */
  processedAt?: Date;
  /** Resultado do processamento anterior (se armazenado) */
  previousResult?: unknown;
}

export interface IdempotencyRecordInput {
  contaId: string;
  key: string;
  type: 'webhook' | 'charge' | 'subscription' | 'installment' | 'transfer';
  payload?: unknown;
  result?: unknown;
}

export type IdempotencyGuardScope =
  | 'webhook-process'
  | 'charge-create'
  | 'installment-create'
  | 'subscription-create'
  | 'read-model-project'
  | 'reconciliation';

// ═══════════════════════════════════════════════════════════════════════════
// ASAAS IDEMPOTENCY KEY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Limite do Asaas para o header Idempotency-Key.
 * Acima de 47 caracteres o Asaas retorna 400 com body vazio.
 */
export const ASAAS_MAX_IDEMPOTENCY_KEY_LENGTH = 47;

/**
 * Gera uma idempotency key segura para envio ao Asaas.
 * Aceita qualquer seed (externalReference, compound key, etc) e retorna
 * um hash determinístico de tamanho fixo, dentro do limite do Asaas.
 * Formato: idem_{sha256_hex_40chars} = 45 caracteres.
 */
export function buildSafeAsaasIdempotencyKey(seed: string): string {
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 40);
  return `idem_${hash}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// HASH UTILS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gera hash SHA-256 de um payload para comparação
 */
export function hashPayload(payload: unknown): string {
  const json = JSON.stringify(payload, Object.keys(payload as object).sort());
  return crypto.createHash('sha256').update(json).digest('hex');
}

/**
 * Gera chave de idempotência para webhook
 * Formato: webhook:{eventId}
 */
export function buildWebhookIdempotencyKey(eventId: string): string {
  return `webhook:${eventId}`;
}

/**
 * Gera chave de idempotência para cobrança acadêmica
 * Formato: charge:{matriculaId}:{planoId}:{periodo}
 */
export function buildChargeIdempotencyKey(params: {
  matriculaId: string;
  planoId: string;
  periodo: string;
}): string {
  return `charge:${params.matriculaId}:${params.planoId}:${params.periodo}`;
}

/**
 * Gera chave de idempotência para assinatura
 * Formato: subscription:{matriculaId}:{planoId}
 */
export function buildSubscriptionIdempotencyKey(params: {
  matriculaId: string;
  planoId: string;
}): string {
  return `subscription:${params.matriculaId}:${params.planoId}`;
}

/**
 * Gera chave de idempotência para parcelamento
 * Formato: installment:{contratoId}
 */
export function buildInstallmentIdempotencyKey(contratoId: string): string {
  return `installment:${contratoId}`;
}

function advisoryLockKey(input: string): bigint {
  const digest = crypto.createHash('sha256').update(input).digest();
  return digest.readBigInt64BE(0);
}

export function buildGuardKey(params: {
  contaId: string;
  scope: IdempotencyGuardScope;
  key: string;
}): string {
  return `${params.contaId}:${params.scope}:${params.key}`;
}

/**
 * Adquire lock distribuído transacional (Postgres advisory lock).
 * O lock é liberado automaticamente no fim da transação.
 */
export async function acquireGuardLock(params: {
  tx: {
    $queryRaw: <T = unknown>(query: TemplateStringsArray | unknown, ...values: unknown[]) => Promise<T>;
  };
  contaId: string;
  scope: IdempotencyGuardScope;
  key: string;
}): Promise<void> {
  const compoundKey = buildGuardKey({
    contaId: params.contaId,
    scope: params.scope,
    key: params.key,
  });
  const lockKey = advisoryLockKey(compoundKey);
  await params.tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})::text`;
}

export async function withIdempotencyGuard<T>(params: {
  contaId: string;
  scope: IdempotencyGuardScope;
  key: string;
  fn: (tx: typeof prisma) => Promise<T>;
}): Promise<T> {
  if (typeof prisma.$transaction !== 'function') {
    return params.fn(prisma);
  }

  return prisma.$transaction(async (tx) => {
    if (typeof (tx as { $queryRaw?: unknown }).$queryRaw === 'function') {
      await acquireGuardLock({
        tx: tx as unknown as { $queryRaw: <V = unknown>(query: TemplateStringsArray | unknown, ...values: unknown[]) => Promise<V> },
        contaId: params.contaId,
        scope: params.scope,
        key: params.key,
      });
    }

    return params.fn(tx as unknown as typeof prisma);
  });
}

export function isPrismaUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY CHECKS - Via AsaasWebhook table
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica se um webhook já foi processado
 * Usa a tabela AsaasWebhook com eventId único
 */
export async function checkWebhookIdempotency(params: {
  contaId: string;
  eventId: string;
}): Promise<IdempotencyCheckResult> {
  const { contaId, eventId } = params;

  const existing = await prisma.webhookAsaas.findFirst({
    where: {
      contaId,
      eventId,
      status: 'PROCESSADO',
    },
    select: {
      id: true,
      processadoEm: true,
    },
  });

  if (existing) {
    return {
      alreadyProcessed: true,
      recordId: existing.id,
      processedAt: existing.processadoEm ?? undefined,
    };
  }

  return { alreadyProcessed: false };
}

/**
 * Verifica se uma cobrança já existe para o mesmo vínculo
 * Evita duplicidade de cobranças para o mesmo período
 */
export async function checkChargeIdempotency(params: {
  contaId: string;
  matriculaId: string;
  competenciaInicio: Date;
  competenciaFim: Date;
}): Promise<IdempotencyCheckResult> {
  const { contaId, matriculaId, competenciaInicio, competenciaFim } = params;

  const existing = await prisma.cobranca.findFirst({
    where: {
      matriculaId,
      competenciaInicio: { gte: competenciaInicio },
      competenciaFim: { lte: competenciaFim },
      status: { notIn: ['CANCELADO'] },
      matricula: { aluno: { contaId } },
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  if (existing) {
    return {
      alreadyProcessed: true,
      recordId: existing.id,
      processedAt: existing.createdAt,
    };
  }

  return { alreadyProcessed: false };
}

/**
 * Verifica se uma assinatura já existe para o vínculo
 */
export async function checkSubscriptionIdempotency(params: {
  contaId: string;
  matriculaId: string;
}): Promise<IdempotencyCheckResult> {
  const { contaId, matriculaId } = params;

  const existing = await prisma.subscription.findFirst({
    where: {
      contaId,
      matriculaId,
      status: { notIn: ['DELETED', 'FAILED'] },
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  if (existing) {
    return {
      alreadyProcessed: true,
      recordId: existing.id,
      processedAt: existing.createdAt,
    };
  }

  return { alreadyProcessed: false };
}

/**
 * Verifica se um parcelamento já existe para o contrato
 */
export async function checkInstallmentIdempotency(params: {
  contaId: string;
  contratoId: string;
}): Promise<IdempotencyCheckResult> {
  const { contaId, contratoId } = params;

  const existing = await prisma.installmentPlan.findFirst({
    where: {
      contaId,
      contratoId,
      status: { notIn: ['CANCELED'] },
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  if (existing) {
    return {
      alreadyProcessed: true,
      recordId: existing.id,
      processedAt: existing.createdAt,
    };
  }

  return { alreadyProcessed: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK DEDUPLICATION - Com lock otimista
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tenta adquirir lock para processar webhook
 * Retorna false se já estiver sendo processado ou já processado
 * 
 * NOTA: Esta função é usada como fallback. O handler principal em
 * asaas-webhook-handler.server.ts já implementa idempotência completa
 * via tabela webhookAsaas.
 */
export async function tryAcquireWebhookLock(params: {
  contaId: string;
  eventId: string;
  event: string;
  payloadHash: string;
}): Promise<{ acquired: boolean; webhookId?: string; existing?: boolean }> {
  const { contaId, eventId, payloadHash } = params;

  // Verificar se já existe
  const existing = eventId
    ? await prisma.webhookAsaas.findUnique({ where: { uq_webhookasaas_conta_event: { contaId, eventId } } })
    : await prisma.webhookAsaas.findFirst({ where: { contaId, payloadHash } });

  if (existing) {
    if (existing.status === 'PROCESSADO') {
      return { acquired: false, existing: true };
    }
    if (existing.status === 'PROCESSANDO') {
      return { acquired: false, existing: true };
    }
  }

  return { acquired: true, webhookId: existing?.id };
}

/**
 * Marca webhook como processado com sucesso
 */
export async function markWebhookSuccess(params: {
  webhookId: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { webhookId, durationMs } = params;

  await prisma.webhookAsaas.update({
    where: { id: webhookId },
    data: {
      status: 'PROCESSADO',
      processadoEm: new Date(),
      duracaoMs: durationMs,
      ultimoErro: null,
    },
  });
}

/**
 * Marca webhook como falha
 */
export async function markWebhookError(params: {
  webhookId: string;
  error: string;
  durationMs: number;
}): Promise<void> {
  const { webhookId, error, durationMs } = params;

  await prisma.webhookAsaas.update({
    where: { id: webhookId },
    data: {
      status: 'ERRO',
      processadoEm: new Date(),
      duracaoMs: durationMs,
      ultimoErro: error,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// READ-BEFORE-WRITE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica se já existe cobrança no Asaas com mesmo externalReference
 * Deve ser chamado ANTES de criar cobrança no Asaas
 */
export async function checkExistingChargeByExternalRef(params: {
  contaId: string;
  externalReference: string;
}): Promise<{ exists: boolean; chargeId?: string; asaasPaymentId?: string }> {
  const { contaId, externalReference } = params;

  const charge = await prisma.charge.findFirst({
    where: { contaId, externalReference },
    select: { id: true, asaasPaymentId: true },
  });

  if (charge) {
    return {
      exists: true,
      chargeId: charge.id,
      asaasPaymentId: charge.asaasPaymentId ?? undefined,
    };
  }

  return { exists: false };
}

/**
 * Verifica se já existe assinatura no Asaas com mesmo externalReference
 */
export async function checkExistingSubscriptionByExternalRef(params: {
  contaId: string;
  externalReference: string;
}): Promise<{ exists: boolean; subscriptionId?: string; asaasSubscriptionId?: string }> {
  const { contaId, externalReference } = params;

  const subscription = await prisma.subscription.findFirst({
    where: { contaId, externalReference },
    select: { id: true, asaasSubscriptionId: true },
  });

  if (subscription) {
    return {
      exists: true,
      subscriptionId: subscription.id,
      asaasSubscriptionId: subscription.asaasSubscriptionId ?? undefined,
    };
  }

  return { exists: false };
}
