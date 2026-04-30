/**
 * Queue Adapter — Abstração de fila de webhooks
 *
 * Define interface genérica para operações de fila, permitindo
 * migração futura de PostgreSQL para Redis/BullMQ/SQS sem
 * alteração dos consumidores.
 *
 * A implementação padrão (PostgresQueueAdapter) usa a tabela
 * WebhookAsaas existente com FOR UPDATE SKIP LOCKED.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface QueueItem<T = unknown> {
  id: string;
  payload: T;
  status: QueueItemStatus;
  attempts: number;
  createdAt: Date;
  nextRetryAt: Date | null;
  metadata?: Record<string, unknown>;
}

export type QueueItemStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DLQ';

export interface EnqueueOptions {
  dedupeKey?: string;
  priority?: number;
  delayMs?: number;
}

export interface ClaimOptions {
  limit: number;
  statuses?: QueueItemStatus[];
  /** Se true, distribui claims entre tenants (fair scheduling) */
  fairScheduling?: boolean;
  tenantKey?: string;
}

export interface ClaimResult<T = unknown> {
  items: QueueItem<T>[];
  claimedCount: number;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dlq: number;
  total: number;
  oldestPendingAt: Date | null;
  lagSeconds: number | null;
}

// ── Interface ────────────────────────────────────────────────────────────

export interface QueueAdapter<T = unknown> {
  readonly name: string;

  /** Adiciona item à fila. Retorna ID. */
  enqueue(payload: T, options?: EnqueueOptions): Promise<string>;

  /** Reclama itens da fila para processamento (atomic claim). */
  claim(options: ClaimOptions): Promise<ClaimResult<T>>;

  /** Marca item como completado. */
  complete(id: string): Promise<void>;

  /** Marca item como falhado (incrementa attempt counter). */
  fail(id: string, error: string, nextRetryAt?: Date): Promise<void>;

  /** Move para DLQ (dead letter queue). */
  moveToDlq(id: string, reason: string): Promise<void>;

  /** Retorna item da DLQ para a fila. */
  requeueFromDlq(id: string): Promise<void>;

  /** Estatísticas da fila. */
  stats(tenantKey?: string): Promise<QueueStats>;
}

// ── PostgreSQL Implementation ────────────────────────────────────────────

/**
 * Implementação usando PostgreSQL (tabela WebhookAsaas existente).
 * Mantém compatibilidade total com o sistema atual.
 *
 * Nota: Esta é uma camada de abstração. A lógica real de enqueue/claim
 * permanece no asaas-webhook-handler.server.ts para não quebrar o fluxo.
 * Esta interface serve como contrato para futuras migrações.
 */
export class PostgresQueueAdapter implements QueueAdapter<unknown> {
  readonly name = 'postgresql';

  async enqueue(_payload: unknown, _options?: EnqueueOptions): Promise<string> {
    throw new Error(
      'Use enqueueAsaasWebhookEvent() diretamente. ' +
      'PostgresQueueAdapter é um contrato de interface para migração futura.',
    );
  }

  async claim(_options: ClaimOptions): Promise<ClaimResult<unknown>> {
    throw new Error(
      'Use processAsaasWebhookQueue() diretamente. ' +
      'PostgresQueueAdapter é um contrato de interface para migração futura.',
    );
  }

  async complete(_id: string): Promise<void> {
    throw new Error('Delegue para o handler existente.');
  }

  async fail(_id: string, _error: string, _nextRetryAt?: Date): Promise<void> {
    throw new Error('Delegue para o handler existente.');
  }

  async moveToDlq(_id: string, _reason: string): Promise<void> {
    throw new Error('Use markExhaustedWebhooks() do reconciliation service.');
  }

  async requeueFromDlq(_id: string): Promise<void> {
    throw new Error('Use requeueDlqWebhooks() do dlq-admin service.');
  }

  async stats(_tenantKey?: string): Promise<QueueStats> {
    throw new Error('Use getWebhookQueueMetrics() do reconciliation service.');
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

export type QueueBackend = 'postgresql' | 'redis' | 'sqs';

/**
 * Factory para obter a implementação de fila configurada.
 * No momento apenas PostgreSQL está implementado.
 * Para adicionar Redis/BullMQ/SQS, criar nova classe que implementa QueueAdapter.
 */
export function createQueueAdapter(backend?: QueueBackend): QueueAdapter {
  const resolved = backend ?? (process.env.WEBHOOK_QUEUE_BACKEND as QueueBackend | undefined) ?? 'postgresql';

  switch (resolved) {
    case 'postgresql':
      return new PostgresQueueAdapter();
    default:
      throw new Error(
        `Queue backend "${resolved}" não implementado. ` +
        `Backends disponíveis: postgresql. ` +
        `Para migrar, implemente QueueAdapter para o backend desejado.`,
      );
  }
}
