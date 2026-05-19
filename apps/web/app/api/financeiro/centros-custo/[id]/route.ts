import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { prisma } from '@/src/prisma';
import { centroCustoCreateSchema } from '../route';
import {
  centroCustoDeleteResultDTOSchema,
  centroCustoMutationResultDTOSchema,
  centroCustoRouteParamsDTOSchema,
} from '@/features/financeiro/centros-custo/dtos';
import {
  mapCentroCustoDeleteResultToDTO,
  mapCentroCustoToDTO,
} from '@/features/financeiro/centros-custo/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessUser = { id?: string; contaId?: string; role?: string };
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

const updateSchema = centroCustoCreateSchema.extend({
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const user = auth.user!;
    const { id } = centroCustoRouteParamsDTOSchema.parse(params);

    const centro = await prisma.centroCusto.findFirst({
      where: { id, contaId: user.contaId },
      include: { _count: { select: { lancamentos: true } } },
    });
    if (!centro) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');
    return NextResponse.json({
      data: mapCentroCustoToDTO(centro as unknown as Record<string, unknown>),
    });
  } catch (e) {
    console.error('[API centro de custo][GET id]', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const user = auth.user!;
    const { id } = centroCustoRouteParamsDTOSchema.parse(params);

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const body = parsed.data;

    const current = await prisma.centroCusto.findFirst({
      where: { id, contaId: user.contaId },
      include: { _count: { select: { lancamentos: true } } },
    });
    if (!current) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');

    const exists = await prisma.centroCusto.findFirst({
      where: {
        contaId: user.contaId,
        nome: body.nome.trim(),
        tipo: body.tipo,
        NOT: { id },
      },
    });
    if (exists) return err(409, 'JA_EXISTE', 'Já existe um centro com este nome e tipo');

    // Multi-tenant: usar updateMany para garantir atomicidade com contaId
    const updateResult = await prisma.centroCusto.updateMany({
      where: { id, contaId: user.contaId },
      data: {
        nome: body.nome.trim(),
        tipo: body.tipo,
        descricao: body.descricao?.trim() || null,
        status: body.status ?? current.status,
      },
    });
    if (updateResult.count === 0) {
      return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');
    }
    const updated = await prisma.centroCusto.findFirst({
      where: { id, contaId: user.contaId },
      include: { _count: { select: { lancamentos: true } } },
    });
    if (!updated) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');

    return NextResponse.json(
      centroCustoMutationResultDTOSchema.parse({
        data: mapCentroCustoToDTO(updated as unknown as Record<string, unknown>),
      }),
    );
  } catch (e) {
    console.error('[API centro de custo][PUT]', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const user = auth.user!;
    const { id } = centroCustoRouteParamsDTOSchema.parse(params);

    const centro = await prisma.centroCusto.findFirst({
      where: { id, contaId: user.contaId },
      include: { _count: { select: { lancamentos: true } } },
    });
    if (!centro) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');
    if (centro._count.lancamentos > 0) {
      return err(400, 'NAO_PERMITIDO', 'Centro de custo possui lançamentos; inative ao invés de excluir');
    }

    // Multi-tenant: usar deleteMany para garantir atomicidade com contaId
    const deleteResult = await prisma.centroCusto.deleteMany({ 
      where: { id, contaId: user.contaId } 
    });
    if (deleteResult.count === 0) {
      return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');
    }
    return NextResponse.json(
      centroCustoDeleteResultDTOSchema.parse(
        mapCentroCustoDeleteResultToDTO({ success: true }),
      ),
    );
  } catch (e) {
    console.error('[API centro de custo][DELETE]', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
