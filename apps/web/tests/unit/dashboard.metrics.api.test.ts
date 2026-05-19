import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockLoadDashboardMetricsBody = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
  getServerSession: () => mockGetServerSession(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/dashboard/load-dashboard-metrics', () => ({
  loadDashboardMetricsBody: (...args: unknown[]) => mockLoadDashboardMetricsBody(...args),
}));

vi.mock('@/lib/cache/tenant-cache', () => ({
  isCacheLayerEnabled: () => false,
  buildTenantCacheKey: vi.fn(),
  withTenantCache: vi.fn(),
}));

import { GET } from '@/app/api/dashboard/metrics/route';

describe('GET /api/dashboard/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    });

    mockLoadDashboardMetricsBody.mockResolvedValue({
      success: true,
      data: {
        turmasAtivas: 4,
        taxaMatriculaRecebidaAno: 150,
        totalAlunos: 10,
        alunosAtivos: 8,
        aulasHoje: 1,
        pendencias: 0,
        aniversariantesDoMesAtivos: 0,
        totalMatriculas: 0,
        matriculasAtivas: 0,
        cobrancasPendentes: 0,
        cobrancasVencidas: 0,
        receitaMes: 0,
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
      },
    });
  });

  it('retorna métricas do dashboard sem auto-close na rota', async () => {
    const response = await GET(new NextRequest('http://localhost/api/dashboard/metrics'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.turmasAtivas).toBe(4);
    expect(json.data.taxaMatriculaRecebidaAno).toBe(150);
    expect(mockLoadDashboardMetricsBody).toHaveBeenCalledWith('conta-1');
  });
});
