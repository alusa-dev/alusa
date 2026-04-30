/**
 * Quota Tracker para API do Asaas.
 *
 * O Asaas permite 25.000 requests por conta a cada 12 horas.
 * Este tracker mantém contagem em memória para emitir warnings
 * antes de atingir o limite, permitindo ajuste proativo de vazão.
 *
 * Limitações conhecidas:
 * - Contagem é por processo (não compartilhada entre instâncias)
 * - Em deploy multi-instance, cada instância conta separadamente
 * - Para tracking distribuído, usar Redis ou similar
 */

import { globalAsaasHooks } from './asaas-hooks';

const DEFAULT_QUOTA_LIMIT = 25_000;
const WINDOW_MS = 12 * 60 * 60 * 1000; // 12 horas

export interface QuotaEntry {
  count: number;
  windowStartedAt: number;
  windowEndsAt: number;
}

export interface QuotaStatus {
  count: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  windowEndsAt: number;
  windowEndsIn: string;
  warning: boolean;
  exceeded: boolean;
}

export class QuotaTracker {
  private readonly entries = new Map<string, QuotaEntry>();
  readonly limit: number;

  constructor(limit = DEFAULT_QUOTA_LIMIT) {
    this.limit = Math.max(1, limit);
  }

  private getOrCreate(accountKey: string): QuotaEntry {
    let entry = this.entries.get(accountKey);
    const now = Date.now();

    if (!entry || now >= entry.windowEndsAt) {
      entry = {
        count: 0,
        windowStartedAt: now,
        windowEndsAt: now + WINDOW_MS,
      };
      this.entries.set(accountKey, entry);
    }

    return entry;
  }

  increment(accountKey: string): QuotaStatus {
    const entry = this.getOrCreate(accountKey);
    entry.count += 1;

    const status = this.buildStatus(entry);

    if (status.warning && !status.exceeded) {
      console.warn('[quota-tracker] Quota API próxima do limite', {
        accountKey: accountKey.slice(0, 12),
        count: status.count,
        limit: status.limit,
        remaining: status.remaining,
        percentUsed: status.percentUsed,
      });

      globalAsaasHooks.emitQuotaWarning({
        accountKey,
        used: status.count,
        limit: status.limit,
        percentUsed: status.percentUsed,
        exceeded: false,
      });
    }

    if (status.exceeded && entry.count === this.limit + 1) {
      console.error('[quota-tracker] Quota API excedida', {
        accountKey: accountKey.slice(0, 12),
        count: status.count,
        limit: status.limit,
      });

      globalAsaasHooks.emitQuotaWarning({
        accountKey,
        used: status.count,
        limit: status.limit,
        percentUsed: status.percentUsed,
        exceeded: true,
      });
    }

    return status;
  }

  getStatus(accountKey: string): QuotaStatus {
    const entry = this.getOrCreate(accountKey);
    return this.buildStatus(entry);
  }

  private buildStatus(entry: QuotaEntry): QuotaStatus {
    const remaining = Math.max(0, this.limit - entry.count);
    const percentUsed = Math.round((entry.count / this.limit) * 100);
    const endsInMs = Math.max(0, entry.windowEndsAt - Date.now());
    const endsInMin = Math.ceil(endsInMs / 60_000);

    return {
      count: entry.count,
      limit: this.limit,
      remaining,
      percentUsed,
      windowEndsAt: entry.windowEndsAt,
      windowEndsIn: endsInMin > 60 ? `${Math.round(endsInMin / 60)}h` : `${endsInMin}min`,
      warning: percentUsed >= 80,
      exceeded: entry.count >= this.limit,
    };
  }

  /** Snapshot de todas as contas para diagnóstico */
  allSnapshots(): Record<string, QuotaStatus> {
    const result: Record<string, QuotaStatus> = {};
    for (const [key, entry] of this.entries) {
      result[key] = this.buildStatus(entry);
    }
    return result;
  }

  reset(accountKey: string): void {
    this.entries.delete(accountKey);
  }

  resetAll(): void {
    this.entries.clear();
  }
}

const envLimit = Number(process.env.ASAAS_QUOTA_LIMIT ?? DEFAULT_QUOTA_LIMIT);
export const globalQuotaTracker = new QuotaTracker(
  Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_QUOTA_LIMIT,
);
