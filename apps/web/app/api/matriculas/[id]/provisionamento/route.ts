import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { matriculaRouteParamsDTOSchema } from '@/features/enrollments/dtos';
import { matriculaProvisionamentoActionDTOSchema } from '@/features/enrollments/dtos';
import {
  loadMatriculaProvisioningView,
  reconcileMatriculaProvisioning,
  retryMatriculaProvisioning,
} from '@/src/server/enrollments/provisioning-http.service';

export const dynamic = 'force-dynamic';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

async function requireUser() {
  const auth = await resolveTenantSession();
  if (!auth.ok) return { error: jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.') };
  if (!auth.role || !allowedRoles.has(String(auth.role).toUpperCase())) {
    return { error: jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para acompanhar o financeiro.') };
  }
  return { user: { id: auth.userId, contaId: auth.contaId, role: auth.role } };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ('error' in auth) return auth.error;

  const { id } = matriculaRouteParamsDTOSchema.parse(await params);
  const view = await loadMatriculaProvisioningView(id, auth.user.contaId);
  if (!view) return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada.');

  return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ('error' in auth) return auth.error;

  const rawBody = await request.json().catch(() => ({}));
  const parsedBody = matriculaProvisionamentoActionDTOSchema.safeParse(
    rawBody && typeof rawBody === 'object' ? rawBody : {},
  );
  if (!parsedBody.success) return jsonError(400, 'ACAO_INVALIDA', 'Ação operacional inválida.');
  const { action } = parsedBody.data;

  const { id } = matriculaRouteParamsDTOSchema.parse(await params);
  const view = await loadMatriculaProvisioningView(id, auth.user.contaId);
  if (!view) return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada.');

  if (action === 'RECONCILE_LOCAL_CHARGES') {
    const result = await reconcileMatriculaProvisioning({ matriculaId: id, contaId: auth.user.contaId, actorUserId: auth.user.id });
    if (!result.ok) {
      const message = result.code === 'COBRANCA_PAGA_REQUER_DECISAO_MANUAL'
        ? 'Há pagamento confirmado para esta matrícula. O recebimento foi preservado; a intenção terminal permanece bloqueada até decisão operacional.'
        : result.code === 'INTENCAO_TERMINAL_ESTADO_REMOTO_INCOMPLETO'
          ? 'O Asaas não confirmou o estado de todas as cobranças. A matrícula continua em reconciliação.'
          : result.code === 'INTENCAO_TERMINAL_SEM_COBRANCAS_REQUER_REVISAO'
            ? 'Não há cobranças locais suficientes para confirmar a operação remota. A matrícula continua em reconciliação.'
            : 'Não há cobrança local com identificador financeiro para reconciliar automaticamente. Revise antes de reenviar.';
      return jsonError(
        409,
        result.code ?? 'RECONCILIACAO_MANUAL_NECESSARIA',
        message,
        'reason' in result ? { reason: result.reason } : undefined,
      );
    }

    const nextView = await loadMatriculaProvisioningView(id, auth.user.contaId);
    return NextResponse.json(
      {
        ...nextView,
        reconciliation: { checked: result.checked, updated: result.updated },
        terminalIntent: 'terminalIntent' in result ? result.terminalIntent : undefined,
      },
      { status: 'terminalIntent' in result ? 200 : 202, headers: { 'cache-control': 'no-store' } },
    );
  }

  if (view.requiresReconciliation) {
    return jsonError(
      409,
      'RECONCILIACAO_OBRIGATORIA',
      'Há resultado financeiro incerto. Reconcilie antes de reenviar para evitar duplicidade.',
    );
  }

  const retried = await retryMatriculaProvisioning({ matriculaId: id, contaId: auth.user.contaId, actorUserId: auth.user.id });
  if (retried === 'TERMINAL') {
    return jsonError(409, 'MATRICULA_TERMINAL', 'Matrículas recusadas ou canceladas não podem reenviar o provisionamento financeiro.');
  }
  if (retried === 'RECONCILIATION_REQUIRED') {
    return jsonError(409, 'RECONCILIACAO_OBRIGATORIA', 'Há resultado financeiro incerto. Reconcilie antes de reenviar para evitar duplicidade.');
  }
  if (retried === 'NOT_RETRYABLE') {
    return jsonError(409, 'PROVISIONAMENTO_NAO_REENVIAVEL', 'O provisionamento atual não está disponível para reenvio.');
  }

  const nextView = await loadMatriculaProvisioningView(id, auth.user.contaId);
  return NextResponse.json(nextView, { status: 202, headers: { 'cache-control': 'no-store' } });
}
