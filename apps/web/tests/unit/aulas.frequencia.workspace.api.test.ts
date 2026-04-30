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

vi.mock('@/src/server/aulas/frequencia/attendance-workspace.service', () => ({
  getAttendanceTurmaWorkspace: vi.fn(),
  listAttendanceWorkspace: vi.fn(),
}));

const { canAccessAulas, getAulasSessionUser, resolveAulasAccessScope } = await import('@/src/server/aulas/session');
const { getAttendanceTurmaWorkspace, listAttendanceWorkspace } = await import(
  '@/src/server/aulas/frequencia/attendance-workspace.service'
);
const { GET: GET_WORKSPACE } = await import('@/app/api/aulas/frequencia/workspace/route');
const { GET: GET_TURMA_WORKSPACE } = await import(
  '@/app/api/aulas/frequencia/turmas/[turmaId]/route'
);

describe('/api/aulas/frequencia workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista o catálogo operacional de turmas por data', async () => {
    const user = {
      id: 'user-1',
      contaId: 'conta-1',
      role: 'PROFESSOR',
      email: 'prof@test.com',
    };
    const scope = {
      contaId: 'conta-1',
      userId: 'user-1',
      role: 'PROFESSOR',
      isProfessor: true,
      professorId: 'prof-1',
      professorLabel: 'Prof. Thamara',
    };
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce(user);
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(resolveAulasAccessScope).mockResolvedValueOnce(scope);
    vi.mocked(listAttendanceWorkspace).mockResolvedValueOnce({
      success: true,
      data: {
        selectedDate: '2026-03-16T00:00:00.000Z',
        professorScope: {
          active: true,
          professorId: 'prof-1',
          label: 'Prof. Thamara',
        },
        summary: {
          totalTurmas: 1,
          comAula: 1,
          pendentes: 1,
          emAndamento: 0,
          realizadas: 0,
          semAula: 0,
        },
        items: [],
      },
    } as never);

    const response = await GET_WORKSPACE(
      new NextRequest(
        'http://localhost/api/aulas/frequencia/workspace?date=2026-03-16T00:00:00.000Z&search=ballet',
      ),
    );

    expect(response.status).toBe(200);
    expect(listAttendanceWorkspace).toHaveBeenCalledWith(
      scope,
      {
        date: '2026-03-16T00:00:00.000Z',
        search: 'ballet',
      },
    );
  });

  it('carrega o workspace operacional de uma turma na data selecionada', async () => {
    const user = {
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
      email: 'admin@test.com',
    };
    const scope = {
      contaId: 'conta-1',
      userId: 'user-1',
      role: 'ADMIN',
      isProfessor: false,
      professorId: null,
      professorLabel: null,
    };
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce(user);
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(resolveAulasAccessScope).mockResolvedValueOnce(scope);
    vi.mocked(getAttendanceTurmaWorkspace).mockResolvedValueOnce({
      success: true,
      data: {
        selectedDate: '2026-03-16T00:00:00.000Z',
        turma: { id: 'turma-1', label: 'Ballet Clássico - Matutino' },
        sala: { id: 'sala-1', label: 'Sala 01' },
        professores: [{ id: 'prof-1', label: 'Thamara' }],
        occurrences: [],
        selectedOccurrenceId: null,
      },
    } as never);

    const response = await GET_TURMA_WORKSPACE(
      new NextRequest('http://localhost/api/aulas/frequencia/turmas/turma-1?date=2026-03-16T00:00:00.000Z'),
      { params: Promise.resolve({ turmaId: 'turma-1' }) },
    );

    expect(response.status).toBe(200);
    expect(getAttendanceTurmaWorkspace).toHaveBeenCalledWith(
      scope,
      'turma-1',
      {
        date: '2026-03-16T00:00:00.000Z',
        search: undefined,
      },
    );
  });
});
