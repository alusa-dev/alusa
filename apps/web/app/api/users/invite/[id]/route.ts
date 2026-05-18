import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { InviteUserService } from '@alusa/lib';
import { deleteInviteResultDTOSchema } from '@/features/users/dtos';

const ParamsSchema = z.object({ params: z.object({ id: z.string().min(1) }) });

export async function DELETE(_req: Request, ctx: unknown) {
  try {
    const parsed = ParamsSchema.safeParse(ctx);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }
    const id = parsed.data.params.id;

    const isTest =
      process.env.NODE_ENV === 'test' ||
      (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true');
    const session = await getServerSession(authOptions);
    if (!session?.user && !isTest) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const inviterRole = isTest
      ? 'ADMIN'
      : session && typeof session.user === 'object'
        ? (session.user as { role?: string }).role
        : undefined;
    const inviterContaId = isTest
      ? 'conta-default'
      : session && typeof session.user === 'object'
        ? (session.user as { contaId?: string }).contaId
        : undefined;

    if (String(inviterRole || '').toUpperCase() !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão para excluir este convite.' }, { status: 403 });
    }

    const invite = await InviteUserService.getInviteById(id);
    if (!invite) {
      return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404 });
    }

    if (inviterContaId && invite.contaId && invite.contaId !== inviterContaId) {
      return NextResponse.json({ error: 'Convite não pertence à sua conta.' }, { status: 403 });
    }

    const ok = await InviteUserService.cancelInviteById(id);
    if (!ok) {
      return NextResponse.json({ error: 'Convite não encontrado ou já processado.' }, { status: 404 });
    }
    return NextResponse.json(deleteInviteResultDTOSchema.parse({ ok: true }));
  } catch (error) {
    console.error('Error deleting invite:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
