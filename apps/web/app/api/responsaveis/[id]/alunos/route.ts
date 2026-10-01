import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { resolveResponsavelRouteId } from '@/src/server/responsibles/resolve-responsible-route-id.service';
import { listStudentsLinkedToResponsibleForTenant } from '@/src/server/responsibles/linked-students.service';

export const dynamic = 'force-dynamic';

type IdParams = Promise<{ id: string }> | { id: string };

export async function GET(_req: NextRequest, context: { params: IdParams }) {
  try {
    const { id } = await Promise.resolve(context.params);
    if (!id) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
    }

    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
    const contaId = auth.contaId;

    const responsavelId = await resolveResponsavelRouteId(id, contaId);
    if (!responsavelId) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const vinculos = await listStudentsLinkedToResponsibleForTenant({ contaId, responsavelId });

    const items = vinculos.map(({ aluno }) => ({
      id: aluno.id,
      nome: aluno.nome,
      dataNasc: aluno.dataNasc ? aluno.dataNasc.toISOString() : null,
      cpf: aluno.cpf ?? null,
      foto: aluno.foto ?? null,
      ativo: aluno.status === 'ATIVO',
    }));

    return NextResponse.json({ items });
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.academic.request.failed',
      route: '/api/responsaveis/[id]/alunos',
      method: 'GET',
      requestId: getRequestId(_req),
      error,
    });
    return NextResponse.json({ error: 'Erro ao buscar alunos do responsável' }, { status: 500 });
  }
}
