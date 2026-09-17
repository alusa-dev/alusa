import { NextRequest, NextResponse } from 'next/server';
import { contaFormaPagamentoResultDTOSchema } from '@/features/conta/dtos';
import { mapContaFormaPagamentoResultToDTO } from '@/features/conta/mappers';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getAccountPaymentMethodView } from '@/src/server/finance/account-payment-method.service';

export async function GET(_req: NextRequest) {
  try {
    //1. Autenticação
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const user = { id: auth.userId, role: auth.role ?? '', contaId: auth.contaId };

    if (!['RESPONSAVEL', 'ALUNO'].includes(user.role)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const result = await getAccountPaymentMethodView({
      contaId: user.contaId,
      userId: user.id,
      role: user.role as 'RESPONSAVEL' | 'ALUNO',
    });
    if (result.status === 'RESPONSAVEL_NOT_FOUND') {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }
    if (result.status === 'ALUNO_NOT_FOUND') {
      return NextResponse.json({ error: 'Aluno não encontrado' }, { status: 404 });
    }

    return NextResponse.json(
      contaFormaPagamentoResultDTOSchema.parse(mapContaFormaPagamentoResultToDTO({
      responsavel: result.responsavel
        ? {
            id: result.responsavel.id,
            nome: result.responsavel.nome,
            email: result.responsavel.email,
          }
        : null,
      assinaturas: result.assinaturas,
      })),
    );
  } catch (error) {
    console.error('Erro ao buscar forma de pagamento:', error);
    return NextResponse.json(
      { error: 'Erro ao buscar forma de pagamento' }, 
      { status: 500 }
    );
  }
}
