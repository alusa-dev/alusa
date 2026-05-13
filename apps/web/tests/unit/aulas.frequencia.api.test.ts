/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/src/server/aulas/session', () => ({
  canAccessAulas: vi.fn(),
  getAulasSessionUser: vi.fn(),
  resolveAulasAccessScope: vi.fn(),
}));

vi.mock('@/src/server/aulas/frequencia/attendance.service', () => ({
  getAttendanceEventDetails: vi.fn(),
  listAttendanceHistory: vi.fn(),
  listAttendanceHistoryByTurma: vi.fn(),
  saveAttendanceForEvent: vi.fn(),
}));

const { canAccessAulas, getAulasSessionUser, resolveAulasAccessScope } = await import('@/src/server/aulas/session');
const {
  getAttendanceEventDetails,
  listAttendanceHistory,
  listAttendanceHistoryByTurma,
  saveAttendanceForEvent,
} = await import(
  '@/src/server/aulas/frequencia/attendance.service'
);
const { GET: GET_HISTORY } = await import('@/app/api/aulas/frequencia/route');
const { GET: GET_TURMA_HISTORY } = await import(
  '@/app/api/aulas/frequencia/turmas/[turmaId]/historico/route'
);
const { GET: GET_EVENT, PUT: PUT_EVENT } = await import('@/app/api/aulas/frequencia/[eventId]/route');

