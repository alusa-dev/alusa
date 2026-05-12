/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/src/server/aulas/session', () => ({
  canAccessAulas: vi.fn(),
  getAulasSessionUser: vi.fn(),
}));

vi.mock('@/src/server/aulas/experimentais/experimental.service', () => ({
  createExperimentalClass: vi.fn(),
  getExperimentalClassDetails: vi.fn(),
  updateExperimentalClass: vi.fn(),
}));

const { canAccessAulas, getAulasSessionUser } = await import('@/src/server/aulas/session');
const { createExperimentalClass, getExperimentalClassDetails, updateExperimentalClass } = await import(
  '@/src/server/aulas/experimentais/experimental.service'
);
const { POST } = await import('@/app/api/aulas/experimentais/route');
const { GET, PATCH } = await import('@/app/api/aulas/experimentais/[id]/route');

describe('/api/aulas/experimentais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cria aula experimental com body validado', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'RECEPCAO',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(createExperimentalClass).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'exp-1',
        calendarEventId: 'event-1',
        status: 'AGENDADA',
        observacao: null,
        aluno: { id: 'aluno-1', label: 'Maria' },
        turma: { id: 'turma-1', label: 'Ballet Kids' },
        sala: { id: 'sala-1', label: 'Sala 1' },
        professores: [{ id: 'prof-1', label: 'Ana' }],
        startAt: '2026-05-12T18:00:00.000Z',
        endAt: '2026-05-12T19:00:00.000Z',
        title: 'Aula experimental • Maria',
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/aulas/experimentais', {
        method: 'POST',
        body: JSON.stringify({
          alunoId: 'aluno-1',
          turmaId: 'turma-1',
          startAt: '2026-05-12T18:00:00.000Z',
          endAt: '2026-05-12T19:00:00.000Z',
          salaId: 'sala-1',
          professorIds: ['prof-1'],
          uiRequestId: 'ui-request-1',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createExperimentalClass).toHaveBeenCalledWith(
      'conta-1',
      'user-1',
      expect.objectContaining({
        alunoId: 'aluno-1',
        turmaId: 'turma-1',
      }),
    );
  });

  it('carrega detalhes da aula experimental', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(getExperimentalClassDetails).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'exp-1',
        calendarEventId: 'event-1',
        status: 'AGENDADA',
        observacao: null,
        aluno: { id: 'aluno-1', label: 'Maria' },
        turma: { id: 'turma-1', label: 'Ballet Kids' },
        sala: { id: 'sala-1', label: 'Sala 1' },
        professores: [{ id: 'prof-1', label: 'Ana' }],
        startAt: '2026-05-12T18:00:00.000Z',
        endAt: '2026-05-12T19:00:00.000Z',
        title: 'Aula experimental • Maria',
      },
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/aulas/experimentais/exp-1'), {
      params: Promise.resolve({ id: 'exp-1' }),
    });

    expect(response.status).toBe(200);
    expect(getExperimentalClassDetails).toHaveBeenCalledWith('conta-1', 'exp-1');
  });

  it('atualiza aula experimental', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(updateExperimentalClass).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'exp-1',
        calendarEventId: 'event-1',
        status: 'REAGENDADA',
        observacao: 'Aluno confirmou presença',
        aluno: { id: 'aluno-1', label: 'Maria' },
        turma: { id: 'turma-1', label: 'Ballet Kids' },
        sala: { id: 'sala-2', label: 'Sala 2' },
        professores: [{ id: 'prof-2', label: 'Bia' }],
        startAt: '2026-05-13T18:00:00.000Z',
        endAt: '2026-05-13T19:00:00.000Z',
        title: 'Aula experimental • Maria',
      },
    } as never);

    const response = await PATCH(
      new NextRequest('http://localhost/api/aulas/experimentais/exp-1', {
        method: 'PATCH',
        body: JSON.stringify({
          observacao: 'Aluno confirmou presença',
          startAt: '2026-05-13T18:00:00.000Z',
          endAt: '2026-05-13T19:00:00.000Z',
          salaId: 'sala-2',
          professorIds: ['prof-2'],
        }),
      }),
      {
        params: Promise.resolve({ id: 'exp-1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateExperimentalClass).toHaveBeenCalledWith(
      'conta-1',
      'exp-1',
      expect.objectContaining({
        observacao: 'Aluno confirmou presença',
      }),
    );
  });
});