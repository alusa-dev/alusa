/**
 * @module get-erp-revenue
 * @description Receita ERP agregada por competência + status interno
 *
 * Diferente do saldo Asaas (liquidação real), a receita ERP representa
 * o regime de competência contábil do sistema.
 *
 * Regras:
 * - Agrupa por competenciaInicio (mês de referência)
 * - Inclui cobranças pagas (status = PAGO) e recebidas em dinheiro
 * - Separa por liquidacaoStatus para visibilidade do fluxo de caixa
 */

import { PrismaClient } from '@prisma/client';
import type { Result } from '@alusa/shared';
import { ok } from '@alusa/shared';

// Instanciar prisma localmente para evitar dependência circular
const prisma = new PrismaClient();

export interface GetErpRevenueInput {
  contaId: string;
  /** Período de competência - formato: YYYY-MM */
  periodo?: string;
  /** Se true, retorna breakdown por mês */
  breakdown?: boolean;
}

export interface ErpRevenueItem {
  /** Mês de competência (YYYY-MM) */
  competencia: string;
  /** Valor bruto total */
  valorBruto: number;
  /** Valor líquido total (após taxas) */
  valorLiquido: number;
  /** Quantidade de cobranças */
  quantidadeCobrancas: number;
  /** Breakdown por status de liquidação */
  porLiquidacao: {
    disponivel: number;
    pendente: number;
    caixa: number; // RECEIVED_IN_CASH
  };
}

export interface GetErpRevenueOutput {
  /** Total geral */
  total: {
    valorBruto: number;
    valorLiquido: number;
    quantidadeCobrancas: number;
  };
  /** Breakdown por mês (se solicitado) */
  porMes?: ErpRevenueItem[];
  /** Período consultado */
  periodo: {
    inicio: string;
    fim: string;
  };
}

export type GetErpRevenueError = 'ERRO_AO_CALCULAR_RECEITA';

export async function getErpRevenue(
  input: GetErpRevenueInput,
): Promise<Result<GetErpRevenueOutput, GetErpRevenueError>> {
  const { contaId, periodo, breakdown = false } = input;

  // Determinar período
  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  if (periodo) {
    // Formato: YYYY-MM
    const [year, month] = periodo.split('-').map(Number);
    startDate = new Date(year, month - 1, 1);
    endDate = new Date(year, month, 0, 23, 59, 59, 999); // Último dia do mês
  } else {
    // Ano corrente
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  }

  const contaWhere = { matricula: { aluno: { contaId } } };

  // Buscar cobranças pagas no período de competência
  const cobrancas = await prisma.cobranca.findMany({
    where: {
      ...contaWhere,
      status: 'PAGO',
      competenciaInicio: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      competenciaInicio: true,
      valor: true,
      asaasValue: true,
      asaasNetValue: true,
      asaasStatus: true,
      liquidacaoStatus: true,
    },
  });

  // Agregar totais
  let totalBruto = 0;
  let totalLiquido = 0;

  // Map para breakdown por mês
  const porMesMap = new Map<string, ErpRevenueItem>();

  for (const c of cobrancas) {
    const valorBruto = Number(c.asaasValue ?? c.valor ?? 0);
    const valorLiquido = Number(c.asaasNetValue ?? c.asaasValue ?? c.valor ?? 0);

    totalBruto += valorBruto;
    totalLiquido += valorLiquido;

    if (breakdown) {
      const mesKey = c.competenciaInicio.toISOString().slice(0, 7); // YYYY-MM

      if (!porMesMap.has(mesKey)) {
        porMesMap.set(mesKey, {
          competencia: mesKey,
          valorBruto: 0,
          valorLiquido: 0,
          quantidadeCobrancas: 0,
          porLiquidacao: { disponivel: 0, pendente: 0, caixa: 0 },
        });
      }

      const item = porMesMap.get(mesKey)!;
      item.valorBruto += valorBruto;
      item.valorLiquido += valorLiquido;
      item.quantidadeCobrancas += 1;

      // Classificar por liquidação
      if (c.asaasStatus === 'RECEIVED_IN_CASH') {
        item.porLiquidacao.caixa += valorLiquido;
      } else if (c.liquidacaoStatus === 'DISPONIVEL') {
        item.porLiquidacao.disponivel += valorLiquido;
      } else {
        item.porLiquidacao.pendente += valorLiquido;
      }
    }
  }

  const result: GetErpRevenueOutput = {
    total: {
      valorBruto: totalBruto,
      valorLiquido: totalLiquido,
      quantidadeCobrancas: cobrancas.length,
    },
    periodo: {
      inicio: startDate.toISOString(),
      fim: endDate.toISOString(),
    },
  };

  if (breakdown) {
    // Ordenar por mês
    result.porMes = Array.from(porMesMap.values()).sort((a, b) =>
      a.competencia.localeCompare(b.competencia),
    );
  }

  return ok(result);
}
