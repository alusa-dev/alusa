import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  centroCustoMutationResultDTOSchema,
  centroCustoRouteParamsDTOSchema,
  centroCustoStatusInputDTOSchema,
} from '@/features/financeiro/centros-custo/dtos';
import { mapCentroCustoToDTO } from '@/features/financeiro/centros-custo/mappers';
import { getCentroCusto, updateCentroCustoStatus } from '@/src/server/finance/centro-custo.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

const statusSchema = centroCustoStatusInputDTOSchema;

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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await ensureAuth();
    if ('error' in auth) return auth.error;
    const user = auth.user!;
    const { id } = centroCustoRouteParamsDTOSchema.parse(await params);

    const parsed = statusSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(400, 'DADOS_INVALIDOS', issue.message);
    }

    const centro = await getCentroCusto(user.contaId, id);
    if (!centro) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');

    const updateResult = await updateCentroCustoStatus(user.contaId, id, parsed.data);
    if (updateResult.count === 0) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');

    const updated = await getCentroCusto(user.contaId, id);
    if (!updated) return err(404, 'NAO_ENCONTRADO', 'Centro de custo nao encontrado');

    return NextResponse.json(
      centroCustoMutationResultDTOSchema.parse({
        data: mapCentroCustoToDTO(updated as unknown as Record<string, unknown>),
      }),
    );
  } catch (e) {
    console.error('[API centro de custo][PATCH status]', e);
    return err(500, 'ERRO_INTERNO', 'Não foi possível atualizar o status do centro de custo');
  }
}
