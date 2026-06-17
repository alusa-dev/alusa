'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StatusCobranca } from '@prisma/client';

const TERMINAL_STATUSES = new Set<StatusCobranca>([
  'PAGO',
  'CANCELADO',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
]);

const SYNC_THROTTLE_MS = 30_000;
const SYNC_BURST_THROTTLE_MS = 10_000;
const lastSyncAttemptByChargeId = new Map<string, number>();

export type CobrancaDetailQueryData = {
  id: string;
  status: StatusCobranca;
  liquidacaoStatus?: string | null;
  displayStatus?: { label: string; hint: string | null };
  asaasPaymentId?: string | null;
  asaasData?: Record<string, unknown>;
  [key: string]: unknown;
};

function shouldConvergePendingCharge(data: CobrancaDetailQueryData): boolean {
  if (!data.asaasPaymentId) return false;
  if (TERMINAL_STATUSES.has(data.status)) return false;
  return data.status !== 'CANCELAMENTO_PENDENTE';
}

async function syncPendingChargeIfNeeded(
  id: string,
  data: CobrancaDetailQueryData,
  burstActive: boolean,
): Promise<boolean> {
  if (!shouldConvergePendingCharge(data)) return false;

  const now = Date.now();
  const throttleMs = burstActive ? SYNC_BURST_THROTTLE_MS : SYNC_THROTTLE_MS;
  const lastAttempt = lastSyncAttemptByChargeId.get(id) ?? 0;
  if (now - lastAttempt < throttleMs) return false;

  lastSyncAttemptByChargeId.set(id, now);

  try {
    const response = await fetch(`/api/cobrancas/${id}/sync-asaas`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchCobrancaDetail(
  id: string,
  options?: { burstActive?: boolean; onSynced?: () => void },
): Promise<CobrancaDetailQueryData> {
  const loadDetail = async (fresh: boolean) => {
    const url = fresh ? `/api/cobrancas/${id}?fresh=1` : `/api/cobrancas/${id}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error || 'Erro ao carregar cobrança');
    }

    return payload.data as CobrancaDetailQueryData;
  };

  const initial = await loadDetail(false);

  if (!shouldConvergePendingCharge(initial)) {
    return initial;
  }

  // Primeira pintura: não bloqueia a UI esperando sync-asaas; convergência roda em burst/polling.
  if (!options?.burstActive) {
    void syncPendingChargeIfNeeded(id, initial, false).then((synced) => {
      if (synced) options?.onSynced?.();
    });
    return initial;
  }

  const synced = await syncPendingChargeIfNeeded(id, initial, true);
  if (!synced) {
    return initial;
  }

  return loadDetail(true);
}

function resolveRefetchInterval(status: StatusCobranca | undefined, burstActive: boolean): number | false {
  if (burstActive) return 2_500;
  if (!status || TERMINAL_STATUSES.has(status)) return false;
  if (status === 'PROCESSANDO' || status === 'CANCELAMENTO_PENDENTE') return 3_000;
  return 15_000;
}

export function useCobrancaDetailQuery(id: string, options?: { awaitingWebhookBurst?: boolean }) {
  const burstActive = options?.awaitingWebhookBurst ?? false;
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['cobranca', id],
    queryFn: () =>
      fetchCobrancaDetail(id, {
        burstActive,
        onSynced: () => {
          void queryClient.invalidateQueries({ queryKey: ['cobranca', id] });
        },
      }),
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    refetchInterval: (query) =>
      resolveRefetchInterval(query.state.data?.status as StatusCobranca | undefined, burstActive),
  });
}

export function isCobrancaDetailTerminal(status?: StatusCobranca): boolean {
  return Boolean(status && TERMINAL_STATUSES.has(status));
}
