import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  MatriculaBillingOutboxStatus,
  MatriculaBillingProvisionStatus,
} from '@prisma/client';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { matriculaRouteParamsDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { enqueueEnrollmentBillingOutbox } from '@/src/server/matriculas/enrollment-billing-outbox.service';
import { billingProvisionUpdate } from '@/src/server/matriculas/billing-provision-status';
import { reconcileAcademicChargesWithAsaas } from '@alusa/finance';

export const dynamic = 'force-dynamic';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
};

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

async function requireUser() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = (session as { user?: SessionUser } | null)?.user ?? null;
  if (!user?.id || !user.contaId) return { error: jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.') };
  if (!user.role || !allowedRoles.has(String(user.role).toUpperCase())) {
    return { error: jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para acompanhar o financeiro.') };
  }
  return { user: { id: user.id, contaId: user.contaId, role: user.role } };
}

function toOperationalStatus(input: {
  billingProvisionStatus: MatriculaBillingProvisionStatus;
  outboxStatus?: MatriculaBillingOutboxStatus | null;
}) {
  if (
    input.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO ||
    input.outboxStatus === MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION
  ) {
    return 'RECONCILIACAO_NECESSARIA';
  }
  if (
    input.billingProvisionStatus === MatriculaBillingProvisionStatus.FALHO ||
    input.outboxStatus === MatriculaBillingOutboxStatus.FAILED
  ) {
    return 'INTERVENCAO_NECESSARIA';
  }
  if (
    input.billingProvisionStatus === MatriculaBillingProvisionStatus.PENDENTE ||
    input.billingProvisionStatus === MatriculaBillingProvisionStatus.PROCESSANDO ||
    input.outboxStatus === MatriculaBillingOutboxStatus.PENDING ||
    input.outboxStatus === MatriculaBillingOutboxStatus.PROCESSING
  ) {
    return 'SINCRONIZANDO_FINANCEIRO';
  }
  if (input.billingProvisionStatus === MatriculaBillingProvisionStatus.PROVISIONADO) {
    return 'FINANCEIRO_PREPARADO';
  }
  return 'NAO_APLICAVEL';
}

async function loadProvisioningView(matriculaId: string, contaId: string) {
  const matricula = await prisma.matricula.findFirst({
    where: { id: matriculaId, contaId },
    select: {
      id: true,
      contaId: true,
      billingProvisionStatus: true,
      billingProvisionError: true,
      updatedAt: true,
    },
  });
  if (!matricula) return null;

  const latestOutbox = await prisma.matriculaBillingOutbox.findFirst({
    where: { contaId, matriculaId },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      status: true,
      attempts: true,
      availableAt: true,
      processedAt: true,
      lastAttemptAt: true,
      lastError: true,
      updatedAt: true,
    },
  });

  return {
    matriculaId: matricula.id,
    status: toOperationalStatus({
      billingProvisionStatus: matricula.billingProvisionStatus,
      outboxStatus: latestOutbox?.status ?? null,
    }),
    billingProvisionStatus: matricula.billingProvisionStatus,
    message:
      matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO
        ? 'Financeiro com resultado incerto. Reconcilie antes de reenviar.'
        : latestOutbox?.status === MatriculaBillingOutboxStatus.FAILED
          ? 'Financeiro com erro. Reenvio operacional disponível.'
          : latestOutbox?.status === MatriculaBillingOutboxStatus.PENDING
            ? 'Financeiro sincronizando automaticamente.'
            : 'Estado financeiro local atualizado.',
    canRetry: latestOutbox?.status === MatriculaBillingOutboxStatus.FAILED,
    requiresReconciliation:
      matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO ||
      latestOutbox?.status === MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
    lastError: latestOutbox?.lastError ?? matricula.billingProvisionError ?? null,
    updatedAt: (latestOutbox?.updatedAt ?? matricula.updatedAt).toISOString(),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ('error' in auth) return auth.error;

  const { id } = matriculaRouteParamsDTOSchema.parse(await params);
  const view = await loadProvisioningView(id, auth.user.contaId);
  if (!view) return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada.');

  return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === 'string' ? body.action : 'RETRY_FAILED';
  if (action !== 'RETRY_FAILED' && action !== 'RECONCILE_LOCAL_CHARGES') {
    return jsonError(400, 'ACAO_INVALIDA', 'Ação operacional inválida.');
  }

  const { id } = matriculaRouteParamsDTOSchema.parse(await params);
  const view = await loadProvisioningView(id, auth.user.contaId);
  if (!view) return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada.');

  if (action === 'RECONCILE_LOCAL_CHARGES') {
    const cobrancas = await prisma.cobranca.findMany({
      where: { contaId: auth.user.contaId, matriculaId: id, asaasPaymentId: { not: null } },
      select: { id: true },
    });

    if (cobrancas.length === 0) {
      return jsonError(
        409,
        'RECONCILIACAO_MANUAL_NECESSARIA',
        'Não há cobrança local com identificador financeiro para reconciliar automaticamente. Revise antes de reenviar.',
      );
    }

    const result = await reconcileAcademicChargesWithAsaas({
      contaId: auth.user.contaId,
      cobrancaIds: cobrancas.map((cobranca) => cobranca.id),
      force: true,
    });

    await prisma.matriculaLog.create({
      data: {
        matriculaId: id,
        actorId: auth.user.id,
        action: 'BILLING_PROVISION_RECONCILIATION_CHECKED',
        metadata: {
          checked: result.checked,
          updated: result.updated,
          cobrancaIds: cobrancas.map((cobranca) => cobranca.id),
        },
      },
    });

    const nextView = await loadProvisioningView(id, auth.user.contaId);
    return NextResponse.json(
      {
        ...nextView,
        reconciliation: { checked: result.checked, updated: result.updated },
      },
      { status: 202, headers: { 'cache-control': 'no-store' } },
    );
  }

  if (view.requiresReconciliation) {
    return jsonError(
      409,
      'RECONCILIACAO_OBRIGATORIA',
      'Há resultado financeiro incerto. Reconcilie antes de reenviar para evitar duplicidade.',
    );
  }

  const latestOutbox = await prisma.matriculaBillingOutbox.findFirst({
    where: { contaId: auth.user.contaId, matriculaId: id },
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, status: true },
  });

  if (latestOutbox?.status === MatriculaBillingOutboxStatus.FAILED) {
    await prisma.$transaction(async (tx) => {
      await tx.matriculaBillingOutbox.update({
        where: { id: latestOutbox.id },
        data: {
          status: MatriculaBillingOutboxStatus.PENDING,
          availableAt: new Date(),
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      await tx.matricula.updateMany({
        where: { id, contaId: auth.user.contaId },
        data: billingProvisionUpdate(MatriculaBillingProvisionStatus.PENDENTE),
      });
    });
  } else {
    await enqueueEnrollmentBillingOutbox({
      contaId: auth.user.contaId,
      matriculaId: id,
      actorUserId: auth.user.id,
    });
  }

  const nextView = await loadProvisioningView(id, auth.user.contaId);
  return NextResponse.json(nextView, { status: 202, headers: { 'cache-control': 'no-store' } });
}
