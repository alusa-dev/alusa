import { NextResponse } from 'next/server';
import {
  planoCreateSchema,
  planoUpdateSchema,
  planoFilterSchema,
} from '@alusa/lib/planos/planos-schema';
import {
  listPlanos,
  createPlano,
  updatePlano,
  deletePlano,
} from '@alusa/lib/planos/planos-service';
import { resolveTenantSession, type TenantSessionResolution } from '@/lib/api/with-tenant-session';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';
import { apiJsonError } from '@/lib/api/standard-response';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return apiJsonError(status, code, message, details);
}

function tenantErrorResponse(tenant: Extract<TenantSessionResolution, { ok: false }>) {
  return jsonError(
    tenant.reason === 'CONTA_MISMATCH' ? 403 : 401,
    tenant.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
    tenant.reason === 'CONTA_MISMATCH'
      ? 'A conta informada não pertence ao usuário autenticado.'
      : 'É necessário estar autenticado.',
  );
}

function planoOperationMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (error.message === 'Já existe um plano com este nome nesta conta.') {
    return 'Já existe um plano com este nome nesta conta.';
  }
  if (error.message === 'Plano não encontrado.') return 'Plano não encontrado.';
  return fallback;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenant = await resolveTenantSession(url.searchParams.get('contaId'));
    if (!tenant.ok) return tenantErrorResponse(tenant);
    const contaId = tenant.contaId;

    const statusParam = url.searchParams.get('status');
    const searchParam = url.searchParams.get('q') ?? undefined;

    const filtersParse = planoFilterSchema.safeParse({
      contaId,
      status: statusParam === 'ATIVO' || statusParam === 'INATIVO' ? statusParam : undefined,
      search: searchParam,
    });

    if (!filtersParse.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Filtros inválidos', filtersParse.error.flatten());
    }

    const planos = await listPlanos(filtersParse.data);
    return NextResponse.json({ data: planos });
  } catch (error) {
    console.error('[planos][GET] erro ao listar planos', error);
    return jsonError(500, 'ERRO_LISTAR_PLANOS', 'Não foi possível carregar os planos.');
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonError(400, 'REQUISICAO_INVALIDA', 'Payload inválido');
    }

    const tenant = await resolveTenantSession((body as { contaId?: string }).contaId ?? null);
    if (!tenant.ok) return tenantErrorResponse(tenant);
    const contaId = tenant.contaId;

    try {
      await assertPlatformAccessForConta({ contaId, capability: 'ADMIN_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
      throw error;
    }

    const parsed = planoCreateSchema.safeParse({ ...body, contaId });
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }

    try {
      const plano = await createPlano(parsed.data);
      return NextResponse.json({ data: plano }, { status: 201 });
    } catch (error) {
      return jsonError(400, 'ERRO_CRIAR_PLANO', planoOperationMessage(error, 'Não foi possível criar o plano.'));
    }
  } catch (error) {
    console.error('[planos][POST] erro inesperado', error);
    return jsonError(500, 'ERRO_CRIAR_PLANO', 'Não foi possível criar o plano.');
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonError(400, 'REQUISICAO_INVALIDA', 'Payload inválido');
    }

    const id = (body as { id?: string }).id?.trim();
    if (!id) {
      return jsonError(400, 'ID_OBRIGATORIO', 'id é obrigatório');
    }

    const tenant = await resolveTenantSession((body as { contaId?: string }).contaId ?? null);
    if (!tenant.ok) return tenantErrorResponse(tenant);
    const contaId = tenant.contaId;

    try {
      await assertPlatformAccessForConta({ contaId, capability: 'ADMIN_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
      throw error;
    }

    const parsed = planoUpdateSchema.safeParse({ ...body, id, contaId });
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }

    try {
      const plano = await updatePlano(parsed.data);
      return NextResponse.json({ data: plano });
    } catch (error) {
      return jsonError(400, 'ERRO_ATUALIZAR_PLANO', planoOperationMessage(error, 'Não foi possível atualizar o plano.'));
    }
  } catch (error) {
    console.error('[planos][PATCH] erro inesperado', error);
    return jsonError(500, 'ERRO_ATUALIZAR_PLANO', 'Não foi possível atualizar o plano.');
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return jsonError(400, 'REQUISICAO_INVALIDA', 'Payload inválido');
    }

    const id = (body as { id?: string }).id?.trim();
    if (!id) {
      return jsonError(400, 'ID_OBRIGATORIO', 'id é obrigatório');
    }

    const tenant = await resolveTenantSession((body as { contaId?: string }).contaId ?? null);
    if (!tenant.ok) return tenantErrorResponse(tenant);
    const contaId = tenant.contaId;

    try {
      await assertPlatformAccessForConta({ contaId, capability: 'ADMIN_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
      throw error;
    }

    try {
      const plano = await deletePlano(id, contaId);
      return NextResponse.json({ data: plano });
    } catch (error) {
      return jsonError(400, 'ERRO_EXCLUIR_PLANO', planoOperationMessage(error, 'Não foi possível excluir o plano.'));
    }
  } catch (error) {
    console.error('[planos][DELETE] erro inesperado', error);
    return jsonError(500, 'ERRO_EXCLUIR_PLANO', 'Não foi possível excluir o plano.');
  }
}
