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

vi.mock('@/src/server/aulas/agenda/agenda.service', () => ({
  createAgendaEvent: vi.fn(),
  listAgendaEvents: vi.fn(),
}));

const { canAccessAulas, getAulasSessionUser, resolveAulasAccessScope } = await import('@/src/server/aulas/session');
const { createAgendaEvent, listAgendaEvents } = await import('@/src/server/aulas/agenda/agenda.service');
const { GET, POST } = await import('@/app/api/aulas/agenda/route');

describe('/api/aulas/agenda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não há sessão válida', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce(null);

    const response = await GET(new NextRequest('http://localhost/api/aulas/agenda'));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({ error: 'NAO_AUTENTICADO' });
  });

  it('lista agenda com DTO estável', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(resolveAulasAccessScope).mockResolvedValueOnce({
      contaId: 'conta-1',
      userId: 'user-1',
      role: 'ADMIN',
      isProfessor: false,
      professorId: null,
      professorLabel: null,
    });
    vi.mocked(listAgendaEvents).mockResolvedValueOnce({
      success: true,
      data: {
        range: {
          start: '2026-03-15T00:00:00.000Z',
          end: '2026-03-21T23:59:59.999Z',
        },
        timeZone: 'America/Sao_Paulo',
        resources: {
          turmas: [{ id: 'turma-1', label: 'Ballet Kids' }],
          professores: [{ id: 'prof-1', label: 'Ana' }],
          salas: [{ id: 'sala-1', label: 'Sala 1' }],
        },
        events: [],
      },
    } as never);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/aulas/agenda?start=2026-03-15T00:00:00.000Z&end=2026-03-21T23:59:59.999Z&turmaId=turma-1&type=AULA',
      ),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(listAgendaEvents).toHaveBeenCalledWith(
      'conta-1',
      {
        start: '2026-03-15T00:00:00.000Z',
        end: '2026-03-21T23:59:59.999Z',
        turmaId: 'turma-1',
        professorId: undefined,
        salaId: undefined,
        type: ['AULA'],
        status: undefined,
        viewMode: undefined,
      },
      expect.any(Object),
    );
    expect(response.headers.get('server-timing')).toBeTruthy();
    expect(json.success).toBe(true);
    expect(json.data.resources.turmas[0]).toEqual({ id: 'turma-1', label: 'Ballet Kids' });
  });

  it('aceita resposta compacta sem resources quando solicitado', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(resolveAulasAccessScope).mockResolvedValueOnce({
      contaId: 'conta-1',
      userId: 'user-1',
      role: 'ADMIN',
      isProfessor: false,
      professorId: null,
      professorLabel: null,
    });
    vi.mocked(listAgendaEvents).mockResolvedValueOnce({
      success: true,
      data: {
        range: {
          start: '2026-03-15T00:00:00.000Z',
          end: '2026-03-21T23:59:59.999Z',
        },
        timeZone: 'America/Sao_Paulo',
        events: [],
      },
    } as never);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/aulas/agenda?start=2026-03-15T00:00:00.000Z&end=2026-03-21T23:59:59.999Z&includeResources=false',
      ),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(listAgendaEvents).toHaveBeenCalledWith(
      'conta-1',
      {
        start: '2026-03-15T00:00:00.000Z',
        end: '2026-03-21T23:59:59.999Z',
        turmaId: undefined,
        professorId: undefined,
        salaId: undefined,
        type: undefined,
        status: undefined,
        viewMode: undefined,
        includeResources: false,
      },
      expect.any(Object),
    );
    expect(json.data.resources).toBeUndefined();
    expect(json.data.events).toEqual([]);
    expect(response.headers.get('server-timing')).toBeTruthy();
  });

  it('cria um evento manual', async () => {
    vi.mocked(getAulasSessionUser).mockResolvedValueOnce({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'RECEPCAO',
    });
    vi.mocked(canAccessAulas).mockReturnValueOnce(true);
    vi.mocked(createAgendaEvent).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'event-1',
        type: 'AULA',
        status: 'AGENDADO',
        title: 'Ballet Intermediário',
        description: null,
        startAt: '2026-03-18T18:00:00.000Z',
        endAt: '2026-03-18T19:00:00.000Z',
        source: 'MANUAL',
        manuallyAdjusted: true,
        turma: { id: 'turma-1', label: 'Ballet Intermediário' },
        sala: { id: 'sala-1', label: 'Sala 1' },
        professores: [{ id: 'prof-1', nome: 'Ana' }],
        attendanceSummary: null,
        conflicts: [],
        makeupsAsOrigin: [],
        makeupsAsDestination: [],
      },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost/api/aulas/agenda', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Ballet Intermediário',
          type: 'AULA',
          startAt: '2026-03-18T18:00:00.000Z',
          endAt: '2026-03-18T19:00:00.000Z',
          turmaId: 'turma-1',
          salaId: 'sala-1',
          professorIds: ['prof-1'],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(createAgendaEvent).toHaveBeenCalledWith('conta-1', {
      title: 'Ballet Intermediário',
      description: undefined,
      type: 'AULA',
      startAt: '2026-03-18T18:00:00.000Z',
      endAt: '2026-03-18T19:00:00.000Z',
      turmaId: 'turma-1',
      salaId: 'sala-1',
      professorIds: ['prof-1'],
    });
    expect(json.data.id).toBe('event-1');
  });
});
