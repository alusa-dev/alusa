import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { dashboardPeriodoDTOSchema } from '@/features/dashboard/dtos';
import { mapDashboardSerieResultToDTO } from '@/features/dashboard/mappers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const { searchParams } = new URL(request.url);
    const periodo = dashboardPeriodoDTOSchema.parse(searchParams.get('periodo') || '30d');
    
    // MULTI-TENANT: usar apenas contaId da sessão
    const contaId = (session?.user as { contaId?: string | null } | undefined)?.contaId;

    if (!contaId) {
      return NextResponse.json(
        { success: false, error: 'Não autenticado' },
        { status: 401 },
      );
    }

    const cobrancaFilter = { matricula: { aluno: { contaId } } };
    const now = new Date();

    // Define quantidade de dias baseado no período
    const diasMap: Record<string, number> = {
      '15d': 15,
      '30d': 30,
      '1a': 365,
    };
    const dias = diasMap[periodo] || 30;

    // Data de início do período
    const dataInicioPeriodo = new Date(now);
    dataInicioPeriodo.setDate(dataInicioPeriodo.getDate() - (dias - 1));
    dataInicioPeriodo.setHours(0, 0, 0, 0);

    // Busca cobranças de taxa de matrícula pagas no período
    // Tipo = TAXA_MATRICULA e status = PAGO
    const taxasPagas = await prisma.cobranca.findMany({
      where: {
        ...cobrancaFilter,
        tipo: 'TAXA_MATRICULA',
        status: 'PAGO',
        OR: [
          { dataPagamento: { gte: dataInicioPeriodo, lte: now } },
          { pagoEm: { gte: dataInicioPeriodo, lte: now } },
        ],
      },
      select: { 
        valor: true, 
        valorFinal: true,
        dataPagamento: true,
        pagoEm: true,
      },
    });

    // Total de taxas pagas no período
    const totalTaxas = taxasPagas.reduce((sum, c) => {
      const valorEfetivo = c.valorFinal ? Number(c.valorFinal) : Number(c.valor);
      return sum + valorEfetivo;
    }, 0);

    // Período anterior para calcular variação
    const dataInicioAnterior = new Date(dataInicioPeriodo);
    dataInicioAnterior.setDate(dataInicioAnterior.getDate() - dias);

    const taxasPagasAnterior = await prisma.cobranca.findMany({
      where: {
        ...cobrancaFilter,
        tipo: 'TAXA_MATRICULA',
        status: 'PAGO',
        OR: [
          { dataPagamento: { gte: dataInicioAnterior, lt: dataInicioPeriodo } },
          { pagoEm: { gte: dataInicioAnterior, lt: dataInicioPeriodo } },
        ],
      },
      select: { valor: true, valorFinal: true },
    });

    const totalTaxasAnterior = taxasPagasAnterior.reduce((sum, c) => {
      const valorEfetivo = c.valorFinal ? Number(c.valorFinal) : Number(c.valor);
      return sum + valorEfetivo;
    }, 0);

    // Calcula variação percentual
    let variacaoPercentual: number | null = null;
    if (totalTaxasAnterior > 0) {
      variacaoPercentual = ((totalTaxas - totalTaxasAnterior) / totalTaxasAnterior) * 100;
    } else if (totalTaxas > 0) {
      variacaoPercentual = 100;
    }

    // Série de taxas por dia (para o gráfico)
    const serie: number[] = [];
    
    // Para período de 1 ano, agrupa por semana para não ter muitos pontos
    const pontos = periodo === '1a' ? 52 : dias;
    const diasPorPonto = periodo === '1a' ? 7 : 1;

    for (let i = pontos - 1; i >= 0; i--) {
      const diaFim = new Date(now);
      diaFim.setDate(diaFim.getDate() - (i * diasPorPonto));
      const diaInicio = new Date(diaFim);
      diaInicio.setDate(diaInicio.getDate() - diasPorPonto + 1);
      diaInicio.setHours(0, 0, 0, 0);
      diaFim.setHours(23, 59, 59, 999);

      const totalPonto = taxasPagas
        .filter(c => {
          const dataPgto = c.pagoEm || c.dataPagamento;
          if (!dataPgto) return false;
          return dataPgto >= diaInicio && dataPgto <= diaFim;
        })
        .reduce((sum, c) => {
          const valorEfetivo = c.valorFinal ? Number(c.valorFinal) : Number(c.valor);
          return sum + valorEfetivo;
        }, 0);

      serie.push(totalPonto);
    }

    // Série acumulada para visualização
    const serieAcumulada: number[] = [];
    let acumulado = 0;
    for (const valor of serie) {
      acumulado += valor;
      serieAcumulada.push(acumulado);
    }

    return NextResponse.json(
      mapDashboardSerieResultToDTO({
      success: true,
      data: {
        totalTaxas,
        totalTaxasAnterior,
        variacaoPercentual,
        serie,
        serieAcumulada,
        periodo,
      },
      }),
    );
  } catch (error) {
    console.error('[GET /api/dashboard/taxa-matricula] Erro:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
