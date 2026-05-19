'use client';

import { useQuery } from '@tanstack/react-query';

import type { DashboardFinanceKpisDataDTO, DashboardMetricsDataDTO } from '@/features/dashboard/dtos';
import {
  mapDashboardFinanceKpisResultToDTO,
  mapDashboardMetricsResultToDTO,
} from '@/features/dashboard/mappers';

const DASHBOARD_BLOCKS_ENABLED = process.env.NEXT_PUBLIC_DASHBOARD_BLOCKS_ENABLED === 'true';
const DASHBOARD_BLOCK_ENDPOINTS = [
  '/api/dashboard/summary-cards',
  '/api/dashboard/lesson-summary',
  '/api/dashboard/recent-activity',
  '/api/dashboard/birthdays',
  '/api/dashboard/experimental-classes',
] as const;

function emptyDashboardMetrics(): DashboardMetricsDataDTO {
  return {
    totalAlunos: 0,
    alunosAtivos: 0,
    turmasAtivas: 0,
    aulasHoje: 0,
    pendencias: 0,
    aniversariantesDoMesAtivos: 0,
    totalMatriculas: 0,
    matriculasAtivas: 0,
    cobrancasPendentes: 0,
    cobrancasVencidas: 0,
    receitaMes: 0,
    taxaMatriculaRecebidaAno: 0,
    receitaTotal: 0,
    proximosVencimentos: 0,
    taxaInadimplencia: 0,
    receitaSemanal: [],
    matriculasNovasSemanal: [],
    matriculasCanceladasSemanal: [],
    ultimasCobrancas: [],
    alunosRecentes: [],
    aniversariantesDoMes: [],
    aulasExperimentais: [],
  };
}

async function fetchDashboardBlock(endpoint: string): Promise<Partial<DashboardMetricsDataDTO>> {
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Dashboard block failed: ${endpoint} ${response.status}`);
  }

  const raw = (await response.json()) as { success: boolean; data?: Partial<DashboardMetricsDataDTO>; error?: string };
  if (!raw.success) {
    throw new Error(raw.error ?? `Dashboard block failed: ${endpoint}`);
  }

  return raw.data ?? {};
}

async function fetchLegacyMetrics(): Promise<DashboardMetricsDataDTO> {
  const response = await fetch('/api/dashboard/metrics', {
    headers: { Accept: 'application/json' },
  });
  const raw = (await response.json()) as Record<string, unknown>;
  const parsed = mapDashboardMetricsResultToDTO(raw);
  if (!parsed.success) {
    throw new Error('Falha ao carregar métricas do dashboard');
  }
  return parsed.data;
}

async function fetchDashboardMetrics(): Promise<DashboardMetricsDataDTO> {
  if (DASHBOARD_BLOCKS_ENABLED) {
    try {
      const blocks = await Promise.all(DASHBOARD_BLOCK_ENDPOINTS.map(fetchDashboardBlock));
      return Object.assign(emptyDashboardMetrics(), ...blocks);
    } catch {
      return fetchLegacyMetrics();
    }
  }

  return fetchLegacyMetrics();
}

async function fetchFinanceKpis(): Promise<DashboardFinanceKpisDataDTO> {
  const response = await fetch('/api/dashboard/finance-kpis', {
    headers: { Accept: 'application/json' },
  });
  const raw = (await response.json()) as Record<string, unknown>;
  const parsed = mapDashboardFinanceKpisResultToDTO(raw);
  if (!parsed.success) {
    throw new Error('Falha ao carregar KPIs financeiros');
  }
  return parsed.data;
}

export function useDashboardMetricsQuery(initialData?: DashboardMetricsDataDTO | null) {
  return useQuery({
    queryKey: ['dashboard', 'metrics', DASHBOARD_BLOCKS_ENABLED],
    queryFn: fetchDashboardMetrics,
    enabled: true,
    initialData: initialData ?? undefined,
    staleTime: 15_000,
  });
}

export function useDashboardFinanceKpisQuery(initialData?: DashboardFinanceKpisDataDTO | null) {
  return useQuery({
    queryKey: ['dashboard', 'finance-kpis'],
    queryFn: fetchFinanceKpis,
    initialData: initialData ?? undefined,
    staleTime: 15_000,
  });
}
