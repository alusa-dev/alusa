import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { anonimizarResponsavel } from '@alusa/lib/alunos/aluno.service';
import {
  anonymizeResponsavelInputDTOSchema,
  anonymizeResponsavelResultDTOSchema,
} from '@/features/responsaveis/dtos';
import { resolveResponsavelRouteId } from '@/src/server/responsaveis/resolve-responsavel-route-id.service';

type IdParams = Promise<{ id: string }> | { id: string };

export async function POST(req: Request, context: { params: IdParams }) {
  try {
    const { id } = await Promise.resolve(context.params);
    if (!id) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
    }

    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    if (String(auth.role || '').toUpperCase() !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });
    }

    const parsed = anonymizeResponsavelInputDTOSchema.safeParse(
      await req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Payload inválido', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const responsavelId = await resolveResponsavelRouteId(id, auth.contaId);
    if (!responsavelId) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const responsavel = await anonimizarResponsavel({
      id: responsavelId,
      contaId: auth.contaId,
      motivo: parsed.data.motivo,
      actorId: auth.userId,
    });

    return NextResponse.json(
      anonymizeResponsavelResultDTOSchema.parse({ success: true, responsavel }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'Erro ao anonimizar responsável' },
      { status: 400 },
    );
  }
}
