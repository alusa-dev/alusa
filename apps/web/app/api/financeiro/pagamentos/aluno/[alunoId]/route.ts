import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { financeiroPagamentoAlunoParamsDTOSchema } from '@/features/financeiro/dtos';
import { mapFinanceiroPagamentoPessoaHistoricoResultToDTO } from '@/features/financeiro/mappers';
import { getStudentPaymentHistory } from '@/src/server/finance/student-payment-history';
import { buildPersonPaymentLedger } from '@/src/server/finance/person-payment-ledger';
import { getStudentPaymentPerson } from '@/src/server/finance/student-payment-person.service';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

/**
 * GET /api/financeiro/pagamentos/aluno/[alunoId]
 * Retorna o histórico consolidado de pagamentos do aluno e entidade responsável.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ alunoId: string }> },
) {
  try {
    const rawParams = await params;
    const reconcile = req.nextUrl.searchParams.get('reconcile') === '1';
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: { message: 'Usuário não autenticado' } },
        { status: 401 },
      );
    }
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return NextResponse.json(
        { success: false, error: { message: 'Acesso negado' } },
        { status: 403 },
      );
    }

    const parsedParams = financeiroPagamentoAlunoParamsDTOSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: { message: 'ID do aluno é obrigatório' } },
        { status: 400 },
      );
    }
    const { alunoId } = parsedParams.data;
    const contaId = auth.contaId;

    const aluno = await getStudentPaymentPerson({ contaId, alunoId });

    if (!aluno) {
      return NextResponse.json(
        { success: false, error: { message: 'Aluno não encontrado' } },
        { status: 404 },
      );
    }

    const ledger =
      reconcile
        ? null
        : await buildPersonPaymentLedger({
            contaId,
            personType: 'ALUNO',
            personId: alunoId,
          });
    const historico =
      ledger ??
      (await getStudentPaymentHistory(contaId, alunoId, aluno.nome, {
        reconcile,
      }));
    const pessoa =
      'pessoa' in historico
        ? historico.pessoa
        : {
            ...aluno,
            tipo: 'ALUNO' as const,
            alunosVinculados: [{ id: aluno.id, nome: aluno.nome }],
          };

    const payload = mapFinanceiroPagamentoPessoaHistoricoResultToDTO({
      success: true,
      data: {
        pessoa,
        aluno,
        cobrancas: historico.cobrancas,
        resumo: historico.resumo,
      },
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[GET /api/financeiro/pagamentos/aluno/[alunoId]]', error);
    return NextResponse.json(
      {
        success: false,
        error: { message: 'Erro ao buscar dados' },
      },
      { status: 500 },
    );
  }
}
