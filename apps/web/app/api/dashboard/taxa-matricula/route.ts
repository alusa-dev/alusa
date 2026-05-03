import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { dashboardPeriodoDTOSchema } from '@/features/dashboard/dtos';
import { mapDashboardSerieResultToDTO } from '@/features/dashboard/mappers';
import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';
import { PrivateMemoryCache, privateJson } from '@/lib/private-cache';

const taxaMatriculaCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 30,
  staleWhileRevalidateSeconds: 120,
});

export async function GET(request: NextRequest) {
  const timer = createPerfTimer('api/dashboard/taxa-matricula');
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

    const cacheKey = `${contaId}:${periodo}`;
    const cached = taxaMatriculaCache.get(cacheKey);
    if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
      timer.end('GET /dashboard/taxa-matricula (cache hit)', { cacheState: cached.state, periodo });
      return privateJson(cached.body, {
        maxAgeSeconds: 30,
        staleWhileRevalidateSeconds: 120,
        cacheState: cached.state,
      });
    }

    const body = await withPerfTimer(
      'dashboard',
      'getTaxaMatriculaMetrics',
      async () => {
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

        // Período anterior para calcular variação
        const dataInicioAnterior = new Date(dataInicioPeriodo);
        dataInicioAnterior.setDate(dataInicioAnterior.getDate() - dias);

        // Busca uma vez o período atual + anterior e agrega em memória.
        const taxasPagasRange = await prisma.cobranca.findMany({
          where: {
            ...cobrancaFilter,
            tipo: 'TAXA_MATRICULA',
            status: 'PAGO',
            OR: [
              { dataPagamento: { gte: dataInicioAnterior, lte: now } },
              { pagoEm: { gte: dataInicioAnterior, lte: now } },
            ],
          },
          select: {
            valor: true,
            valorFinal: true,
            dataPagamento: true,
            pagoEm: true,
          },
        });

        const taxasPagas = taxasPagasRange.filter((c) => {
          const dataPgto = c.pagoEm || c.dataPagamento;
          return dataPgto && dataPgto >= dataInicioPeriodo && dataPgto <= now;
        });

        // Total de taxas pagas no período
        const totalTaxas = taxasPagas.reduce((sum, c) => {
          const valorEfetivo = c.valorFinal ? Number(c.valorFinal) : Number(c.valor);
          return sum + valorEfetivo;
        }, 0);

        const taxasPagasAnterior = taxasPagasRange.filter((c) => {
          const dataPgto = c.pagoEm || c.dataPagamento;
          return dataPgto && dataPgto >= dataInicioAnterior && dataPgto < dataInicioPeriodo;
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

        return mapDashboardSerieResultToDTO({
          success: true,
          data: {
            totalTaxas,
            totalTaxasAnterior,
            variacaoPercentual,
            serie,
            serieAcumulada,
            periodo,
          },
        });
      },
      { contaId }
    );

    taxaMatriculaCache.set(cacheKey, body);
    timer.end('GET /dashboard/taxa-matricula (cache miss)', { periodo });
    return privateJson(body, {
      maxAgeSeconds: 30,
      staleWhileRevalidateSeconds: 120,
      cacheState: 'MISS',
    });
  } catch (error) {
    console.error('[GET /api/dashboard/taxa-matricula] Erro:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
