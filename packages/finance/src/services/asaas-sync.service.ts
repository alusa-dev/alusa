/**
 * Asaas Sync Service
 *
 * ADR: Separação fetch (read-only) vs persist (controlled writes)
 *
 * - fetchAsaasPaymentSnapshot: Lê do Asaas, retorna snapshot normalizado, NÃO escreve no banco
 * - persistAsaasPaymentSnapshot: Escreve APENAS campos asaas*, nunca modifica status/valor
 * - shouldThrottleFetch: Verifica se já buscou recentemente (dedup/throttle)
 */

import { prisma } from '@alusa/database';
import type { AsaasPayment, PaymentStatus } from '@alusa/asaas';
import { getPayment } from '../use-cases/asaas-ops';
import { recordAsaasReadIntent } from '../foundation/asaas-read-intent';
import { createHash } from 'crypto';
import type { LiquidacaoStatus } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AsaasPaymentSnapshot {
  /** ID do pagamento no Asaas */
  asaasPaymentId: string;
  /** Status do pagamento no Asaas (raw) */
  asaasStatus: PaymentStatus;
  /** Valor bruto cobrado */
  value: number;
  /** Valor líquido (após taxas) */
  netValue: number;
  /** Valor original (se houve juros/multa) */
  originalValue: number | null;
  /** Taxa do Asaas (value - netValue) */
  feeValue: number;
  /** Data de vencimento */
  dueDate: string;
  /** Data de pagamento (preenchida em RECEIVED_IN_CASH) */
  paymentDate: string | null;
  /** Data em que o crédito ficou disponível */
  creditDate: string | null;
  /** Data estimada para crédito */
  estimatedCreditDate: string | null;
  /** URL da fatura */
  invoiceUrl: string | null;
  /** URL do boleto */
  bankSlipUrl: string | null;
  /** Hash do snapshot para dedup */
  snapshotHash: string;
  /** Timestamp do fetch */
  fetchedAt: Date;
}

export interface FetchSnapshotResult {
  success: true;
  snapshot: AsaasPaymentSnapshot;
  throttled: false;
}

export interface FetchSnapshotThrottled {
  success: true;
  snapshot: null;
  throttled: true;
  lastFetchAt: Date;
}

export interface FetchSnapshotError {
  success: false;
  error: string;
  throttled: false;
}

export type FetchAsaasPaymentSnapshotResult =
  | FetchSnapshotResult
  | FetchSnapshotThrottled
  | FetchSnapshotError;

export interface PersistSnapshotResult {
  success: true;
  updated: boolean;
  liquidacaoStatus: LiquidacaoStatus;
}

export interface PersistSnapshotError {
  success: false;
  error: string;
}

export type PersistAsaasPaymentSnapshotResult = PersistSnapshotResult | PersistSnapshotError;

// ─────────────────────────────────────────────────────────────────────────────
// Environment / Feature Flags
// ─────────────────────────────────────────────────────────────────────────────

function getThrottleSeconds(): number {
  const envValue = process.env.ASAAS_SYNC_THROTTLE_SECONDS;
  if (!envValue) return 15; // default 15 segundos
  const parsed = parseInt(envValue, 10);
  return isNaN(parsed) || parsed < 0 ? 15 : parsed;
}

function isInMemCacheEnabled(): boolean {
  return process.env.ASAAS_SYNC_ENABLE_INMEM_CACHE === 'true';
}

function isWriteOnGetEnabled(): boolean {
  // Flag para migração gradual: se false, GET não persiste
  return process.env.ASAAS_SYNC_WRITE_ON_GET === 'true';
}

function isAdminReconcileAllowed(): boolean {
  return process.env.ASAAS_SYNC_ALLOW_ADMIN_RECONCILE !== 'false'; // default true
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Cache (opcional, para reduzir chamadas em rajada)
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  snapshot: AsaasPaymentSnapshot;
  expiresAt: number;
}

const inMemCache = new Map<string, CacheEntry>();

function getCachedSnapshot(paymentId: string): AsaasPaymentSnapshot | null {
  if (!isInMemCacheEnabled()) return null;

  const entry = inMemCache.get(paymentId);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    inMemCache.delete(paymentId);
    return null;
  }

  return entry.snapshot;
}

