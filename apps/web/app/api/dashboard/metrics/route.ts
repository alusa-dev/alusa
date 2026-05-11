import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { dashboardMetricsResultDTOSchema } from '@/features/dashboard/dtos';
import { mapDashboardMetricsResultToDTO } from '@/features/dashboard/mappers';
import { autoCloseAgendaEventsInRange } from '@/src/server/aulas/agenda/agenda-event-auto-close.service';
import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';
import { PrivateMemoryCache, privateJson } from '@/lib/private-cache';

const dashboardMetricsCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 15,
  staleWhileRevalidateSeconds: 60,
});

type DashboardLessonEvent = {
  turmaId: string | null;
  status: string;
  startAt: Date;
  endAt: Date;
};

function getAttendanceLaunchState(event: DashboardLessonEvent): 'PENDENTE' | 'CANCELADA' | 'REALIZADA' | 'EM_ANDAMENTO' {
  const now = new Date();

  if (event.status === 'CANCELADO') return 'CANCELADA';
  if (event.status === 'REALIZADO') return 'REALIZADA';
  if (event.startAt.getTime() > now.getTime()) return 'PENDENTE';
  if (event.startAt.getTime() <= now.getTime() && event.endAt.getTime() >= now.getTime()) {
    return 'EM_ANDAMENTO';
  }

  return 'PENDENTE';
}

function getLaunchStatePriority(state: ReturnType<typeof getAttendanceLaunchState>) {
  switch (state) {
    case 'EM_ANDAMENTO':
      return 0;
    case 'PENDENTE':
      return 1;
    case 'REALIZADA':
      return 2;
    case 'CANCELADA':
      return 3;
    default:
      return 4;
  }
}

