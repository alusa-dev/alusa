import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { dashboardPeriodoDTOSchema } from '@/features/dashboard/dtos';
import { mapDashboardSerieResultToDTO } from '@/features/dashboard/mappers';
import { runWithTenant } from '@/lib/prisma-tenant';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const { searchParams } = new URL(request.url);
    const periodo = dashboardPeriodoDTOSchema.parse(searchParams.get('periodo') || '30d');

    const contaId = (session?.user as { contaId?: string | null } | undefined)?.contaId;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Não autenticado' },
        { status: 401 },
      );
    }

    if (!contaId) {
      return NextResponse.json(
        { success: false, error: 'contaId não informado' },
        { status: 400 },
      );
    }

    const body = await runWithTenant(contaId, async (tx) => {
      const cobrancaFilter = { matricula: { aluno: { contaId } } };
      const now = new Date();

      const diasMap: Record<string, number> = {
        '1d': 1,
        '15d': 15,
        '30d': 30,
      };
      const dias = diasMap[periodo] || 30;

      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const cobrancasLiquidadasMes = await tx.cobranca.findMany({
        where: {
          ...cobrancaFilter,
          liquidacaoStatus: 'DISPONIVEL',
          liquidadoEm: { gte: startOfMonth, lte: endOfMonth },
        },
        select: {
          valor: true,
          asaasValue: true,
          asaasNetValue: true,
          liquidadoEm: true,
        },
      });

      const receitaMes = cobrancasLiquidadasMes.reduce((sum, c) => {
        const valorEfetivo = Number(c.asaasNetValue ?? c.asaasValue ?? c.valor ?? 0);
        return sum + valorEfetivo;
      }, 0);

      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

      const cobrancasLiquidadasMesAnterior = await tx.cobranca.findMany({
        where: {
          ...cobrancaFilter,
          liquidacaoStatus: 'DISPONIVEL',
          liquidadoEm: { gte: startOfLastMonth, lte: endOfLastMonth },
        },
        select: { valor: true, asaasValue: true, asaasNetValue: true },
      });

      const receitaMesAnterior = cobrancasLiquidadasMesAnterior.reduce((sum, c) => {
        const valorEfetivo = Number(c.asaasNetValue ?? c.asaasValue ?? c.valor ?? 0);
        return sum + valorEfetivo;
      }, 0);

      let variacaoPercentual: number | null = null;
      if (receitaMesAnterior > 0) {
        variacaoPercentual = ((receitaMes - receitaMesAnterior) / receitaMesAnterior) * 100;
      } else if (receitaMes > 0) {
        variacaoPercentual = 100;
      }

      const serie: number[] = [];
      const dataInicioPeriodo = new Date(now);
      dataInicioPeriodo.setDate(dataInicioPeriodo.getDate() - (dias - 1));
      dataInicioPeriodo.setHours(0, 0, 0, 0);

      const cobrancasPeriodo = await tx.cobranca.findMany({
        where: {
          ...cobrancaFilter,
          liquidacaoStatus: 'DISPONIVEL',
          liquidadoEm: { gte: dataInicioPeriodo, lte: now },
        },
        select: {
          valor: true,
          asaasValue: true,
          asaasNetValue: true,
          liquidadoEm: true,
        },
      });

      for (let i = dias - 1; i >= 0; i--) {
        const dia = new Date(now);
        dia.setDate(dia.getDate() - i);
        const inicioDia = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 0, 0, 0, 0);
        const fimDia = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 23, 59, 59, 999);

        const totalDia = cobrancasPeriodo
          .filter((c) => {
            if (!c.liquidadoEm) return false;
            return c.liquidadoEm >= inicioDia && c.liquidadoEm <= fimDia;
          })
          .reduce((sum, c) => {
            const valorEfetivo = Number(c.asaasNetValue ?? c.asaasValue ?? c.valor ?? 0);
            return sum + valorEfetivo;
          }, 0);

        serie.push(totalDia);
      }

      const serieAcumulada: number[] = [];
      let acumulado = 0;
      for (const valor of serie) {
        acumulado += valor;
        serieAcumulada.push(acumulado);
      }

      return mapDashboardSerieResultToDTO({
        success: true,
        data: {
          receitaMes,
          receitaMesAnterior,
          variacaoPercentual,
          serie,
          serieAcumulada,
          periodo,
        },
      });
    });

    return NextResponse.json(body);
  } catch (error) {
    console.error('[GET /api/dashboard/receita] Erro:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
