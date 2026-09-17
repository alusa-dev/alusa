import { NextResponse } from 'next/server';
import { comboUpdateSchema } from '@alusa/lib/combos/combo.schema';
import { updateCombo, deleteCombo } from '@alusa/lib/combos/combo.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
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
    const parsed = comboUpdateSchema.safeParse({
      ...body,
      id: rawParams.id,
      contaId: tenant.contaId,
    });
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }
    try {
      const combo = await updateCombo(parsed.data);
      return NextResponse.json({ data: combo });
    } catch (err) {
      return jsonError(400, 'ERRO_ATUALIZAR_COMBO', (err as Error).message);
    }
  } catch (e) {
    return jsonError(500, 'ERRO_ATUALIZAR_COMBO', 'Não foi possível atualizar o combo.');
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const body = await req.json().catch(() => null);
    const tenant = await resolveTenantSession((body as { contaId?: string } | null)?.contaId ?? null);
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
    try {
      const combo = await deleteCombo(rawParams.id, tenant.contaId);
      return NextResponse.json({ data: combo });
    } catch (err) {
      return jsonError(400, 'ERRO_EXCLUIR_COMBO', (err as Error).message);
    }
  } catch (e) {
    return jsonError(500, 'ERRO_EXCLUIR_COMBO', 'Não foi possível excluir o combo.');
  }
}
