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
    reativarMatricula: vi.fn(),
  };
});

function authenticatedSession() {
  return { user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' } };
}

function buildRequest(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000/api/matriculas/${id}/reativar`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const validPayload = {
  dataRetornoEfetiva: '2025-07-01',
  nextDueDate: '2025-08-01',
};

describe('POST /api/matriculas/[id]/reativar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar 401 se não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    expect(response.status).toBe(401);
  });

  it('deve retornar 400 se nextDueDate ausente', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const response = await POST(
      buildRequest('mat-1', { dataRetornoEfetiva: '2025-07-01' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('deve retornar 400 se formato de data inválido', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    const response = await POST(
      buildRequest('mat-1', { dataRetornoEfetiva: '01/07/2025', nextDueDate: '2025-08-01' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('deve reativar matrícula com sucesso', async () => {
    const { getServerSession } = await import('next-auth');
    const { reativarMatricula } = await import('@/src/server/matriculas/matricula-pausa.service');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(reativarMatricula).mockResolvedValue({
      matriculaId: 'mat-1',
      operacaoId: 'op-1',
      correlationId: 'corr-1',
      previousStatus: 'PAUSADA',
      newStatus: 'ATIVA',
      integrationStatus: 'PENDENTE_SINCRONISMO',
      warningCode: null,
      asaasAction: 'SUBSCRIPTION_UPDATED',
      warnings: [],
    });

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.matriculaId).toBe('mat-1');
    expect(data.newStatus).toBe('ATIVA');
    expect(data.integrationStatus).toBe('PENDENTE_SINCRONISMO');

    expect(reativarMatricula).toHaveBeenCalledWith(
      expect.objectContaining({
        matriculaId: 'mat-1',
        contaId: 'conta-1',
        actorId: 'user-1',
        dataRetornoEfetiva: '2025-07-01',
        nextDueDate: '2025-08-01',
      }),
    );
  });

  it('deve retornar erro se matrícula não está pausada', async () => {
    const { getServerSession } = await import('next-auth');
    const { reativarMatricula, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(reativarMatricula).mockRejectedValue(
      new PausaBusinessError(
        'MATRICULA_NAO_PAUSADA',
        'A matrícula precisa estar com status Pausada para ser reativada.',
      ),
    );

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe('MATRICULA_NAO_PAUSADA');
  });

  it('deve retornar erro se sem vaga para reativação', async () => {
    const { getServerSession } = await import('next-auth');
    const { reativarMatricula, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(reativarMatricula).mockRejectedValue(
      new PausaBusinessError(
        'SEM_VAGA_PARA_REATIVACAO',
        'Não há vaga disponível na turma para reativar esta matrícula.',
      ),
    );

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe('SEM_VAGA_PARA_REATIVACAO');
  });

  it('deve retornar 409 para operação duplicada', async () => {
    const { getServerSession } = await import('next-auth');
    const { reativarMatricula, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(reativarMatricula).mockRejectedValue(
      new PausaBusinessError('OPERACAO_DUPLICADA', 'Já existe uma solicitação em processamento.', 409),
    );

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    expect(response.status).toBe(409);
  });

  it('deve retornar 404 se matrícula não encontrada', async () => {
    const { getServerSession } = await import('next-auth');
    const { reativarMatricula, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(reativarMatricula).mockRejectedValue(
      new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404),
    );

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    expect(response.status).toBe(404);
  });

  it('deve retornar 502 para erro de integração financeira', async () => {
    const { getServerSession } = await import('next-auth');
    const { reativarMatricula, PausaBusinessError } = await import(
      '@/src/server/matriculas/matricula-pausa.service'
    );
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(reativarMatricula).mockRejectedValue(
      new PausaBusinessError(
        'ASAAS_AUTH_INVALIDA',
        'A conta financeira não autorizou a operação.',
        502,
      ),
    );

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error).toBe('ASAAS_AUTH_INVALIDA');
  });

  it('deve retornar 500 para erros não tratados', async () => {
    const { getServerSession } = await import('next-auth');
    const { reativarMatricula } = await import('@/src/server/matriculas/matricula-pausa.service');
    vi.mocked(getServerSession).mockResolvedValue(authenticatedSession() as never);

    vi.mocked(reativarMatricula).mockRejectedValue(new Error('Unexpected'));

    const response = await POST(buildRequest('mat-1', validPayload), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('INTERNAL_ERROR');
  });
});
