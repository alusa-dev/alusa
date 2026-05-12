/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/src/server/aulas/session', () => ({
  canAccessAulas: vi.fn(),
  getAulasSessionUser: vi.fn(),
}));

vi.mock('@/src/server/aulas/agenda/agenda.service', () => ({
  listAgendaResources: vi.fn(),
}));

const { canAccessAulas, getAulasSessionUser } = await import('@/src/server/aulas/session');
const { listAgendaResources } = await import('@/src/server/aulas/agenda/agenda.service');
const { GET } = await import('@/app/api/aulas/resources/route');

describe('/api/aulas/resources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não há sessão válida', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce(null);

    const response = await GET(new NextRequest('http://localhost/api/aulas/resources'));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'NAO_AUTENTICADO' });
  });

  it('lista recursos básicos sem alunos por padrão', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(listAgendaResources).mockResolvedValueOnce({
      turmas: [
        {
          id: 'turma-1',
          label: 'Ballet Kids',
          defaultSchedule: {
            daysOfWeek: ['SEG', 'QUA'],
            startTime: '18:00',
            endTime: '19:00',
            salaId: 'sala-1',
            professorIds: ['prof-1'],
          },
        },
      ],
      professores: [{ id: 'prof-1', label: 'Ana' }],
      salas: [{ id: 'sala-1', label: 'Sala 1' }],
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/aulas/resources'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(listAgendaResources).toHaveBeenCalledWith('conta-1', { includeAlunos: false });
    expect(json.turmas[0]).toEqual({
      id: 'turma-1',
      label: 'Ballet Kids',
      defaultSchedule: {
        daysOfWeek: ['SEG', 'QUA'],
        startTime: '18:00',
        endTime: '19:00',
        salaId: 'sala-1',
        professorIds: ['prof-1'],
      },
    });
  });

  it('inclui alunos quando solicitado', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'RECEPCAO',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(listAgendaResources).mockResolvedValueOnce({
      turmas: [{ id: 'turma-1', label: 'Ballet Kids' }],
      professores: [{ id: 'prof-1', label: 'Ana' }],
      salas: [{ id: 'sala-1', label: 'Sala 1' }],
      alunos: [{ id: 'aluno-1', label: 'Maria' }],
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/aulas/resources?includeAlunos=true'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(listAgendaResources).toHaveBeenCalledWith('conta-1', { includeAlunos: true });
    expect(json.alunos[0]).toEqual({ id: 'aluno-1', label: 'Maria' });
  });
});