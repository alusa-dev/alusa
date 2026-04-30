/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/src/server/aulas/session', () => ({
  canAccessAulas: vi.fn(),
  getAulasSessionUser: vi.fn(),
}));

vi.mock('@/src/server/aulas/reposicoes/makeup.service', () => ({
  createMakeupClass: vi.fn(),
  getMakeupClassDetails: vi.fn(),
  listMakeupClasses: vi.fn(),
  updateMakeupClass: vi.fn(),
}));

const { canAccessAulas, getAulasSessionUser } = await import('@/src/server/aulas/session');
const { createMakeupClass, getMakeupClassDetails, listMakeupClasses, updateMakeupClass } = await import(
  '@/src/server/aulas/reposicoes/makeup.service'
);
const { GET: GET_LIST, POST } = await import('@/app/api/aulas/reposicoes/route');
const { GET: GET_DETAILS, PATCH } = await import('@/app/api/aulas/reposicoes/[id]/route');

describe('/api/aulas/reposicoes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não há sessão na listagem', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce(null);

    const response = await GET_LIST(new NextRequest('http://localhost/api/aulas/reposicoes'));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'NAO_AUTENTICADO' });
  });

  it('lista reposições com filtros normalizados', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'RECEPCAO',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(listMakeupClasses).mockResolvedValueOnce({
      success: true,
      data: {
        resources: {
          turmas: [],
          alunos: [],
        },
        items: [],
      },
    } as never);

    const response = await GET_LIST(
      new NextRequest(
        'http://localhost/api/aulas/reposicoes?turmaId=turma-1&status=AGENDADA&startDate=2026-03-01T00:00:00.000Z',
      ),
    );

    expect(response.status).toBe(200);
    expect(listMakeupClasses).toHaveBeenCalledWith('conta-1', {
      turmaId: 'turma-1',
      alunoId: undefined,
      status: ['AGENDADA'],
      startDate: '2026-03-01T00:00:00.000Z',
      endDate: undefined,
    });
  });

  it('cria reposição com body validado', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(createMakeupClass).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'makeup-1',
        scope: 'INDIVIDUAL',
        status: 'AGENDADA',
        observacao: null,
        createdAt: '2026-03-15T00:00:00.000Z',
        aluno: null,
        turmaOrigem: { id: 'turma-1', label: 'Origem' },
        turmaDestino: { id: 'turma-2', label: 'Destino' },
        eventoOrigem: { id: 'event-1', title: 'Evento origem', startAt: '2026-03-15T00:00:00.000Z' },
        eventoDestino: { id: 'event-2', title: 'Evento destino', startAt: '2026-03-16T00:00:00.000Z' },
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/aulas/reposicoes', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'INDIVIDUAL',
          alunoId: 'aluno-1',
          eventoOrigemId: 'event-1',
          turmaOrigemId: 'turma-1',
          turmaDestinoId: 'turma-2',
          destinationEvent: {
            startAt: '2026-03-16T13:00:00.000Z',
            endAt: '2026-03-16T14:00:00.000Z',
            professorIds: [],
          },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createMakeupClass).toHaveBeenCalledWith(
      'conta-1',
      'user-1',
      expect.objectContaining({
        scope: 'INDIVIDUAL',
        alunoId: 'aluno-1',
      }),
    );
  });

  it('carrega detalhes da reposição', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'PROFESSOR',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(getMakeupClassDetails).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'makeup-1',
        scope: 'COLETIVA',
        status: 'AGENDADA',
        observacao: null,
        createdAt: '2026-03-15T00:00:00.000Z',
        aluno: null,
        turmaOrigem: { id: 'turma-1', label: 'Origem' },
        turmaDestino: { id: 'turma-2', label: 'Destino' },
        eventoOrigem: { id: 'event-1', title: 'Evento origem', startAt: '2026-03-15T00:00:00.000Z' },
        eventoDestino: { id: 'event-2', title: 'Evento destino', startAt: '2026-03-16T00:00:00.000Z' },
      },
    } as never);

    const response = await GET_DETAILS(new NextRequest('http://localhost/api/aulas/reposicoes/makeup-1'), {
      params: Promise.resolve({ id: 'makeup-1' }),
    });

    expect(response.status).toBe(200);
    expect(getMakeupClassDetails).toHaveBeenCalledWith('conta-1', 'makeup-1');
  });

  it('atualiza status da reposição', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(updateMakeupClass).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'makeup-1',
        scope: 'COLETIVA',
        status: 'REALIZADA',
        observacao: null,
        createdAt: '2026-03-15T00:00:00.000Z',
        aluno: null,
        turmaOrigem: { id: 'turma-1', label: 'Origem' },
        turmaDestino: { id: 'turma-2', label: 'Destino' },
        eventoOrigem: { id: 'event-1', title: 'Evento origem', startAt: '2026-03-15T00:00:00.000Z' },
        eventoDestino: { id: 'event-2', title: 'Evento destino', startAt: '2026-03-16T00:00:00.000Z' },
      },
    } as never);

    const response = await PATCH(
      new NextRequest('http://localhost/api/aulas/reposicoes/makeup-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'REALIZADA' }),
      }),
      {
        params: Promise.resolve({ id: 'makeup-1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateMakeupClass).toHaveBeenCalledWith('conta-1', 'makeup-1', { status: 'REALIZADA' });
  });
});
