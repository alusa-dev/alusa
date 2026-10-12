import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
/**
 * API Route: /api/matriculas/[id]/status
 *
 * Gerencia cancelamento de matrícula com sincronização financeira.
 * Pausa e reativação devem usar POST /pausar e POST /reativar.
 *
 * - ATIVA/PAUSADA → CANCELADA: remove assinatura financeira (DELETE /subscriptions/{id})
 *
 * @module api/matriculas/[id]/status
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { ManualSyncError } from '@/src/server/enrollments/enrollment-sync.service';
import {
  resolveDeferredCancellationFromHttp,
  resolvePendingCancellationFromHttp,
  syncMatriculaStatusFromHttp,
} from '@/src/server/enrollments/enrollment-http-commands.service';
import { notifyMatriculaAction } from '@alusa/lib/notifications/matricula-notifications';
import { updateMatriculaStatusSyncInputDTOSchema } from '@/features/enrollments/dtos';
import { mapMatriculaStatusSyncResultToDTO } from '@/features/enrollments/mappers';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

export const dynamic = 'force-dynamic';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

/**
 * PATCH /api/matriculas/[id]/status
 *
 * Atualiza o status da matrícula e sincroniza com o serviço financeiro
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let tenantContaId: string | null = null;
  let requestedMatriculaId: string | null = null;
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    tenantContaId = auth.contaId;
    if (!auth.role || !allowedRoles.has(String(auth.role).toUpperCase())) {
      return NextResponse.json(
        {
          error: 'PERMISSAO_NEGADA',
          message: 'Usuário não tem permissão para cancelar matrículas.',
        },
        { status: 403 },
      );
    }

    try {
      await assertPlatformAccessForConta({ contaId: auth.contaId, capability: 'ENROLLMENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return NextResponse.json(blocked.body, { status: blocked.status });
      throw error;
    }

    const rawParams = await params;
    const matriculaId = rawParams.id;
    requestedMatriculaId = matriculaId;
    const parsedBody = updateMatriculaStatusSyncInputDTOSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Status inválido' }, { status: 400 });
    }
    const { status, motivo } = parsedBody.data;

    if (status !== 'CANCELADA') {
      return NextResponse.json(
        {
          error: 'STATUS_ENDPOINT_RESTRITO',
          message: 'Pausa e reativação devem usar os endpoints específicos da matrícula.',
        },
        { status: 409 },
      );
    }

    // Encapsulamos toda a sincronização em um serviço compartilhado para manter a paridade com o estado financeiro oficial.
    const result = await syncMatriculaStatusFromHttp({
      matriculaId,
      contaId: auth.contaId,
      targetStatus: status,
      actorId: auth.userId,
      motivo: motivo || undefined,
    });

    if (result.deferred) {
      const pendingCancellation = await resolveDeferredCancellationFromHttp({
        contaId: auth.contaId,
        matriculaId,
      });
      return NextResponse.json(
        {
          success: true,
          pending: true,
          retryable: true,
          code: result.deferredReason?.startsWith('RECONCILIATION_REQUIRED:')
            ? 'CANCELAMENTO_PENDENTE_RECONCILIACAO'
            : 'CANCELAMENTO_AGUARDANDO_PROVISIONAMENTO',
          message: result.deferredReason?.startsWith('RECONCILIATION_REQUIRED:')
            ? 'A intenção de cancelamento foi registrada. O resultado financeiro ainda precisa ser reconciliado antes da conclusão acadêmica.'
            : 'O cancelamento foi registrado e será concluído após a operação financeira em andamento.',
          matriculaId,
          status: result.previousStatus,
          operationId: pendingCancellation.operationId,
          correlationId: pendingCancellation.correlationId,
        },
        { status: 202, headers: { 'cache-control': 'no-store' } },
      );
    }

    const wasLocalOnly = result.asaasAction === 'LOCAL_ONLY';
    const message = wasLocalOnly
      ? `Status atualizado para ${result.newStatus} (apenas localmente - assinatura financeira não encontrada)`
      : `Status atualizado para ${result.newStatus}`;

    void notifyMatriculaAction({
      matriculaId,
      contaId: auth.contaId,
      action: 'CANCELADA',
      motivo: motivo || 'Cancelamento manual da matrícula',
      actorUserId: auth.userId,
    });

    const payload = mapMatriculaStatusSyncResultToDTO(
      result as unknown as Record<string, unknown>,
      message,
    );

    return NextResponse.json({
      ...payload,
      warning: wasLocalOnly
        ? 'A assinatura financeira não foi encontrada. O status foi atualizado apenas localmente.'
        : undefined,
    });
  } catch (error) {
    if (error instanceof ManualSyncError) {
      if (tenantContaId && requestedMatriculaId) {
        const pendingCancellation = await resolvePendingCancellationFromHttp({
          contaId: tenantContaId,
          matriculaId: requestedMatriculaId,
        });
        if (pendingCancellation) {
          return NextResponse.json({
            success: true,
            pending: true,
            retryable: true,
            message: 'O cancelamento aguarda confirmação financeira e será reconciliado automaticamente. A matrícula permanece no estado atual.',
            matriculaId: requestedMatriculaId,
            status: pendingCancellation.status,
            operationId: pendingCancellation.operationId,
            correlationId: pendingCancellation.correlationId,
          }, { status: 202, headers: { 'cache-control': 'no-store' } });
        }
      }
      logApiOperationalEvent({
        severity: 'error',
        eventName: 'api.academic.request.failed',
        route: '/api/matriculas/[id]/status',
        method: 'PATCH',
        requestId: getRequestId(request),
        error,
      });

      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          details: error.details ?? null,
        },
        { status: error.statusCode },
      );
    }

    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.academic.request.failed',
      route: '/api/matriculas/[id]/status',
      method: 'PATCH',
      requestId: getRequestId(request),
      error,
    });

    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message:
          'Não foi possível atualizar o status da matrícula. Tente novamente ou solicite uma reconciliação.',
      },
      { status: 500 },
    );
  }
}
