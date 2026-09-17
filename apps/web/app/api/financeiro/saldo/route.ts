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
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getBalance, getLocalAvailableBalance } from '@alusa/finance';
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
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuário não autenticado');

    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const { searchParams } = new URL(request.url);
    const { fonte } = financeiroSaldoQueryDTOSchema.parse({
      fonte: searchParams.get('fonte') ?? 'asaas',
    });

    if (fonte === 'asaas') {
      // Saldo real via API Asaas (fonte da verdade)
      const result = await getBalance({ contaId: auth.contaId });

      if (!result.success) {
        // Fallback para local se Asaas indisponível
        console.warn('[API Financeiro Saldo] Asaas indisponível, usando fallback local');
        return getSaldoLocal(auth.contaId);
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
    return getSaldoLocal(auth.contaId);
  } catch (error) {
    console.error('[API Financeiro Saldo] Erro ao consultar saldo:', error);
    return err(500, 'ERRO_INTERNO', 'Erro ao processar saldo');
  }
}

async function getSaldoLocal(contaId: string) {
  const saldo = await getLocalAvailableBalance(contaId);

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
