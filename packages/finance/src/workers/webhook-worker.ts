/**
 * Standalone Webhook Worker
 *
 * Executa o processamento da fila de webhooks independentemente do Next.js.
 * Pode ser executado como:
 *   - Node.js process separado
 *   - Container dedicado
 *   - Lambda/Cloud Function com trigger periódico
 *
 * Uso:
 *   npx tsx packages/finance/src/workers/webhook-worker.ts
 *
 * Env vars:
 *   WEBHOOK_WORKER_INTERVAL_MS — intervalo entre ciclos (default: 5000)
 *   WEBHOOK_WORKER_DRAIN_LIMIT — webhooks por ciclo (default: 50)
 *   WEBHOOK_WORKER_CONTA_ID — se definido, processa apenas esta conta
 *   WEBHOOK_WORKER_MODE — "loop" (default) ou "once"
 *   DATABASE_URL — obrigatório para Prisma
 */

import { processAsaasWebhookQueueWithInbox } from '../webhooks/process-webhook-queue-with-inbox';
import { runWebhookScheduler } from '../webhooks/webhook-scheduler.service';

// ── Config ───────────────────────────────────────────────────────────────

interface WorkerConfig {
  intervalMs: number;
  drainLimit: number;
  contaId?: string;
  mode: 'loop' | 'once';
  enableScheduler: boolean;
  schedulerIntervalCycles: number;
}

function loadConfig(): WorkerConfig {
  const intervalMs = parseInt(process.env.WEBHOOK_WORKER_INTERVAL_MS ?? '5000', 10);
  const drainLimit = parseInt(process.env.WEBHOOK_WORKER_DRAIN_LIMIT ?? '50', 10);

  return {
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5000,
    drainLimit: Number.isFinite(drainLimit) && drainLimit > 0 ? drainLimit : 50,
    contaId: process.env.WEBHOOK_WORKER_CONTA_ID || undefined,
    mode: (process.env.WEBHOOK_WORKER_MODE as 'loop' | 'once') || 'loop',
    enableScheduler: process.env.WEBHOOK_WORKER_ENABLE_SCHEDULER !== 'false',
    schedulerIntervalCycles: parseInt(process.env.WEBHOOK_WORKER_SCHEDULER_CYCLES ?? '12', 10),
  };
}

// ── Worker ───────────────────────────────────────────────────────────────

export interface WorkerCycleResult {
  cycle: number;
  processedCount: number;
  errors: number;
  durationMs: number;
  schedulerRan: boolean;
}

let running = false;
let cycleCount = 0;

async function runCycle(config: WorkerConfig): Promise<WorkerCycleResult> {
  const start = Date.now();
  cycleCount++;

  let processedCount = 0;
  let errors = 0;
  let schedulerRan = false;

  try {
    // Drain queue
    const result = await processAsaasWebhookQueueWithInbox({
      contaId: config.contaId,
      limit: config.drainLimit,
      statuses: ['PENDENTE', 'ERRO'],
      source: 'REPROCESS',
    });

    processedCount = result.processed;
    errors = result.failed;
  } catch (err) {
    console.error('[webhook-worker] Erro no ciclo de drain', {
      cycle: cycleCount,
      error: err instanceof Error ? err.message : String(err),
    });
    errors++;
  }

  // Scheduler (DLQ, health check, archiving) a cada N ciclos
  if (config.enableScheduler && cycleCount % config.schedulerIntervalCycles === 0) {
    try {
      schedulerRan = true;
      await runWebhookScheduler({
        contaId: config.contaId,
        drainLimit: 0, // Drain já foi feito acima
        skipHealthCheck: false,
        skipDriftCheck: true,
        skipArchive: false,
      });
    } catch (err) {
      console.error('[webhook-worker] Erro no scheduler', {
        cycle: cycleCount,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const durationMs = Date.now() - start;

  console.info('[webhook-worker] Ciclo concluído', {
    cycle: cycleCount,
    processedCount,
    errors,
    durationMs,
    schedulerRan,
  });

  return { cycle: cycleCount, processedCount, errors, durationMs, schedulerRan };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startWorker(): Promise<void> {
  if (running) {
    console.warn('[webhook-worker] Worker já está rodando');
    return;
  }

  const config = loadConfig();
  running = true;

  console.info('[webhook-worker] Iniciando', {
    mode: config.mode,
    intervalMs: config.intervalMs,
    drainLimit: config.drainLimit,
    contaId: config.contaId ?? 'ALL',
    enableScheduler: config.enableScheduler,
  });

  if (config.mode === 'once') {
    await runCycle(config);
    running = false;
    return;
  }

  // Loop mode
  const shutdown = () => {
    console.info('[webhook-worker] Shutdown graceful iniciado');
    running = false;
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    await runCycle(config);

    if (running) {
      await sleep(config.intervalMs);
    }
  }

  console.info('[webhook-worker] Worker encerrado', { totalCycles: cycleCount });
}

export function stopWorker(): void {
  running = false;
}

// ── Auto-start se executado diretamente ─────────────────────────────────

const isDirectExecution =
  typeof require !== 'undefined'
    ? require.main === module
    : import.meta.url === `file://${process.argv[1]}`;

if (isDirectExecution) {
  startWorker().catch((err) => {
    console.error('[webhook-worker] Falha fatal', err);
    process.exit(1);
  });
}
