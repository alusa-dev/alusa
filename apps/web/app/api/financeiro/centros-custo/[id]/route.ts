import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
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
import {
  deleteCentroCusto,
  findDuplicateCentroCusto,
  getCentroCusto,
  updateCentroCusto,
} from '@/src/server/finance/centro-custo.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

const updateSchema = centroCustoCreateSchema.extend({
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

async function ensureAuth() {
  const auth = await resolveTenantSession();
  if (!auth.ok) return { error: err(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO', auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Usuario nao autenticado') };
  if (!auth.role || !allowedRoles.has(auth.role.toUpperCase()))
    return { error: err(403, 'SEM_PERMISSAO', 'Acesso negado') };
  return { user: { id: auth.userId, contaId: auth.contaId, role: auth.role } };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const user = auth.user!;
    const { id } = centroCustoRouteParamsDTOSchema.parse(await params);

    const centro = await getCentroCusto(user.contaId, id);
    if (!centro) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');
    return NextResponse.json({
      data: mapCentroCustoToDTO(centro as unknown as Record<string, unknown>),
    });
  } catch (e) {
    console.error('[API centro de custo][GET id]', e);
    return err(500, 'ERRO_INTERNO', 'Não foi possível carregar o centro de custo');
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const user = auth.user!;
    const { id } = centroCustoRouteParamsDTOSchema.parse(await params);

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }
    const body = parsed.data;

    const current = await getCentroCusto(user.contaId, id);
    if (!current) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');

    const normalizedInput = { ...body, nome: body.nome.trim(), descricao: body.descricao?.trim() || null };
    const exists = await findDuplicateCentroCusto(user.contaId, normalizedInput, id);
    if (exists) return err(409, 'JA_EXISTE', 'Já existe um centro com este nome e tipo');

    // Multi-tenant: usar updateMany para garantir atomicidade com contaId
    const updateResult = await updateCentroCusto(user.contaId, id, normalizedInput, current.status);
    if (updateResult.count === 0) {
      return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');
    }
    const updated = await getCentroCusto(user.contaId, id);
    if (!updated) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');

    return NextResponse.json(
      centroCustoMutationResultDTOSchema.parse({
        data: mapCentroCustoToDTO(updated as unknown as Record<string, unknown>),
      }),
    );
  } catch (e) {
    console.error('[API centro de custo][PUT]', e);
    return err(500, 'ERRO_INTERNO', 'Não foi possível atualizar o centro de custo');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const user = auth.user!;
    const { id } = centroCustoRouteParamsDTOSchema.parse(await params);

    const centro = await getCentroCusto(user.contaId, id);
    if (!centro) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');
    if (centro._count.lancamentos > 0) {
      return err(400, 'NAO_PERMITIDO', 'Centro de custo possui lançamentos; inative ao invés de excluir');
    }

    // Multi-tenant: usar deleteMany para garantir atomicidade com contaId
    const deleteResult = await deleteCentroCusto(user.contaId, id);
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
    return err(500, 'ERRO_INTERNO', 'Não foi possível excluir o centro de custo');
  }
}
