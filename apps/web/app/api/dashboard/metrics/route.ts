import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { getFinanceiroKpisFromAsaas } from '@alusa/finance';
import { dashboardMetricsResultDTOSchema } from '@/features/dashboard/dtos';
import { mapDashboardMetricsResultToDTO } from '@/features/dashboard/mappers';
import { autoCloseAgendaEventsInRange } from '@/src/server/aulas/agenda/agenda-event-auto-close.service';

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

export async function GET(_request: NextRequest) {
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

    // Total de alunos
    const totalAlunos = await prisma.aluno.count({ where: alunoFilter });

    // Alunos ativos (com pelo menos uma matrícula ativa)
    const alunosAtivos = await prisma.aluno.count({
      where: {
        ...alunoFilter,
        matriculas: {
          some: {
            status: 'ATIVA',
          },
        },
      },
    });

    const turmasAtivas = await prisma.turma.count({
      where: {
        contaId,
        status: 'ATIVO',
      },
    });

    await autoCloseAgendaEventsInRange({
      contaId,
      start: startOfToday,
      end: endOfToday,
      prismaClient: prisma,
    });

    const lessonEvents = await prisma.calendarEvent.findMany({
      where: {
        contaId,
        startAt: { lt: endOfToday },
        endAt: { gt: startOfToday },
        tipo: {
          in: ['AULA', 'REPOSICAO'],
        },
      },
      select: {
        turmaId: true,
        status: true,
        startAt: true,
        endAt: true,
      },
    });

    const { aulasHoje, pendencias } = buildTodayLessonSummary(lessonEvents);

    const aniversariantesDoMesData = await prisma.aluno.findMany({
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
    });

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
        foto: aluno.foto,
        dia: aluno.dataNasc.getDate(),
        mes: aluno.dataNasc.getMonth() + 1,
        dataNascimento: aluno.dataNasc.toISOString(),
      }));

    const aniversariantesDoMesAtivos = aniversariantesDoMes.filter(
      (a) => a.mes === now.getMonth() + 1,
    ).length;

    // Total de matrículas
    const totalMatriculas = await prisma.matricula.count({ where: matriculaFilter });

    // Matrículas ativas
    const matriculasAtivas = await prisma.matricula.count({
      where: {
        ...matriculaFilter,
        status: 'ATIVA',
      },
    });

    // Cobranças pendentes
    const cobrancasPendentes = await prisma.cobranca.count({
      where: {
        ...cobrancaFilter,
        status: 'PENDENTE',
      },
    });

    // Cobranças vencidas (pendentes com vencimento anterior a hoje)
    const cobrancasVencidas = await prisma.cobranca.count({
      where: {
        ...cobrancaFilter,
        status: 'PENDENTE',
        vencimento: {
          lt: now,
        },
      },
    });

    // Receita do mês atual (cobranças pagas neste mês)
    const pagamentosMes = await prisma.pagamento.findMany({
      where: {
        status: {
          in: ['CONFIRMADO', 'PAGO'],
        },
        dataPagamento: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
        cobranca: cobrancaFilter,
      },
      select: {
        valorPago: true,
      },
    });

    const receitaMes = pagamentosMes.reduce((sum, p) => sum + Number(p.valorPago), 0);

    const financeiroKpis = await getFinanceiroKpisFromAsaas({
      contaId,
      mesAtual: startOfMonth,
      proximoMes: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      startOfToday,
      endOfNext30Days: next30Days,
    });

    const aguardandoPagamentoProximos30Dias =
      financeiroKpis.data.aguardandoPagamento.valorBruto;

    const taxasMatriculaRecebidasAno = await prisma.cobranca.findMany({
      where: {
        ...cobrancaFilter,
        tipo: 'TAXA_MATRICULA',
        status: 'PAGO',
        OR: [
          {
            dataPagamento: {
              gte: startOfYear,
              lte: now,
            },
          },
          {
            pagoEm: {
              gte: startOfYear,
              lte: now,
            },
          },
        ],
      },
      select: {
        valor: true,
        valorFinal: true,
      },
    });

    const taxaMatriculaRecebidaAno = taxasMatriculaRecebidasAno.reduce((sum, cobranca) => {
      const valorEfetivo = cobranca.valorFinal ? Number(cobranca.valorFinal) : Number(cobranca.valor);
      return sum + valorEfetivo;
    }, 0);

    // Receita total (todos os pagamentos confirmados)
    const pagamentosTotal = await prisma.pagamento.findMany({
      where: {
        status: {
          in: ['CONFIRMADO', 'PAGO'],
        },
        cobranca: cobrancaFilter,
      },
      select: {
        valorPago: true,
      },
    });

    const receitaTotal = pagamentosTotal.reduce((sum, p) => sum + Number(p.valorPago), 0);

    // Próximos vencimentos (7 dias)
    const proximosVencimentos = await prisma.cobranca.count({
      where: {
        ...cobrancaFilter,
        status: 'PENDENTE',
        vencimento: {
          gte: now,
          lte: next7Days,
        },
      },
    });

    // Taxa de inadimplência (cobranças vencidas / total de cobranças * 100)
    const totalCobrancas = await prisma.cobranca.count({ where: cobrancaFilter });
    const taxaInadimplencia = totalCobrancas > 0 ? (cobrancasVencidas / totalCobrancas) * 100 : 0;

    // Receita semanal (últimos 7 dias)
    const receitaSemanal: number[] = [];
    const matriculasNovasSemanal: number[] = [];
    const matriculasCanceladasSemanal: number[] = [];

    for (let i = 6; i >= 0; i--) {
      const dia = new Date(now);
      dia.setDate(dia.getDate() - i);
      const inicioDia = new Date(dia.setHours(0, 0, 0, 0));
      const fimDia = new Date(dia.setHours(23, 59, 59, 999));

      // Receita do dia
      const pagamentosDia = await prisma.pagamento.findMany({
        where: {
          status: {
            in: ['CONFIRMADO', 'PAGO'],
          },
          dataPagamento: {
            gte: inicioDia,
            lte: fimDia,
          },
          cobranca: cobrancaFilter,
        },
        select: {
          valorPago: true,
        },
      });

      const totalDia = pagamentosDia.reduce((sum, p) => sum + Number(p.valorPago), 0);
      receitaSemanal.push(totalDia);

      // Matrículas novas do dia
      const matriculasNovasDia = await prisma.matricula.count({
        where: {
          ...matriculaFilter,
          createdAt: {
            gte: inicioDia,
            lte: fimDia,
          },
        },
      });
      matriculasNovasSemanal.push(matriculasNovasDia);

      // Matrículas canceladas do dia
      const matriculasCanceladasDia = await prisma.matricula.count({
        where: {
          ...matriculaFilter,
          status: 'CANCELADA',
          updatedAt: {
            gte: inicioDia,
            lte: fimDia,
          },
        },
      });
      matriculasCanceladasSemanal.push(matriculasCanceladasDia);
    }

    // Últimas 5 cobranças
    const ultimasCobrancasData = await prisma.cobranca.findMany({
      take: 5,
      where: cobrancaFilter,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        matricula: {
          include: {
            aluno: {
              select: {
                nome: true,
              },
            },
          },
        },
      },
    });

    const ultimasCobrancas = ultimasCobrancasData.map((cobranca) => ({
      id: cobranca.id,
      aluno: cobranca.matricula.aluno.nome,
      valor: Number(cobranca.valor),
      vencimento: cobranca.vencimento.toISOString(),
      status: cobranca.status,
    }));

    // Últimos 3 alunos cadastrados (para o card de avatares)
    const alunosRecentesData = await prisma.aluno.findMany({
      take: 3,
      where: alunoFilter,
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        nome: true,
        foto: true,
        createdAt: true,
      },
    });

    const alunosRecentes = alunosRecentesData.map((aluno) => ({
      id: aluno.id,
      nome: aluno.nome,
      foto: aluno.foto,
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
      aguardandoPagamentoProximos30Dias,
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

    return NextResponse.json(
      dashboardMetricsResultDTOSchema.parse(mapDashboardMetricsResultToDTO({
      success: true,
      data: metrics,
      })),
    );
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
