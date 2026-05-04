import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { anonimizarResponsavel } from '@alusa/lib';
import {
  anonymizeResponsavelInputDTOSchema,
  anonymizeResponsavelResultDTOSchema,
} from '@/features/responsaveis/dtos';

type IdParams = Promise<{ id: string }> | { id: string };

export async function POST(req: Request, context: { params: IdParams }) {
  try {
    const { id } = await Promise.resolve(context.params);
    if (!id) {
      return NextResponse.json({ error: 'Identificador inválido' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const user = (session as { user?: { id?: string; contaId?: string; role?: string } })?.user;
    if (!user?.id || !user?.contaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    if (String(user.role || '').toUpperCase() !== 'ADMIN') {
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

    const responsavel = await anonimizarResponsavel({
      id,
      contaId: user.contaId,
      motivo: parsed.data.motivo,
      actorId: user.id,
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
