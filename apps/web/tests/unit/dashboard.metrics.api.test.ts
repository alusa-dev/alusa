import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockAutoCloseAgendaEventsInRange = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  aluno: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  turma: {
    count: vi.fn(),
  },
  matricula: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  cobranca: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  pagamento: {
    aggregate: vi.fn(),
    findMany: vi.fn(),
  },
  calendarEvent: {
    findMany: vi.fn(),
  },
}));

vi.mock('next-auth', () => ({
  getServerSession: () => mockGetServerSession(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/src/server/aulas/agenda/agenda-event-auto-close.service', () => ({
  autoCloseAgendaEventsInRange: mockAutoCloseAgendaEventsInRange,
}));

import { GET } from '@/app/api/dashboard/metrics/route';

describe('GET /api/dashboard/metrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T15:00:00.000Z'));
    vi.clearAllMocks();

    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    });

    prismaMock.aluno.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(8);
    prismaMock.turma.count.mockResolvedValue(4);
    prismaMock.aluno.findMany.mockResolvedValue([]);
    prismaMock.matricula.count.mockResolvedValue(0);
    prismaMock.matricula.findMany.mockResolvedValue([]);
    prismaMock.cobranca.count.mockResolvedValue(0);
    prismaMock.cobranca.findMany
      .mockResolvedValueOnce([
        {
          valor: 150,
          valorFinal: null,
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.pagamento.aggregate.mockResolvedValue({ _sum: { valorPago: 0 } });
    prismaMock.pagamento.findMany.mockResolvedValue([]);
    prismaMock.calendarEvent.findMany.mockResolvedValue([
      {
        turmaId: 'turma-1',
        status: 'AGENDADO',
        startAt: new Date('2026-03-26T18:00:00.000Z'),
        endAt: new Date('2026-03-26T19:00:00.000Z'),
      },
      {
        turmaId: 'turma-2',
        status: 'AGENDADO',
        startAt: new Date('2026-03-26T12:00:00.000Z'),
        endAt: new Date('2026-03-26T13:00:00.000Z'),
      },
      {
        turmaId: 'turma-3',
        status: 'REALIZADO',
        startAt: new Date('2026-03-26T09:00:00.000Z'),
        endAt: new Date('2026-03-26T10:00:00.000Z'),
      },
      {
        turmaId: 'turma-4',
        status: 'CANCELADO',
        startAt: new Date('2026-03-26T20:00:00.000Z'),
        endAt: new Date('2026-03-26T21:00:00.000Z'),
      },
    ]);
  });

  it('retorna turmas ativas e taxa de matrícula recebida no ano nas métricas do dashboard', async () => {
    const response = await GET(new NextRequest('http://localhost/api/dashboard/metrics'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.turmasAtivas).toBe(4);
    expect(json.data.taxaMatriculaRecebidaAno).toBe(150);
    expect(mockAutoCloseAgendaEventsInRange).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
      }),
    );
    expect(prismaMock.pagamento.aggregate).toHaveBeenCalled();
  });
});
