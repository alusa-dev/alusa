import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { financeiroPagamentoAlunoParamsDTOSchema } from '@/features/financeiro/dtos';
import { mapFinanceiroPagamentoAlunoCobrancasResultToDTO } from '@/features/financeiro/mappers';
import { getStudentPaymentHistory } from '@/src/server/finance/student-payment-history';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

/**
 * GET /api/financeiro/pagamentos/aluno/[alunoId]
 * Retorna o histórico consolidado de pagamentos do aluno e entidade responsável.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ alunoId: string }> },
) {
  try {
    const rawParams = await params;
    const session = await safeGetServerSession();
    const user = (
      session as { user?: { id?: string; contaId?: string; role?: string } } | null
    )?.user;
    if (!user?.id || !user?.contaId) {
      return NextResponse.json(
        { success: false, error: { message: 'Usuário não autenticado' } },
        { status: 401 },
      );
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
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
    const contaId = user.contaId;

    const aluno = await prisma.aluno.findFirst({
      where: { id: alunoId, contaId },
      select: { id: true, nome: true, email: true, telefone: true, cpf: true, foto: true },
    });

    if (!aluno) {
      return NextResponse.json(
        { success: false, error: { message: 'Aluno não encontrado' } },
        { status: 404 },
      );
    }

    const historico = await getStudentPaymentHistory(contaId, alunoId, aluno.nome);

    const payload = mapFinanceiroPagamentoAlunoCobrancasResultToDTO({
      success: true,
      data: {
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
        error: { message: error instanceof Error ? error.message : 'Erro ao buscar dados' },
      },
      { status: 500 },
    );
  }
}