describe('/api/aulas/frequencia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 403 quando o usuário não pode acessar aulas', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(false);

    const response = await GET_HISTORY(new NextRequest('http://localhost/api/aulas/frequencia'));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json).toEqual({ error: 'SEM_PERMISSAO' });
  });

  it('lista histórico de frequência com filtros normalizados', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'PROFESSOR',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(resolveAulasAccessScope).mockResolvedValueOnce({
      contaId: 'conta-1',
      userId: 'user-1',
      role: 'PROFESSOR',
      isProfessor: true,
      professorId: 'prof-1',
      professorLabel: 'Prof. Thamara',
    });
    vi.mocked(listAttendanceHistory).mockResolvedValueOnce({
      success: true,
      data: {
        timeZone: 'America/Sao_Paulo',
        resources: {
          turmas: [],
          professores: [],
        },
        summary: {
          totalTurmas: 1,
          totalOcorrencias: 3,
          recorded: 3,
          presentes: 1,
          faltas: 0,
          justificadas: 0,
          atrasos: 0,
          reposicoes: 0,
        },
        items: [],
      },
    } as never);

    const response = await GET_HISTORY(
      new NextRequest(
        'http://localhost/api/aulas/frequencia?startDate=2026-03-01T00:00:00.000Z&endDate=2026-03-31T23:59:59.999Z',
      ),
    );

    expect(response.status).toBe(200);
    expect(listAttendanceHistory).toHaveBeenCalledWith('conta-1', {
      startDate: '2026-03-01T00:00:00.000Z',
      endDate: '2026-03-31T23:59:59.999Z',
      turmaId: undefined,
      professorId: 'prof-1',
    });
  });

  it('lista ocorrências lançadas de uma turma no histórico', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'PROFESSOR',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(resolveAulasAccessScope).mockResolvedValueOnce({
      contaId: 'conta-1',
      userId: 'user-1',
      role: 'PROFESSOR',
      isProfessor: true,
      professorId: 'prof-1',
      professorLabel: 'Prof. Thamara',
    });
    vi.mocked(listAttendanceHistoryByTurma).mockResolvedValueOnce({
      success: true,
      data: {
        timeZone: 'America/Sao_Paulo',
        turma: { id: 'turma-1', label: 'Ballet Clássico' },
        summary: {
          totalOcorrencias: 2,
          recorded: 10,
          presentes: 8,
          faltas: 2,
          justificadas: 0,
          atrasos: 0,
          reposicoes: 0,
        },
        items: [],
      },
    } as never);

    const response = await GET_TURMA_HISTORY(
      new NextRequest(
        'http://localhost/api/aulas/frequencia/turmas/turma-1/historico?startDate=2026-03-01T00:00:00.000Z&endDate=2026-03-31T23:59:59.999Z',
      ),
      { params: Promise.resolve({ turmaId: 'turma-1' }) },
    );

    expect(response.status).toBe(200);
    expect(listAttendanceHistoryByTurma).toHaveBeenCalledWith('conta-1', 'turma-1', {
      startDate: '2026-03-01T00:00:00.000Z',
      endDate: '2026-03-31T23:59:59.999Z',
      turmaId: undefined,
      professorId: 'prof-1',
    });
  });

  it('salva a chamada por ocorrência', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(saveAttendanceForEvent).mockResolvedValueOnce({
      success: true,
      timeZone: 'America/Sao_Paulo',
      data: {
        event: {
          id: 'event-1',
          type: 'AULA',
          status: 'AGENDADO',
          title: 'Ballet Kids',
          description: null,
          startAt: '2026-03-20T18:00:00.000Z',
          endAt: '2026-03-20T19:00:00.000Z',
          source: 'TURMA_RECORRENTE',
          manuallyAdjusted: false,
          turma: { id: 'turma-1', label: 'Ballet Kids' },
          sala: null,
          professores: [],
          attendanceSummary: {
            totalEligible: 1,
            recorded: 1,
            presente: 1,
            falta: 0,
            faltaJustificada: 0,
            atraso: 0,
            reposicao: 0,
          },
          conflicts: [],
          makeupsAsOrigin: [],
          makeupsAsDestination: [],
        },
        students: [],
        summary: {
          totalEligible: 1,
          recorded: 1,
          presente: 1,
          falta: 0,
          faltaJustificada: 0,
          atraso: 0,
          reposicao: 0,
        },
      },
    } as never);

    const response = await PUT_EVENT(
      new NextRequest('http://localhost/api/aulas/frequencia/event-1', {
        method: 'PUT',
        body: JSON.stringify({
          items: [
            {
              alunoId: 'aluno-1',
              matriculaId: 'matricula-1',
              status: 'PRESENTE',
              observacao: 'Pontual',
            },
          ],
        }),
      }),
      { params: Promise.resolve({ eventId: 'event-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(saveAttendanceForEvent).toHaveBeenCalledWith('conta-1', 'event-1', 'user-1', {
      items: [
        {
          alunoId: 'aluno-1',
          matriculaId: 'matricula-1',
          status: 'PRESENTE',
          observacao: 'Pontual',
        },
      ],
    });
    expect(json.success).toBe(true);
  });

  it('carrega os detalhes de uma chamada', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(getAttendanceEventDetails).mockResolvedValueOnce({
      success: true,
      timeZone: 'America/Sao_Paulo',
      data: {
        event: {
          id: 'event-1',
          type: 'AULA',
          status: 'AGENDADO',
          title: 'Ballet Kids',
          description: null,
          startAt: '2026-03-20T18:00:00.000Z',
          endAt: '2026-03-20T19:00:00.000Z',
          source: 'TURMA_RECORRENTE',
          manuallyAdjusted: false,
          turma: { id: 'turma-1', label: 'Ballet Kids' },
          sala: null,
          professores: [],
          attendanceSummary: {
            totalEligible: 1,
            recorded: 0,
            presente: 0,
            falta: 0,
            faltaJustificada: 0,
            atraso: 0,
            reposicao: 0,
          },
          conflicts: [],
          makeupsAsOrigin: [],
          makeupsAsDestination: [],
        },
        students: [],
        summary: {
          totalEligible: 1,
          recorded: 0,
          presente: 0,
          falta: 0,
          faltaJustificada: 0,
          atraso: 0,
          reposicao: 0,
        },
      },
    } as never);

    const response = await GET_EVENT(new NextRequest('http://localhost/api/aulas/frequencia/event-1'), {
      params: Promise.resolve({ eventId: 'event-1' }),
    });

    expect(response.status).toBe(200);
    expect(getAttendanceEventDetails).toHaveBeenCalledWith('conta-1', 'event-1');
  });
});
