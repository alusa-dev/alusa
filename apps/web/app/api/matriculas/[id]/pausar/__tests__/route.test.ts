import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/server/matriculas/matricula-pausa.service', async () => {
  const actual = await vi.importActual<
    typeof import('@/src/server/matriculas/matricula-pausa.service')
  >('@/src/server/matriculas/matricula-pausa.service');
  return {
    ...actual,
    pausarMatricula: vi.fn(),
  };
});

function authenticatedSession() {
  return { user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' } };
}

function buildRequest(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000/api/matriculas/${id}/pausar`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const validPayload = {
  motivoPausa: 'Viagem familiar',
  dataInicioPausa: '2025-06-01',
  manterVaga: true,
  cobrarDurantePausa: false,
};

describe('POST /api/matriculas/[id]/pausar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar 401 se não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    expect(response.status).toBe(401);
  });

  it('deve retornar 400 se motivoPausa está vazio', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const response = await POST(
      buildRequest('mat-1', { ...validPayload, motivoPausa: '' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('VALIDATION_ERROR');
  });

  it('deve retornar 400 se dataInicioPausa tem formato inválido', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const response = await POST(
      buildRequest('mat-1', { ...validPayload, dataInicioPausa: '01/06/2025' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('deve retornar 400 se manterVaga não é boolean', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const response = await POST(
      buildRequest('mat-1', { ...validPayload, manterVaga: 'sim' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('deve pausar matrícula com sucesso', async () => {
    const { getServerSession } = await import('next-auth');
    const { pausarMatricula } = await import('@/src/server/matriculas/matricula-pausa.service');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(pausarMatricula).mockResolvedValue({
      matriculaId: 'mat-1',
      operacaoId: 'op-1',
      correlationId: 'corr-1',
      previousStatus: 'ATIVA',
      newStatus: 'PAUSADA',
      manterVaga: true,
      cobrarDurantePausa: false,
      integrationStatus: 'PENDENTE_SINCRONISMO',
      warningCode: null,
      asaasAction: 'SUBSCRIPTION_INACTIVATED',
      cobrancasFuturasRemovidas: 2,
      warnings: [],
    });

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.matriculaId).toBe('mat-1');
    expect(data.newStatus).toBe('PAUSADA');
    expect(data.integrationStatus).toBe('PENDENTE_SINCRONISMO');

    expect(pausarMatricula).toHaveBeenCalledWith(
      expect.objectContaining({
        matriculaId: 'mat-1',
        contaId: 'conta-1',
        actorId: 'user-1',
        motivoPausa: 'Viagem familiar',
        manterVaga: true,
        cobrarDurantePausa: false,
      }),
    );
  });

  it('deve retornar erro de negócio quando matrícula já pausada', async () => {
    const { getServerSession } = await import('next-auth');
    const { pausarMatricula, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(pausarMatricula).mockRejectedValue(
      new PausaBusinessError('MATRICULA_JA_PAUSADA', 'A matrícula já se encontra pausada.'),
    );

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe('MATRICULA_JA_PAUSADA');
  });

  it('deve retornar 409 para operação duplicada', async () => {
    const { getServerSession } = await import('next-auth');
    const { pausarMatricula, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(pausarMatricula).mockRejectedValue(
      new PausaBusinessError(
        'OPERACAO_DUPLICADA',
        'Já existe uma solicitação de pausa em processamento.',
        409,
      ),
    );

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe('OPERACAO_DUPLICADA');
  });

  it('deve retornar 404 se matrícula não encontrada', async () => {
    const { getServerSession } = await import('next-auth');
    const { pausarMatricula, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(pausarMatricula).mockRejectedValue(
      new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404),
    );

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    expect(response.status).toBe(404);
  });

  it('deve retornar 502 para erro de integração financeira', async () => {
    const { getServerSession } = await import('next-auth');
    const { pausarMatricula, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(pausarMatricula).mockRejectedValue(
      new PausaBusinessError(
        'DIVERGENCIA_INTEGRACAO',
        'Não foi possível pausar a matrícula: falha ao comunicar com o serviço financeiro.',
        502,
      ),
    );

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error).toBe('DIVERGENCIA_INTEGRACAO');
  });

  it('deve retornar 500 para erros não tratados', async () => {
    const { getServerSession } = await import('next-auth');
    const { pausarMatricula } = await import('@/src/server/matriculas/matricula-pausa.service');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(pausarMatricula).mockRejectedValue(new Error('TypeError'));

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('INTERNAL_ERROR');
  });
});
