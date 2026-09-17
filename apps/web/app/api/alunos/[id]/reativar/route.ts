import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { reativarAlunoCompleto } from '@alusa/lib/alunos/aluno.service';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    // 1. Autenticação
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 2. Autorização (apenas ADMIN ou GESTOR)
    if (!['ADMIN', 'GESTOR'].includes(String(auth.role ?? '').toUpperCase())) {
      return NextResponse.json(
        { error: 'Apenas ADMIN ou GESTOR podem reativar alunos' },
        { status: 403 },
      );
    }

    // A rota reativa somente o cadastro do aluno. Matrículas e financeiro têm
    // fluxos próprios e não podem ser alterados por esta operação.
    try {
      await assertPlatformAccessForConta({ contaId: auth.contaId, capability: 'STUDENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return NextResponse.json(blocked.body, { status: blocked.status });
      throw error;
    }

    // 5. Reativar aluno
    const result = await reativarAlunoCompleto({
      id: rawParams.id,
      contaId: auth.contaId,
      actorId: auth.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Erro ao reativar aluno:', error);

    if (error instanceof Error) {
      return NextResponse.json({ error: 'Não foi possível reativar o aluno.' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
