import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

export async function POST(_req: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  try {
    // 1. Autenticação
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 2. Autorização (apenas ADMIN ou GESTOR)
    if (!['ADMIN', 'GESTOR'].includes(String(auth.role ?? '').toUpperCase())) {
      return NextResponse.json(
        { error: 'Apenas ADMIN ou GESTOR podem inativar alunos' },
        { status: 403 },
      );
    }

    // O endpoint antigo permitia escolher pausa/cancelamento de matrícula a
    // partir do cadastro do aluno. Essa decisão pertence exclusivamente ao
    // fluxo de Matrículas e não pode mais ser executada aqui.
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
      return NextResponse.json({ error: 'Não foi possível inativar o aluno.' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