function buildTodayLessonSummary(events: DashboardLessonEvent[]) {
  const selectedStateByTurma = new Map<string, { state: ReturnType<typeof getAttendanceLaunchState>; priority: number; startAt: number }>();
  let aulasHoje = 0;

  for (const event of events) {
    if (event.status !== 'CANCELADO') {
      aulasHoje += 1;
    }

    if (!event.turmaId) continue;

    const state = getAttendanceLaunchState(event);
    const nextEntry = {
      state,
      priority: getLaunchStatePriority(state),
      startAt: event.startAt.getTime(),
    };
    const currentEntry = selectedStateByTurma.get(event.turmaId);

    if (
      !currentEntry ||
      nextEntry.priority < currentEntry.priority ||
      (nextEntry.priority === currentEntry.priority && nextEntry.startAt < currentEntry.startAt)
    ) {
      selectedStateByTurma.set(event.turmaId, nextEntry);
    }
  }

  const pendencias = Array.from(selectedStateByTurma.values()).filter(
    (item) => item.state === 'PENDENTE',
  ).length;

  return { aulasHoje, pendencias };
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function publicImageUrl(value: string | null | undefined) {
  if (!value) return null;
  return value.startsWith('data:image/') ? null : value;
}

function jsonWithShortPrivateCache(body: unknown) {
  return privateJson(body, {
    maxAgeSeconds: 15,
    staleWhileRevalidateSeconds: 60,
    cacheState: 'MISS',
  });
}

export async function GET(_request: NextRequest) {
  const timer = createPerfTimer('api/dashboard/metrics');
  try {
    const session = await getServerSession(authOptions);
    const contaIdFromSession = (session?.user as { contaId?: string | null } | undefined)?.contaId;

    // MULTI-TENANT: sempre usar contaId da sessão
    if (!contaIdFromSession) {
      return NextResponse.json(
        { success: false, error: 'Não autenticado' },
        { status: 401 },
      );
    }

    const contaId = contaIdFromSession;
    const cached = dashboardMetricsCache.get(contaId);
    if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
      timer.end('GET /dashboard/metrics (cache hit)', { cacheState: cached.state });
      return privateJson(cached.body, {
        maxAgeSeconds: 15,
        staleWhileRevalidateSeconds: 60,
        cacheState: cached.state,
      });
    }

    const alunoFilter = { contaId };
    const matriculaFilter = { aluno: { contaId } };
    const cobrancaFilter = { matricula: { aluno: { contaId } } };

    // Data atual e início do mês
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const next30Days = new Date(startOfToday);
    next30Days.setDate(next30Days.getDate() + 30);
    next30Days.setHours(23, 59, 59, 999);
    const next7Days = new Date(now);
    next7Days.setDate(next7Days.getDate() + 7);

    await withPerfTimer('api/dashboard/metrics', 'autoCloseAgendaEvents', () => 
      autoCloseAgendaEventsInRange({
        contaId,
        start: startOfToday,
        end: endOfToday,
        prismaClient: prisma,
      })
    );

    const weeklyWindows = Array.from({ length: 7 }, (_, index) => {
      const i = 6 - index;
      const dia = new Date(now);
      dia.setDate(dia.getDate() - i);
      const inicioDia = new Date(dia.setHours(0, 0, 0, 0));
      const fimDia = new Date(dia.setHours(23, 59, 59, 999));
      return { inicioDia, fimDia };
    });
    const startOfWeeklyWindow = weeklyWindows[0]?.inicioDia ?? startOfToday;

    const [
      totalAlunos,
      alunosAtivos,
      turmasAtivas,
      lessonEvents,
      aniversariantesDoMesData,
      totalMatriculas,
      matriculasAtivas,
      cobrancasPendentes,
      cobrancasVencidas,
      receitaMesAggregate,
      taxasMatriculaRecebidasAno,
      receitaTotalAggregate,
      proximosVencimentos,
      totalCobrancas,
      pagamentosSemanaData,
      matriculasSemanaData,
      ultimasCobrancasData,
      alunosRecentesData,
    ] = await withPerfTimer('api/dashboard/metrics', 'prisma Promise.all', () => Promise.all([
      prisma.aluno.count({ where: alunoFilter }),
      prisma.aluno.count({
        where: {
          ...alunoFilter,
          matriculas: { some: { status: 'ATIVA' } },
        },
      }),
      prisma.turma.count({ where: { contaId, status: 'ATIVO' } }),
      prisma.calendarEvent.findMany({
        where: {
          contaId,
          startAt: { lt: endOfToday },
          endAt: { gt: startOfToday },
          tipo: { in: ['AULA', 'REPOSICAO'] },
        },
        select: {
          turmaId: true,
          status: true,
          startAt: true,
          endAt: true,
        },
      }),
      prisma.aluno.findMany({
        where: {
          ...alunoFilter,
          status: 'ATIVO',
        },
        select: {
          id: true,
          nome: true,
          foto: true,
          dataNasc: true,
        },
      }),
      prisma.matricula.count({ where: matriculaFilter }),
      prisma.matricula.count({ where: { ...matriculaFilter, status: 'ATIVA' } }),
      prisma.cobranca.count({ where: { ...cobrancaFilter, status: 'PENDENTE' } }),
      prisma.cobranca.count({
        where: {
          ...cobrancaFilter,
          status: 'PENDENTE',
          vencimento: { lt: now },
        },
      }),
      prisma.pagamento.aggregate({
        where: {
          status: { in: ['CONFIRMADO', 'PAGO'] },
          dataPagamento: { gte: startOfMonth, lte: endOfMonth },
          cobranca: cobrancaFilter,
        },
        _sum: { valorPago: true },
      }),
      prisma.cobranca.findMany({
        where: {
          ...cobrancaFilter,
          tipo: 'TAXA_MATRICULA',
          status: 'PAGO',
          OR: [
            { dataPagamento: { gte: startOfYear, lte: now } },
            { pagoEm: { gte: startOfYear, lte: now } },
          ],
        },
        select: { valor: true, valorFinal: true },
      }),
      prisma.pagamento.aggregate({
        where: {
          status: { in: ['CONFIRMADO', 'PAGO'] },
          cobranca: cobrancaFilter,
        },
        _sum: { valorPago: true },
      }),
      prisma.cobranca.count({
        where: {
          ...cobrancaFilter,
          status: 'PENDENTE',
          vencimento: { gte: now, lte: next7Days },
        },
      }),
      prisma.cobranca.count({ where: cobrancaFilter }),
      prisma.pagamento.findMany({
        where: {
          status: { in: ['CONFIRMADO', 'PAGO'] },
          dataPagamento: { gte: startOfWeeklyWindow, lte: endOfToday },
          cobranca: cobrancaFilter,
        },
        select: {
          dataPagamento: true,
          valorPago: true,
        },
      }),
      prisma.matricula.findMany({
        where: {
          ...matriculaFilter,
          OR: [
            { createdAt: { gte: startOfWeeklyWindow, lte: endOfToday } },
            { status: 'CANCELADA', updatedAt: { gte: startOfWeeklyWindow, lte: endOfToday } },
          ],
        },
        select: {
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.cobranca.findMany({
        take: 5,
        where: cobrancaFilter,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          valor: true,
          vencimento: true,
          status: true,
          matricula: {
            select: {
              aluno: { select: { nome: true } },
            },
          },
        },
      }),
      prisma.aluno.findMany({
        take: 3,
        where: alunoFilter,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          nome: true,
          foto: true,
          createdAt: true,
        },
      }),
    ]));

    const { aulasHoje, pendencias } = buildTodayLessonSummary(lessonEvents);

    const aniversariantesDoMes = aniversariantesDoMesData
      .sort((a, b) => {
        const mesA = a.dataNasc.getMonth();
        const mesB = b.dataNasc.getMonth();
        if (mesA !== mesB) return mesA - mesB;
        const diaA = a.dataNasc.getDate();
        const diaB = b.dataNasc.getDate();
        if (diaA !== diaB) return diaA - diaB;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      })
      .map((aluno) => ({
        id: aluno.id,
        nome: aluno.nome,
        foto: publicImageUrl(aluno.foto),
        dia: aluno.dataNasc.getDate(),
        mes: aluno.dataNasc.getMonth() + 1,
        dataNascimento: aluno.dataNasc.toISOString(),
      }));

    const aniversariantesDoMesAtivos = aniversariantesDoMes.filter(
      (a) => a.mes === now.getMonth() + 1,
    ).length;

    const receitaMes = toNumber(receitaMesAggregate._sum.valorPago);
    const taxaMatriculaRecebidaAno = taxasMatriculaRecebidasAno.reduce((sum, cobranca) => {
      return sum + toNumber(cobranca.valorFinal ?? cobranca.valor);
    }, 0);
    const receitaTotal = toNumber(receitaTotalAggregate._sum.valorPago);
    const taxaInadimplencia = totalCobrancas > 0 ? (cobrancasVencidas / totalCobrancas) * 100 : 0;
    const receitaSemanal = weeklyWindows.map(({ inicioDia, fimDia }) =>
      pagamentosSemanaData.reduce((sum, pagamento) => {
        const dataPagamento = pagamento.dataPagamento;
        if (!dataPagamento || dataPagamento < inicioDia || dataPagamento > fimDia) return sum;
        return sum + toNumber(pagamento.valorPago);
      }, 0),
    );
    const matriculasNovasSemanal = weeklyWindows.map(({ inicioDia, fimDia }) =>
      matriculasSemanaData.filter((matricula) => (
        matricula.createdAt >= inicioDia && matricula.createdAt <= fimDia
      )).length,
    );
    const matriculasCanceladasSemanal = weeklyWindows.map(({ inicioDia, fimDia }) =>
      matriculasSemanaData.filter((matricula) => (
        matricula.status === 'CANCELADA' &&
        matricula.updatedAt >= inicioDia &&
        matricula.updatedAt <= fimDia
      )).length,
    );

    const ultimasCobrancas = ultimasCobrancasData.map((cobranca) => ({
      id: cobranca.id,
      aluno: cobranca.matricula.aluno.nome,
      valor: Number(cobranca.valor),
      vencimento: cobranca.vencimento.toISOString(),
      status: cobranca.status,
    }));

    const alunosRecentes = alunosRecentesData.map((aluno) => ({
      id: aluno.id,
      nome: aluno.nome,
      foto: publicImageUrl(aluno.foto),
      tipo: 'Novo cadastro',
    }));

    const metrics = {
      totalAlunos,
      alunosAtivos,
      turmasAtivas,
      aulasHoje,
      pendencias,
      aniversariantesDoMesAtivos,
      totalMatriculas,
      matriculasAtivas,
      cobrancasPendentes,
      cobrancasVencidas,
      receitaMes,
      taxaMatriculaRecebidaAno,
      receitaTotal,
      proximosVencimentos,
      taxaInadimplencia,
      receitaSemanal,
      matriculasNovasSemanal,
      matriculasCanceladasSemanal,
      ultimasCobrancas,
      alunosRecentes,
      aniversariantesDoMes,
    };

    const body = dashboardMetricsResultDTOSchema.parse(
      mapDashboardMetricsResultToDTO({
        success: true,
        data: metrics,
      }),
    );
    dashboardMetricsCache.set(contaId, body);

    timer.end('GET /dashboard/metrics (success)');
    return jsonWithShortPrivateCache(body);
  } catch (error) {
    console.error('[GET /api/dashboard/metrics] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}

