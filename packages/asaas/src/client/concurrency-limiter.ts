/**
 * Semáforo de concorrência para limitar requests simultâneos à API do Asaas.
 *
 * O Asaas permite até 50 GETs concorrentes. Este limiter garante que
 * o sistema nunca exceda esse threshold, evitando 429 por concorrência.
 */

const DEFAULT_MAX_CONCURRENT = 50;

export class ConcurrencyLimiter {
  private running = 0;
  private readonly queue: Array<() => void> = [];
  readonly maxConcurrent: number;

  constructor(maxConcurrent = DEFAULT_MAX_CONCURRENT) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  get currentRunning(): number {
    return this.running;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Instância global compartilhada entre todos os clients AsaasHttp
const envMax = Number(process.env.ASAAS_MAX_CONCURRENT_GETS ?? DEFAULT_MAX_CONCURRENT);
export const globalGetLimiter = new ConcurrencyLimiter(
  Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_CONCURRENT,
);
