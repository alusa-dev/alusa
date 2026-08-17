import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { reativarAlunoCompleto } from '@alusa/lib';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    // 1. Autenticação
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 2. Autorização (apenas ADMIN ou GESTOR)
    if (!['ADMIN', 'GESTOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'Apenas ADMIN ou GESTOR podem reativar alunos' },
        { status: 403 },
      );
    }

    // A rota reativa somente o cadastro do aluno. Matrículas e financeiro têm
    // fluxos próprios e não podem ser alterados por esta operação.
    if (!session.user.contaId) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 400 });
    }

    try {
      await assertPlatformAccessForConta({ contaId: session.user.contaId, capability: 'STUDENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return NextResponse.json(blocked.body, { status: blocked.status });
      throw error;
    }

    // 5. Reativar aluno
    const result = await reativarAlunoCompleto({
      id: rawParams.id,
      contaId: session.user.contaId,
      actorId: session.user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Erro ao reativar aluno:', error);

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
