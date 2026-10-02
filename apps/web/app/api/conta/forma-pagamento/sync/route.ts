import { NextRequest, NextResponse } from 'next/server';
import { contaFormaPagamentoSyncResultDTOSchema } from '@/features/account/dtos';
import { mapContaFormaPagamentoSyncResultToDTO } from '@/features/account/mappers';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { synchronizeAccountPaymentMethod } from '@/src/server/finance/account-payment-method.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

/**
 * API para sincronizar dados de cartão e forma de pagamento do Asaas
 * 
 * Busca:
 * - Dados do cartão salvo no customer
 * - Forma de pagamento (billingType) da assinatura ativa
 * 
 * E salva localmente no modelo Responsavel
 */
export async function POST(_req: NextRequest) {
  try {
    // 1. Autenticação
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const user = { id: auth.userId, role: auth.role ?? '', contaId: auth.contaId };
    
    // 2. Apenas RESPONSAVEL pode acessar
    if (user.role !== 'RESPONSAVEL') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const forceRefresh = _req.nextUrl.searchParams.get('fresh') === '1';

    const result = await synchronizeAccountPaymentMethod({
      contaId: user.contaId,
      userId: user.id,
      forceRefresh,
    });
    return NextResponse.json(
      contaFormaPagamentoSyncResultDTOSchema.parse(mapContaFormaPagamentoSyncResultToDTO(result)),
    );

  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'conta.payment_method.sync_failed',
      route: '/api/conta/forma-pagamento/sync',
      method: 'POST',
      requestId: getRequestId(_req),
      error,
    });
    return NextResponse.json(
      { error: 'Erro ao sincronizar dados do Asaas' }, 
      { status: 500 }
    );
  }
}