function setCachedSnapshot(paymentId: string, snapshot: AsaasPaymentSnapshot): void {
  if (!isInMemCacheEnabled()) return;

  const ttlMs = getThrottleSeconds() * 1000;
  inMemCache.set(paymentId, {
    snapshot,
    expiresAt: Date.now() + ttlMs,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Throttle Check (DB-based)
// ─────────────────────────────────────────────────────────────────────────────

export async function shouldThrottleFetch(cobrancaId: string): Promise<{ throttle: boolean; lastFetchAt: Date | null }> {
  const cobranca = await prisma.cobranca.findUnique({
    where: { id: cobrancaId },
    select: { lastAsaasFetchAt: true },
  });

  if (!cobranca?.lastAsaasFetchAt) {
    return { throttle: false, lastFetchAt: null };
  }

  const throttleSeconds = getThrottleSeconds();
  const elapsedMs = Date.now() - cobranca.lastAsaasFetchAt.getTime();
  const throttle = elapsedMs < throttleSeconds * 1000;

  return { throttle, lastFetchAt: cobranca.lastAsaasFetchAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute Snapshot Hash (para dedup)
// ─────────────────────────────────────────────────────────────────────────────

function computeSnapshotHash(payment: AsaasPayment): string {
  const relevantData = {
    status: payment.status,
    value: payment.value,
    netValue: payment.netValue,
    originalValue: payment.originalValue,
    dueDate: payment.dueDate,
    creditDate: payment.creditDate,
    estimatedCreditDate: payment.estimatedCreditDate,
    deleted: payment.deleted,
  };
  return createHash('sha256').update(JSON.stringify(relevantData)).digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch Snapshot (READ-ONLY)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca dados do pagamento no Asaas e retorna snapshot normalizado.
 * NÃO escreve no banco. Usa throttle e cache opcional.
 */
export async function fetchAsaasPaymentSnapshot(
  cobrancaId: string,
  opts: { contaId: string; asaasPaymentId: string; forceRefresh?: boolean }
): Promise<FetchAsaasPaymentSnapshotResult> {
  const { contaId, asaasPaymentId, forceRefresh = false } = opts;

  // 1. Verificar cache in-memory
  if (!forceRefresh) {
    const cached = getCachedSnapshot(asaasPaymentId);
    if (cached) {
      return { success: true, snapshot: cached, throttled: false };
    }
  }

  // 2. Verificar throttle no DB
  if (!forceRefresh) {
    const { throttle, lastFetchAt } = await shouldThrottleFetch(cobrancaId);
    if (throttle && lastFetchAt) {
      return { success: true, snapshot: null, throttled: true, lastFetchAt };
    }
  }

  // 3. Buscar do Asaas
  try {
    recordAsaasReadIntent('RECONCILIATION');
    const payment = await getPayment(asaasPaymentId, { contaId });

    const snapshot: AsaasPaymentSnapshot = {
      asaasPaymentId: payment.id,
      asaasStatus: payment.status,
      value: payment.value,
      netValue: payment.netValue,
      originalValue: payment.originalValue ?? null,
      feeValue: payment.value - payment.netValue,
      dueDate: payment.dueDate,
      paymentDate: payment.paymentDate ?? null,
      creditDate: payment.creditDate ?? null,
      estimatedCreditDate: payment.estimatedCreditDate ?? null,
      invoiceUrl: payment.invoiceUrl ?? null,
      bankSlipUrl: payment.bankSlipUrl ?? null,
      snapshotHash: computeSnapshotHash(payment),
      fetchedAt: new Date(),
    };

    // Atualizar cache
    setCachedSnapshot(asaasPaymentId, snapshot);

    return { success: true, snapshot, throttled: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('❌ Erro ao buscar pagamento do Asaas:', { asaasPaymentId, error: message });
    return { success: false, error: message, throttled: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute Liquidação Status
// ─────────────────────────────────────────────────────────────────────────────

function computeLiquidacaoStatus(snapshot: AsaasPaymentSnapshot): LiquidacaoStatus {
  // Status que não têm liquidação
  const nonPaymentStatuses: PaymentStatus[] = [
    'PENDING',
    'OVERDUE',
    'REFUNDED',
    'REFUND_REQUESTED',
    'REFUND_IN_PROGRESS',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL',
    'DUNNING_REQUESTED',
    'DUNNING_RECEIVED',
    'AWAITING_RISK_ANALYSIS',
    'DELETED',
  ];

  if (nonPaymentStatuses.includes(snapshot.asaasStatus)) {
    return 'NAO_APLICAVEL';
  }

  // RECEIVED ou CONFIRMED = pagamento recebido
  if (snapshot.asaasStatus === 'RECEIVED' || snapshot.asaasStatus === 'CONFIRMED') {
    // Se creditDate preenchido, crédito já disponível
    if (snapshot.creditDate) {
      return 'DISPONIVEL';
    }
    // Se estimatedCreditDate, ainda aguardando
    if (snapshot.estimatedCreditDate) {
      return 'PENDENTE';
    }
    // Recebido mas sem data de crédito ainda
    return 'PENDENTE';
  }

  // RECEIVED_IN_CASH = dinheiro em mãos, disponível imediatamente
  if (snapshot.asaasStatus === 'RECEIVED_IN_CASH') {
    return 'DISPONIVEL';
  }

  return 'NAO_APLICAVEL';
}

// ─────────────────────────────────────────────────────────────────────────────
// Persist Snapshot (CONTROLLED WRITES)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persiste snapshot do Asaas nos campos asaas* da Cobranca.
 *
 * IMPORTANTE:
 * - NUNCA modifica status ou valor da Cobranca (esses vêm do webhook)
 * - Apenas atualiza campos asaas* para consulta/reconciliação
 * - Usa hash para evitar writes desnecessários
 */
export async function persistAsaasPaymentSnapshot(
  cobrancaId: string,
  snapshot: AsaasPaymentSnapshot
): Promise<PersistAsaasPaymentSnapshotResult> {
  try {
    // 1. Verificar hash atual para evitar write desnecessário
    const current = await prisma.cobranca.findUnique({
      where: { id: cobrancaId },
      select: { lastAsaasFetchHash: true },
    });

    if (current?.lastAsaasFetchHash === snapshot.snapshotHash) {
      // Nada mudou, apenas atualizar timestamp
      await prisma.cobranca.update({
        where: { id: cobrancaId },
        data: { lastAsaasFetchAt: snapshot.fetchedAt },
      });

      const liquidacaoStatus = computeLiquidacaoStatus(snapshot);
      return { success: true, updated: false, liquidacaoStatus };
    }

    // 2. Calcular status de liquidação
    const liquidacaoStatus = computeLiquidacaoStatus(snapshot);
    // Para RECEIVED_IN_CASH, creditDate é null - usar paymentDate como fallback
    const liquidacaoDateStr = snapshot.creditDate ?? snapshot.paymentDate;
    const liquidadoEm = liquidacaoStatus === 'DISPONIVEL' && liquidacaoDateStr
      ? new Date(liquidacaoDateStr)
      : null;

    // 3. Atualizar campos asaas*
    await prisma.cobranca.update({
      where: { id: cobrancaId },
      data: {
        asaasStatus: snapshot.asaasStatus,
        asaasValue: snapshot.value,
        asaasNetValue: snapshot.netValue,
        asaasOriginalValue: snapshot.originalValue,
        asaasFeeValue: snapshot.feeValue,
        asaasCreditDate: snapshot.creditDate ? new Date(snapshot.creditDate) : null,
        asaasEstimatedCreditDate: snapshot.estimatedCreditDate ? new Date(snapshot.estimatedCreditDate) : null,
        lastAsaasFetchAt: snapshot.fetchedAt,
        lastAsaasFetchHash: snapshot.snapshotHash,
        liquidacaoStatus,
        liquidadoEm,
      },
    });

    console.log('✅ Snapshot Asaas persistido:', {
      cobrancaId,
      asaasPaymentId: snapshot.asaasPaymentId,
      liquidacaoStatus,
    });

    return { success: true, updated: true, liquidacaoStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('❌ Erro ao persistir snapshot:', { cobrancaId, error: message });
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync completo (fetch + persist) - para uso controlado
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncCobrancaWithAsaasResult {
  success: boolean;
  throttled: boolean;
  updated: boolean;
  liquidacaoStatus?: LiquidacaoStatus;
  error?: string;
}

/**
 * Sincroniza cobrança com Asaas (fetch + persist).
 *
 * USO:
 * - Webhook handler (sempre)
 * - Endpoint de reconciliação admin (quando ASAAS_SYNC_ALLOW_ADMIN_RECONCILE=true)
 * - GET endpoint (somente se ASAAS_SYNC_WRITE_ON_GET=true, para migração gradual)
 */
export async function syncCobrancaWithAsaas(
  cobrancaId: string,
  opts: {
    contaId: string;
    asaasPaymentId: string;
    forceRefresh?: boolean;
    source: 'webhook' | 'admin_reconcile' | 'get_endpoint';
  }
): Promise<SyncCobrancaWithAsaasResult> {
  const { contaId, asaasPaymentId, forceRefresh = false, source } = opts;

  // Verificar permissão baseada em source
  if (source === 'get_endpoint' && !isWriteOnGetEnabled()) {
    return { success: true, throttled: false, updated: false };
  }

  if (source === 'admin_reconcile' && !isAdminReconcileAllowed()) {
    return { success: false, throttled: false, updated: false, error: 'Reconciliação admin desabilitada' };
  }

  // 1. Fetch
  const fetchResult = await fetchAsaasPaymentSnapshot(cobrancaId, {
    contaId,
    asaasPaymentId,
    forceRefresh: source === 'webhook' || forceRefresh,
  });

  if (!fetchResult.success) {
    return { success: false, throttled: false, updated: false, error: fetchResult.error };
  }

  if (fetchResult.throttled) {
    return { success: true, throttled: true, updated: false };
  }

  // 2. Persist
  const persistResult = await persistAsaasPaymentSnapshot(cobrancaId, fetchResult.snapshot);

  if (!persistResult.success) {
    return { success: false, throttled: false, updated: false, error: persistResult.error };
  }

  return {
    success: true,
    throttled: false,
    updated: persistResult.updated,
    liquidacaoStatus: persistResult.liquidacaoStatus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Flag Exports (para uso em outros módulos)
// ─────────────────────────────────────────────────────────────────────────────

export const asaasSyncFlags = {
  isWriteOnGetEnabled,
  isAdminReconcileAllowed,
  isInMemCacheEnabled,
  getThrottleSeconds,
};
