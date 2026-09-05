import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  getCustomerNotificationChannels,
  syncCustomerNotificationsForUserSelection,
} from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import { runWithTenant } from '@/lib/prisma-tenant';
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

// Recepção pode configurar os avisos que já seleciona no cadastro da matrícula.
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

async function authorizeNotifications() {
  const session = await getServerSession(authOptions);
  const contaId = session?.user?.contaId?.trim();
  const actorId = session?.user?.id?.trim();
  if (!contaId || !actorId) {
    return { response: jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.') };
  }
  if (!allowedRoles.has(String(session?.user?.role ?? '').toUpperCase())) {
    return { response: jsonError(403, 'SEM_PERMISSAO', 'Usuário sem permissão para configurar notificações.') };
  }
  return { contaId, actorId };
}

async function resolveFinancialCustomer(matriculaId: string, contaId: string) {
  const context = await runWithTenant(contaId, (tx) => resolveMatriculaFinancialContext({
    db: tx,
    matriculaId,
    contaId,
  }));

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
    const auth = await authorizeNotifications();
    if (auth.response) return auth.response;
    const { contaId } = auth;
    const requestedContaId = new URL(_req.url).searchParams.get('contaId')?.trim();
    if (requestedContaId && requestedContaId !== contaId) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }

    const financialCustomer = await resolveFinancialCustomer(ctxParams.id, contaId);
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
      contaId,
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
    return jsonError(500, 'ERRO_LISTAR_NOTIFICACOES', 'Não foi possível consultar os canais de aviso.');
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ctxParams = await ctx.params;
  try {
    const auth = await authorizeNotifications();
    if (auth.response) return auth.response;
    const { contaId, actorId } = auth;
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

    const requestedContaId = parsed.data.contaId?.trim();
    if (requestedContaId && requestedContaId !== contaId) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }

    const financialCustomer = await resolveFinancialCustomer(ctxParams.id, contaId);
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
      contaId,
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
      contaId,
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

    await runWithTenant(contaId, (tx) => tx.matriculaLog.create({
      data: {
        matriculaId: financialCustomer.matriculaId,
        actorId,
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
    }));

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
    return jsonError(500, 'ERRO_ATUALIZAR_NOTIFICACOES', 'Não foi possível atualizar os canais de aviso.');
  }
}
