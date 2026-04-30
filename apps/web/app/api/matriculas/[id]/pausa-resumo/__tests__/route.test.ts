import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/server/matriculas/matricula-pausa.service', async () => {
  const actual = await vi.importActual<
    typeof import('@/src/server/matriculas/matricula-pausa.service')
  >('@/src/server/matriculas/matricula-pausa.service');
  return {
    ...actual,
    getPausaResumo: vi.fn(),
  };
});

function authenticatedSession() {
  return { user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' } };
}

function buildRequest(id: string) {
  return new NextRequest(`http://localhost:3000/api/matriculas/${id}/pausa-resumo`, {
    method: 'GET',
  });
}

describe('GET /api/matriculas/[id]/pausa-resumo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar 401 se não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await GET(buildRequest('mat-1'), { params: { id: 'mat-1' } });
    expect(response.status).toBe(401);
  });

  it('deve retornar resumo completo de pausa', async () => {
    const { getServerSession } = await import('next-auth');
    const { getPausaResumo } = await import('@/src/server/matriculas/matricula-pausa.service');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const mockResumo = {
      matriculaId: 'mat-1',
      status: 'PAUSADA',
      pausaAtiva: true,
      dataInicioPausa: '2025-06-01',
      dataRetornoPrevista: '2025-08-01',
      manterVaga: true,
      cobrarDurantePausa: false,
      motivoPausa: 'Viagem',
      integrationStatus: 'SINCRONIZADO',
      warningCode: null,
      asaasSubscriptionId: 'sub_123',
      operacoes: [
        {
          id: 'op-1',
          tipo: 'PAUSA',
          status: 'SINCRONIZADO',
          createdAt: '2025-06-01T00:00:00.000Z',
          processedAt: '2025-06-01T00:00:01.000Z',
          observacao: null,
          cobrancasFuturasRemovidas: 2,
          warnings: [],
        },
      ],
    };

    vi.mocked(getPausaResumo).mockResolvedValue(mockResumo as never);

    const response = await GET(buildRequest('mat-1'), { params: { id: 'mat-1' } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.matriculaId).toBe('mat-1');
    expect(data.status).toBe('PAUSADA');
    expect(data.pausaAtiva).toBe(true);
    expect(data.operacoes).toHaveLength(1);
    expect(data.operacoes[0].cobrancasFuturasRemovidas).toBe(2);

    expect(getPausaResumo).toHaveBeenCalledWith(expect.anything(), 'mat-1', 'conta-1');
  });

  it('deve retornar resumo quando matrícula não está pausada', async () => {
    const { getServerSession } = await import('next-auth');
    const { getPausaResumo } = await import('@/src/server/matriculas/matricula-pausa.service');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const mockResumo = {
      matriculaId: 'mat-1',
      status: 'ATIVA',
      pausaAtiva: false,
      dataInicioPausa: null,
      dataRetornoPrevista: null,
      manterVaga: false,
      cobrarDurantePausa: false,
      motivoPausa: null,
      integrationStatus: 'SINCRONIZADO',
      warningCode: null,
      asaasSubscriptionId: 'sub_123',
      operacoes: [],
    };

    vi.mocked(getPausaResumo).mockResolvedValue(mockResumo as never);

    const response = await GET(buildRequest('mat-1'), { params: { id: 'mat-1' } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.pausaAtiva).toBe(false);
    expect(data.operacoes).toHaveLength(0);
  });

  it('deve retornar 404 se matrícula não encontrada', async () => {
    const { getServerSession } = await import('next-auth');
    const { getPausaResumo, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(getPausaResumo).mockRejectedValue(
      new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404),
    );

    const response = await GET(buildRequest('mat-1'), { params: { id: 'mat-1' } });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('MATRICULA_NOT_FOUND');
  });

  it('deve retornar 500 para erros não tratados', async () => {
    const { getServerSession } = await import('next-auth');
    const { getPausaResumo } = await import('@/src/server/matriculas/matricula-pausa.service');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(getPausaResumo).mockRejectedValue(new Error('Unexpected'));

    const response = await GET(buildRequest('mat-1'), { params: { id: 'mat-1' } });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('INTERNAL_ERROR');
  });
});
