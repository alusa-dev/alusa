import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { prisma } from '@/src/prisma';
import {
  centroCustoMutationResultDTOSchema,
  centroCustoRouteParamsDTOSchema,
  centroCustoStatusInputDTOSchema,
} from '@/features/financeiro/centros-custo/dtos';
import { mapCentroCustoToDTO } from '@/features/financeiro/centros-custo/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessUser = { id?: string; contaId?: string; role?: string };
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

const statusSchema = centroCustoStatusInputDTOSchema;

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

async function ensureAuth() {
  const session = await safeGetServerSession();
  const user = (session as { user?: SessUser } | null)?.user;
  if (!user?.id || !user?.contaId) return { error: err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado') };
  if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
    return { error: err(403, 'SEM_PERMISSAO', 'Acesso negado') };
  return { user };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const user = auth.user!;
    const { id } = centroCustoRouteParamsDTOSchema.parse(params);

    const parsed = statusSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }

    const centro = await prisma.centroCusto.findFirst({
      where: { id, contaId: user.contaId },
      include: { _count: { select: { lancamentos: true } } },
    });
    if (!centro) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');

    const updated = await prisma.centroCusto.update({
      where: { id },
      data: { status: parsed.data.status },
      include: { _count: { select: { lancamentos: true } } },
    });

    return NextResponse.json(
      centroCustoMutationResultDTOSchema.parse({
        data: mapCentroCustoToDTO(updated as unknown as Record<string, unknown>),
      }),
    );
  } catch (e) {
    console.error('[API centro de custo][PATCH status]', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
