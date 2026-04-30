/**
 * Testes unitários para /api/matriculas/[id]/status
 *
 * Este endpoint só aceita status=CANCELADA.
 * Pausa e reativação devem usar POST /pausar e POST /reativar.
 *
 * @module __tests__/api/matriculas/status
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/server/matriculas/matricula-sync.service', async () => {
  const actual = await vi.importActual<
    typeof import('@/src/server/matriculas/matricula-sync.service')
  >('@/src/server/matriculas/matricula-sync.service');
  return {
    ...actual,
    syncMatriculaStatus: vi.fn(),
  };
});

function authenticatedSession() {
  return { user: { id: 'user-123', contaId: 'conta-123', role: 'ADMIN' } };
}

function buildRequest(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000/api/matriculas/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/matriculas/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar 401 se usuário não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await PATCH(buildRequest('123', { status: 'CANCELADA' }), { params: { id: '123' } });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Não autenticado');
  });

  it('deve retornar 400 se status inválido', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const response = await PATCH(buildRequest('123', { status: 'INVALIDO' }), { params: { id: '123' } });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Status inválido');
  });

  it('deve retornar 409 se tentar pausar via este endpoint', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const response = await PATCH(buildRequest('123', { status: 'PAUSADA' }), { params: { id: '123' } });
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe('STATUS_ENDPOINT_RESTRITO');
    expect(data.message).toContain('endpoints específicos');
  });

  it('deve retornar 409 se tentar reativar via este endpoint', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const response = await PATCH(buildRequest('123', { status: 'ATIVA' }), { params: { id: '123' } });
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe('STATUS_ENDPOINT_RESTRITO');
  });

  it('deve cancelar matrícula com sucesso', async () => {
    const { getServerSession } = await import('next-auth');
    const { syncMatriculaStatus } = await import(
      '@/src/server/matriculas/matricula-sync.service'
    );

    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(syncMatriculaStatus).mockResolvedValue({
      matriculaId: 'matricula-123',
      previousStatus: 'ATIVA',
      newStatus: 'CANCELADA',
      asaasAction: 'DELETE',
      cobrancasAtualizadas: 0,
      paymentSync: {
        totalFromAsaas: 0,
        matched: 0,
        updated: 0,
        warnings: [],
        details: [],
        expectedWebhooks: ['SUBSCRIPTION_DELETED'],
      },
      nextDueDate: null,
    });

    const response = await PATCH(
      buildRequest('matricula-123', { status: 'CANCELADA', motivo: 'Pedido do responsável' }),
      { params: { id: 'matricula-123' } },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBe('Status atualizado para CANCELADA');
    expect(syncMatriculaStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        matriculaId: 'matricula-123',
        targetStatus: 'CANCELADA',
        contaId: 'conta-123',
        actorId: 'user-123',
        motivo: 'Pedido do responsável',
      }),
    );
  });

  it('deve retornar 404 se matrícula não encontrada ao cancelar', async () => {
    const { getServerSession } = await import('next-auth');
    const { ManualSyncError, syncMatriculaStatus } = await import(
      '@/src/server/matriculas/matricula-sync.service'
    );

    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);
    vi.mocked(syncMatriculaStatus).mockRejectedValue(
      new ManualSyncError(404, 'MATRICULA_NOT_FOUND', 'Matrícula não encontrada.'),
    );

    const response = await PATCH(buildRequest('123', { status: 'CANCELADA' }), { params: { id: '123' } });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('MATRICULA_NOT_FOUND');
  });

  it('deve retornar a mensagem específica da falha financeira', async () => {
    const { getServerSession } = await import('next-auth');
    const { ManualSyncError, syncMatriculaStatus } = await import(
      '@/src/server/matriculas/matricula-sync.service'
    );

    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);
    vi.mocked(syncMatriculaStatus).mockRejectedValue(
      new ManualSyncError(
        409,
        'ASSINATURA_FINANCEIRA_NAO_ENCONTRADA',
        'Não foi possível cancelar a matrícula porque a assinatura financeira vinculada não foi encontrada.',
        { subscriptionId: 'sub_123' },
      ),
    );

    const response = await PATCH(buildRequest('matricula-123', { status: 'CANCELADA' }), { params: { id: 'matricula-123' } });
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe('ASSINATURA_FINANCEIRA_NAO_ENCONTRADA');
  });

  it('deve retornar warning quando ação for apenas local', async () => {
    const { getServerSession } = await import('next-auth');
    const { syncMatriculaStatus } = await import(
      '@/src/server/matriculas/matricula-sync.service'
    );

    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);
    vi.mocked(syncMatriculaStatus).mockResolvedValue({
      matriculaId: 'matricula-123',
      previousStatus: 'ATIVA',
      newStatus: 'CANCELADA',
      asaasAction: 'LOCAL_ONLY',
      cobrancasAtualizadas: 0,
      paymentSync: {
        totalFromAsaas: 0,
        matched: 0,
        updated: 0,
        warnings: [],
        details: [],
        expectedWebhooks: [],
      },
      nextDueDate: null,
    });

    const response = await PATCH(buildRequest('matricula-123', { status: 'CANCELADA' }), { params: { id: 'matricula-123' } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.warning).toBeTruthy();
    expect(data.message).toContain('apenas localmente');
  });

  it('deve retornar 500 para erros não tratados', async () => {
    const { getServerSession } = await import('next-auth');
    const { syncMatriculaStatus } = await import(
      '@/src/server/matriculas/matricula-sync.service'
    );

    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);
    vi.mocked(syncMatriculaStatus).mockRejectedValue(new Error('Erro inesperado'));

    const response = await PATCH(buildRequest('matricula-123', { status: 'CANCELADA' }), { params: { id: 'matricula-123' } });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('INTERNAL_ERROR');
  });
});
