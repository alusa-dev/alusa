import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { deleteInviteResultDTOSchema } from '@/features/users/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

const ParamsSchema = z.object({ id: z.string().min(1) });
type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const parsed = ParamsSchema.safeParse(await ctx.params);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }
    const id = parsed.data.id;

    const isTest =
      process.env.NODE_ENV === 'test' ||
      (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true');
    const auth = await resolveTenantSession();
    if (!auth.ok && !isTest) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const inviterRole = isTest
      ? 'ADMIN'
      : auth.ok
        ? auth.role
        : undefined;
    const inviterContaId = isTest
      ? 'conta-default'
      : auth.ok
        ? auth.contaId
        : undefined;

    if (String(inviterRole || '').toUpperCase() !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão para excluir este convite.' }, { status: 403 });
    }

    if (!inviterContaId) return NextResponse.json({ error: 'Conta inválida.' }, { status: 403 });
    const ok = await InviteUserService.deleteInviteById(id, inviterContaId);
    if (!ok) {
      return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404 });
    }
    return NextResponse.json(deleteInviteResultDTOSchema.parse({ ok: true }));
  } catch (error) {
    console.error('Error deleting invite:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
