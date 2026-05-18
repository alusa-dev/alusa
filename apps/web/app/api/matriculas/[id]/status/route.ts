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
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { ManualSyncError, syncMatriculaStatus } from '@/src/server/matriculas/matricula-sync.service';
import { notifyMatriculaAction } from '@alusa/lib';
import { updateMatriculaStatusSyncInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaStatusSyncResultToDTO } from '@/features/cadastro/matriculas/mappers';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/matriculas/[id]/status
 *
 * Atualiza o status da matrícula e sincroniza com o serviço financeiro
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    const user = (session as { user?: { id?: string; contaId?: string } })?.user;

    if (!user?.id || !user?.contaId) {
      console.warn('[MATRICULA_STATUS] Usuário não autenticado');
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const matriculaId = params.id;
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
    const result = await syncMatriculaStatus({
      prisma,
      matriculaId,
      contaId: user.contaId,
      targetStatus: status,
      actorId: user.id,
      motivo: motivo || undefined,
    });

    const wasLocalOnly = result.asaasAction === 'LOCAL_ONLY';
    const message = wasLocalOnly
      ? `Status atualizado para ${result.newStatus} (apenas localmente - assinatura financeira não encontrada)`
      : `Status atualizado para ${result.newStatus}`;

    void notifyMatriculaAction({
      matriculaId,
      contaId: user.contaId,
      action: 'CANCELADA',
      motivo: motivo || undefined,
      actorUserId: user.id,
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
      console.error('[MATRICULA_STATUS] ManualSyncError:', {
        code: error.code,
        message: error.message,
        details: error.details,
        statusCode: error.statusCode,
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

    const err = error instanceof Error ? error : new Error(String(error));

    console.error('[MATRICULA_STATUS] Erro inesperado:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });

    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: err.message || 'Erro interno do servidor',
        details: {
          name: err.name,
          originalMessage: err.message,
        },
      },
      { status: 500 },
    );
  }
}
