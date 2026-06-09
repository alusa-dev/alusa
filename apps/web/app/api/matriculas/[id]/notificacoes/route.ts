import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  getCustomerNotificationChannels,
  syncCustomerNotificationsForUserSelection,
} from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import {
  updateMatriculaNotificationChannelsInputDTOSchema,
} from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaNotificationChannelsResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { resolveMatriculaFinancialContext } from '@/src/server/matriculas/financial-context.service';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

type SessionUser = {
  id?: string | null;
  contaId?: string | null;
};

async function resolveContaId(explicit?: string | null) {
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUser = (session as { user?: SessionUser } | null)?.user ?? null;
  const sessionContaId = sessionUser?.contaId || null;
  const sessionUserId = sessionUser?.id || null;
  const requested = explicit?.trim() || null;
  if (requested && sessionContaId && requested !== sessionContaId) {
    return { contaId: null, mismatch: true, sessionUserId };
  }
  return {
    contaId: requested || sessionContaId,
    mismatch: false,
    sessionUserId,
  };
}

async function resolveFinancialCustomer(matriculaId: string, contaId: string) {
  const context = await resolveMatriculaFinancialContext({
    db: prisma,
    matriculaId,
    contaId,
  });

  if (!context) return null;

  return {
    matriculaId: context.targetMatriculaId,
    subscriptionId: context.asaasSubscriptionId,
    customerId: context.customerId,
    payerName: context.payerName,
    mode: context.mode,
    familyGroupId: context.family?.id ?? null,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const contaCtx = await resolveContaId(null);
    if (!contaCtx.contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    const financialCustomer = await resolveFinancialCustomer(ctxParams.id, contaCtx.contaId);
    if (!financialCustomer) {
      return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');
    }

    if (!financialCustomer.customerId) {
      return jsonError(
        409,
        'CLIENTE_FINANCEIRO_NAO_ENCONTRADO',
        'Esta matrícula ainda não possui um responsável financeiro sincronizado para comunicações automáticas.',
      );
    }

    const snapshot = await getCustomerNotificationChannels(
      contaCtx.contaId,
      financialCustomer.customerId,
    );

    return NextResponse.json(
      mapMatriculaNotificationChannelsResultToDTO({
        customerId: financialCustomer.customerId,
        channels: {
          email: snapshot.email,
          sms: snapshot.sms,
          whatsapp: snapshot.whatsapp,
        },
        notificationCount: snapshot.notificationCount,
        syncedAt: new Date().toISOString(),
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[MATRICULA_NOTIFICACOES][GET]', error);
    return jsonError(500, 'ERRO_LISTAR_NOTIFICACOES', (error as Error).message);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const body = await req.json().catch(() => null);
    const parsed = updateMatriculaNotificationChannelsInputDTOSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        'PAYLOAD_INVALIDO',
        parsed.error.issues[0]?.message ?? 'Payload inválido',
        parsed.error.issues,
      );
    }

    const contaCtx = await resolveContaId(parsed.data.contaId ?? null);
    if (contaCtx.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!contaCtx.contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    const financialCustomer = await resolveFinancialCustomer(ctxParams.id, contaCtx.contaId);
    if (!financialCustomer) {
      return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');
    }

    if (!financialCustomer.customerId) {
      return jsonError(
        409,
        'CLIENTE_FINANCEIRO_NAO_ENCONTRADO',
        'Esta matrícula ainda não possui um responsável financeiro sincronizado para comunicações automáticas.',
      );
    }

    const current = await getCustomerNotificationChannels(
      contaCtx.contaId,
      financialCustomer.customerId,
    );

    const requested = parsed.data.channels;
    const unchanged =
      current.email === requested.email &&
      current.sms === requested.sms &&
      current.whatsapp === requested.whatsapp;

    if (unchanged) {
      return NextResponse.json(
        mapMatriculaNotificationChannelsResultToDTO({
          customerId: financialCustomer.customerId,
          channels: requested,
          notificationCount: current.notificationCount,
          syncedAt: new Date().toISOString(),
          message: 'Os canais de aviso já estão configurados dessa forma.',
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const result = await syncCustomerNotificationsForUserSelection(
      contaCtx.contaId,
      financialCustomer.customerId,
      requested,
    );

    const fullyApplied =
      result.applied.email === requested.email &&
      result.applied.sms === requested.sms &&
      result.applied.whatsapp === requested.whatsapp;

    if (!result.success && !fullyApplied) {
      return jsonError(
        502,
        'ERRO_ATUALIZAR_NOTIFICACOES',
        'Não foi possível aplicar os canais de aviso para o responsável financeiro.',
        { warnings: result.warnings },
      );
    }

    await prisma.matriculaLog.create({
      data: {
        matriculaId: financialCustomer.matriculaId,
        actorId: contaCtx.sessionUserId ?? 'system',
        action: 'MATRICULA_NOTIFICATION_CHANNELS_UPDATED',
        metadata: {
          customerId: financialCustomer.customerId,
          payerName: financialCustomer.payerName,
          mode: financialCustomer.mode,
          familyGroupId: financialCustomer.familyGroupId,
          previousChannels: {
            email: current.email,
            sms: current.sms,
            whatsapp: current.whatsapp,
          },
          requestedChannels: {
            email: requested.email,
            sms: requested.sms,
            whatsapp: requested.whatsapp,
          },
          appliedChannels: {
            email: result.applied.email,
            sms: result.applied.sms,
            whatsapp: result.applied.whatsapp,
          },
          warnings: result.warnings.map((warning) => ({
            notificationId: warning.notificationId,
            event: warning.event,
            channel: warning.channel,
            code: warning.code,
            message: warning.message,
          })),
        },
      },
    });

    return NextResponse.json(
      mapMatriculaNotificationChannelsResultToDTO({
        customerId: financialCustomer.customerId,
        channels: {
          email: result.applied.email,
          sms: result.applied.sms,
          whatsapp: result.applied.whatsapp,
        },
        notificationCount: current.notificationCount,
        syncedAt: new Date().toISOString(),
        message: fullyApplied
          ? 'Canais de aviso atualizados com sucesso.'
          : 'Os canais foram ajustados com compatibilidade automática para manter a comunicação da Alusa ativa.',
        warnings: result.warnings,
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[MATRICULA_NOTIFICACOES][PUT]', error);
    return jsonError(500, 'ERRO_ATUALIZAR_NOTIFICACOES', (error as Error).message);
  }
}
