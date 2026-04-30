/**
 * @module GET /api/financeiro/saldo
 * @description Consulta saldo disponível
 *
 * Query params:
 * - fonte: 'asaas' | 'local' (default: 'asaas')
 *   - 'asaas': Consulta saldo real via API Asaas (fonte da verdade)
 *   - 'local': Calcula saldo baseado em cobranças sincronizadas (cache)
 *
 * O saldo 'asaas' é a fonte da verdade financeira.
 * O saldo 'local' é útil para consistência com KPIs visuais.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { getBalance } from '@alusa/finance';
import { financeiroSaldoQueryDTOSchema } from '@/features/financeiro/dtos';
import { mapFinanceiroSaldoResultToDTO } from '@/features/financeiro/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;

    if (!user?.id || !user?.contaId) {
      return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const { searchParams } = new URL(request.url);
    const { fonte } = financeiroSaldoQueryDTOSchema.parse({
      fonte: searchParams.get('fonte') ?? 'asaas',
    });

    if (fonte === 'asaas') {
      // Saldo real via API Asaas (fonte da verdade)
      const result = await getBalance({ contaId: user.contaId });

      if (!result.success) {
        // Fallback para local se Asaas indisponível
        console.warn('[API Financeiro Saldo] Asaas indisponível, usando fallback local');
        return getSaldoLocal(user.contaId);
      }

      return NextResponse.json(
        mapFinanceiroSaldoResultToDTO({
          data: {
            saldoDisponivel: result.data.balance,
            fonte: 'asaas',
            consultadoEm: new Date().toISOString(),
          },
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    // Saldo local (cache sincronizado via webhooks)
    return getSaldoLocal(user.contaId);
  } catch (error) {
    console.error('[API Financeiro Saldo] Erro ao consultar saldo:', error);
    return err(500, 'ERRO_INTERNO', 'Erro ao processar saldo');
  }
}

async function getSaldoLocal(contaId: string) {
  const contaWhere = { matricula: { aluno: { contaId } } };

  // Soma de asaasNetValue onde liquidacaoStatus = DISPONIVEL
  // EXCLUIR recebimentos em dinheiro (RECEIVED_IN_CASH) pois não compõem o saldo do Asaas
  const saldoAgregado = await prisma.cobranca.aggregate({
    where: {
      ...contaWhere,
      liquidacaoStatus: 'DISPONIVEL',
      asaasStatus: { not: 'RECEIVED_IN_CASH' },
    },
    _sum: {
      asaasNetValue: true,
    },
  });

  const saldo = saldoAgregado._sum.asaasNetValue?.toNumber() ?? 0;

  return NextResponse.json(
    mapFinanceiroSaldoResultToDTO({
      data: {
        saldoDisponivel: saldo,
        fonte: 'local',
        consultadoEm: new Date().toISOString(),
      },
    }),
    { headers: { 'cache-control': 'no-store' } },
  );
}
