'use client';

import { useQuery } from '@tanstack/react-query';
import type { StatusCobranca } from '@prisma/client';

const TERMINAL_STATUSES = new Set<StatusCobranca>([
  'PAGO',
  'CANCELADO',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
]);

export type CobrancaDetailQueryData = {
  id: string;
  status: StatusCobranca;
  liquidacaoStatus?: string | null;
  displayStatus?: { label: string; hint: string | null };
  asaasData?: Record<string, unknown>;
  [key: string]: unknown;
};

async function fetchCobrancaDetail(id: string): Promise<CobrancaDetailQueryData> {
  const response = await fetch(`/api/cobrancas/${id}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || 'Erro ao carregar cobrança');
  }

  return payload.data as CobrancaDetailQueryData;
}

function resolveRefetchInterval(status: StatusCobranca | undefined, burstActive: boolean): number | false {
  if (burstActive) return 2_500;
  if (!status || TERMINAL_STATUSES.has(status)) return false;
  if (status === 'PROCESSANDO' || status === 'CANCELAMENTO_PENDENTE') return 3_000;
  return 15_000;
}

export function useCobrancaDetailQuery(id: string, options?: { awaitingWebhookBurst?: boolean }) {
  const burstActive = options?.awaitingWebhookBurst ?? false;

  return useQuery({
    queryKey: ['cobranca', id, burstActive ? 'burst' : 'normal'],
    queryFn: () => fetchCobrancaDetail(id),
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    refetchInterval: (query) =>
      resolveRefetchInterval(query.state.data?.status as StatusCobranca | undefined, burstActive),
  });
}

export function isCobrancaDetailTerminal(status?: StatusCobranca): boolean {
  return Boolean(status && TERMINAL_STATUSES.has(status));
}
