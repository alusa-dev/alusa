import { NextResponse } from 'next/server';
import {
  comboCreateSchema,
  comboFilterSchema,
} from '@alusa/lib/combos/combo.schema';
import { listCombos, createCombo } from '@alusa/lib/combos/combo.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenant = await resolveTenantSession(url.searchParams.get('contaId'));
    if (!tenant.ok) {
      return jsonError(
        tenant.reason === 'UNAUTHENTICATED' ? 401 : 403,
        tenant.reason === 'UNAUTHENTICATED' ? 'NAO_AUTENTICADO' : 'CONTA_INVALIDA',
        tenant.reason === 'UNAUTHENTICATED' ? 'Usuário não autenticado.' : 'Conta não pertence ao usuário.',
      );
    }

    const statusParam = url.searchParams.get('status');
    const searchParam = url.searchParams.get('q') ?? undefined;
    const parsed = comboFilterSchema.safeParse({
      contaId: tenant.contaId,
      status: statusParam === 'ATIVO' || statusParam === 'INATIVO' ? statusParam : undefined,
      search: searchParam,
    });
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Filtros inválidos', parsed.error.flatten());
    }
    const combos = await listCombos(parsed.data);
    return NextResponse.json({ data: combos });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_COMBOS', 'Não foi possível carregar os combos.');
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return jsonError(400, 'REQUISICAO_INVALIDA', 'Payload inválido');
    const tenant = await resolveTenantSession((body as { contaId?: string }).contaId ?? null);
    if (!tenant.ok) {
      return jsonError(
        tenant.reason === 'UNAUTHENTICATED' ? 401 : 403,
        tenant.reason === 'UNAUTHENTICATED' ? 'NAO_AUTENTICADO' : 'CONTA_INVALIDA',
        tenant.reason === 'UNAUTHENTICATED' ? 'Usuário não autenticado.' : 'Conta inválida',
      );
    }
    try {
      await assertPlatformAccessForConta({ contaId: tenant.contaId, capability: 'ADMIN_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
      throw error;
    }
    const parsed = comboCreateSchema.safeParse({ ...body, contaId: tenant.contaId });
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }
    try {
      const combo = await createCombo(parsed.data);
      return NextResponse.json({ data: combo }, { status: 201 });
    } catch (err) {
      return jsonError(400, 'ERRO_CRIAR_COMBO', (err as Error).message);
    }
  } catch (e) {
    return jsonError(500, 'ERRO_CRIAR_COMBO', 'Não foi possível criar o combo.');
  }
}
