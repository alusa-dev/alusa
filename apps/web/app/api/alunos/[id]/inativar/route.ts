import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 1. Autenticação
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 2. Autorização (apenas ADMIN ou GESTOR)
    if (!['ADMIN', 'GESTOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'Apenas ADMIN ou GESTOR podem inativar alunos' },
        { status: 403 },
      );
    }

    // O endpoint antigo permitia escolher pausa/cancelamento de matrícula a
    // partir do cadastro do aluno. Essa decisão pertence exclusivamente ao
    // fluxo de Matrículas e não pode mais ser executada aqui.
    if (!session.user.contaId) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: 'FLUXO_DEPRECADO',
        code: 'ALUNO_STATUS_USE_DELETE',
        message: 'Use a operação de arquivamento do aluno. Matrículas são gerenciadas no fluxo de Matrículas.',
      },
      { status: 410 },
    );
  } catch (error) {
    console.error('[API] Erro ao inativar aluno:', error);

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
