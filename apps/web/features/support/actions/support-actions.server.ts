import type { Prisma } from '@prisma/client';
import {
  getAsaasPaymentDetails,
  replayWebhookByEventId,
  reconcileAcademicChargesWithAsaas,
} from '@alusa/finance';

import type { GlobalAdminSession } from '@/features/global-admin/auth/session.server';
import { sendInviteEmail } from '@/lib/auth-email-flow';
import prisma from '@/lib/prisma';
import { auditActorFromSession, recordSupportAudit } from '../audit/support-audit.server';
import { canRunFinanceActions, canWriteSupportNotes } from '../auth/permissions';

export async function addSupportNote(input: {
  session: GlobalAdminSession;
  contaId: string;
  entityType: string;
  entityId: string;
  body: string;
  caseId?: string | null;
  reason: string;
  requestMeta?: { ip?: string | null; userAgent?: string | null };
}) {
  if (!canWriteSupportNotes(input.session.role)) {
    throw new Error('Permissão insuficiente para adicionar nota.');
  }

  const note = await prisma.supportNote.create({
    data: {
      contaId: input.contaId,
      entityType: input.entityType,
      entityId: input.entityId,
      caseId: input.caseId ?? null,
      body: input.body.trim(),
      authorId: input.session.supportUserId ?? null,
      authorName: input.session.username,
      authorRole: input.session.role,
    },
  });

  await recordSupportAudit({
    ...auditActorFromSession(input.session),
    ...input.requestMeta,
    contaId: input.contaId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: 'support.note.create',
    reason: input.reason,
    after: note as unknown as Prisma.InputJsonValue,
  });

  return note;
}

export async function createSupportCase(input: {
  session: GlobalAdminSession;
  contaId: string;
  title: string;
  description?: string | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  entityType?: string | null;
  entityId?: string | null;
  reason: string;
  requestMeta?: { ip?: string | null; userAgent?: string | null };
}) {
  if (!canWriteSupportNotes(input.session.role)) {
    throw new Error('Permissão insuficiente para abrir caso.');
  }

  const supportCase = await prisma.supportCase.create({
    data: {
      contaId: input.contaId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority ?? 'MEDIUM',
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      openedById: input.session.supportUserId ?? null,
      openedByName: input.session.username,
    },
  });

  await recordSupportAudit({
    ...auditActorFromSession(input.session),
    ...input.requestMeta,
    contaId: input.contaId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: 'support.case.create',
    reason: input.reason,
    after: supportCase as unknown as Prisma.InputJsonValue,
  });

  return supportCase;
}

export async function markSupportDivergence(input: {
  session: GlobalAdminSession;
  contaId: string;
  entityType: string;
  entityId: string;
  reason: string;
  requestMeta?: { ip?: string | null; userAgent?: string | null };
}) {
  if (!canRunFinanceActions(input.session.role)) {
    throw new Error('Permissão insuficiente para marcar divergência.');
  }

  const supportCase = await prisma.supportCase.create({
    data: {
      contaId: input.contaId,
      title: `Divergência em ${input.entityType} ${input.entityId}`,
      description: input.reason,
      priority: 'HIGH',
      entityType: input.entityType,
      entityId: input.entityId,
      openedById: input.session.supportUserId ?? null,
      openedByName: input.session.username,
    },
  });

  await recordSupportAudit({
    ...auditActorFromSession(input.session),
    ...input.requestMeta,
    contaId: input.contaId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: 'support.divergence.mark',
    reason: input.reason,
    after: supportCase as unknown as Prisma.InputJsonValue,
  });

  return supportCase;
}

export async function reconcileSupportCharge(input: {
  session: GlobalAdminSession;
  contaId: string;
  chargeId: string;
  reason: string;
  requestMeta?: { ip?: string | null; userAgent?: string | null };
}) {
  if (!canRunFinanceActions(input.session.role)) {
    throw new Error('Permissão insuficiente para reconciliação.');
  }

  const readModel = await prisma.chargeReadModel.findFirst({
    where: {
      contaId: input.contaId,
      OR: [{ id: input.chargeId }, { sourceId: input.chargeId }, { asaasPaymentId: input.chargeId }],
    },
    select: { id: true, sourceKind: true, sourceId: true, asaasPaymentId: true },
  });

  if (!readModel?.asaasPaymentId) {
    throw new Error('Cobrança sem paymentId Asaas para reconciliação individual.');
  }

  if (readModel.sourceKind !== 'COBRANCA') {
    throw new Error('Reconciliação individual está disponível apenas para cobranças acadêmicas vinculadas.');
  }

  const result = await reconcileAcademicChargesWithAsaas({
    contaId: input.contaId,
    cobrancaIds: [readModel.sourceId],
    force: true,
  });

  await recordSupportAudit({
    ...auditActorFromSession(input.session),
    ...input.requestMeta,
    contaId: input.contaId,
    entityType: 'CHARGE',
    entityId: readModel.id,
    action: 'support.finance.reconcile_charge',
    reason: input.reason,
    metadata: {
      asaasPaymentId: readModel.asaasPaymentId,
      result,
    } as unknown as Prisma.InputJsonValue,
  });

  return result;
}

export async function replaySupportWebhook(input: {
  session: GlobalAdminSession;
  contaId: string;
  webhookId: string;
  reason: string;
  requestMeta?: { ip?: string | null; userAgent?: string | null };
}) {
  if (!canRunFinanceActions(input.session.role) && input.session.role !== 'SUPPORT_DEVELOPER') {
    throw new Error('Permissão insuficiente para reprocessar webhook.');
  }

  const webhook = await prisma.webhookAsaas.findFirst({
    where: { contaId: input.contaId, OR: [{ id: input.webhookId }, { eventId: input.webhookId }] },
    select: { id: true, eventId: true, evento: true, status: true },
  });

  if (!webhook?.eventId) {
    throw new Error('Webhook sem eventId não pode ser reprocessado por esta ação.');
  }

  const result = await replayWebhookByEventId({
    eventId: webhook.eventId,
    contaId: input.contaId,
  });

  await recordSupportAudit({
    ...auditActorFromSession(input.session),
    ...input.requestMeta,
    contaId: input.contaId,
    entityType: 'WEBHOOK',
    entityId: webhook.id,
    action: 'support.webhook.replay',
    reason: input.reason,
    before: webhook as unknown as Prisma.InputJsonValue,
    after: result as unknown as Prisma.InputJsonValue,
  });

  return result;
}

async function findSupportChargeForAction(contaId: string, chargeId: string) {
  const readModel = await prisma.chargeReadModel.findFirst({
    where: {
      contaId,
      OR: [{ id: chargeId }, { sourceId: chargeId }, { asaasPaymentId: chargeId }],
    },
    select: {
      id: true,
      sourceKind: true,
      sourceId: true,
      asaasPaymentId: true,
      status: true,
    },
  });

  if (!readModel?.asaasPaymentId) {
    throw new Error('Cobrança sem paymentId Asaas.');
  }

  return { ...readModel, asaasPaymentId: readModel.asaasPaymentId };
}

export async function checkSupportAsaasChargeStatus(input: {
  session: GlobalAdminSession;
  contaId: string;
  chargeId: string;
  reason: string;
  requestMeta?: { ip?: string | null; userAgent?: string | null };
}) {
  if (!canRunFinanceActions(input.session.role) && input.session.role !== 'SUPPORT_DEVELOPER') {
    throw new Error('Permissão insuficiente para consultar Asaas.');
  }

  const readModel = await findSupportChargeForAction(input.contaId, input.chargeId);
  const result = await getAsaasPaymentDetails({
    contaId: input.contaId,
    paymentId: readModel.asaasPaymentId,
    includePixQrCode: true,
  });

  const payload = {
    paymentId: result.payment.id,
    status: result.payment.status,
    value: result.payment.value,
    dueDate: result.payment.dueDate,
    invoiceUrl: result.payment.invoiceUrl ?? null,
    bankSlipUrl: result.payment.bankSlipUrl ?? null,
    hasPixQrCode: Boolean(result.pixQrCode?.payload || result.pixQrCode?.encodedImage),
  };

  await recordSupportAudit({
    ...auditActorFromSession(input.session),
    ...input.requestMeta,
    contaId: input.contaId,
    entityType: 'CHARGE',
    entityId: readModel.id,
    action: 'support.asaas.check_charge_status',
    reason: input.reason,
    before: readModel as unknown as Prisma.InputJsonValue,
    after: payload as unknown as Prisma.InputJsonValue,
  });

  return payload;
}

export async function refreshSupportChargeLinks(input: {
  session: GlobalAdminSession;
  contaId: string;
  chargeId: string;
  reason: string;
  requestMeta?: { ip?: string | null; userAgent?: string | null };
}) {
  if (!canRunFinanceActions(input.session.role)) {
    throw new Error('Permissão insuficiente para obter links oficiais da cobrança.');
  }

  const readModel = await findSupportChargeForAction(input.contaId, input.chargeId);
  const result = await getAsaasPaymentDetails({
    contaId: input.contaId,
    paymentId: readModel.asaasPaymentId,
    includePixQrCode: true,
  });

  const payload = {
    paymentId: result.payment.id,
    invoiceUrl: result.payment.invoiceUrl ?? null,
    bankSlipUrl: result.payment.bankSlipUrl ?? null,
    pixCopyPaste: result.pixQrCode?.payload ?? null,
    hasPixImage: Boolean(result.pixQrCode?.encodedImage),
  };

  await recordSupportAudit({
    ...auditActorFromSession(input.session),
    ...input.requestMeta,
    contaId: input.contaId,
    entityType: 'CHARGE',
    entityId: readModel.id,
    action: 'support.charge.refresh_official_links',
    reason: input.reason,
    metadata: payload as unknown as Prisma.InputJsonValue,
  });

  return payload;
}

export async function resendSupportInvite(input: {
  session: GlobalAdminSession;
  contaId: string;
  inviteId: string;
  reason: string;
  requestMeta?: { ip?: string | null; userAgent?: string | null };
}) {
  if (!canWriteSupportNotes(input.session.role)) {
    throw new Error('Permissão insuficiente para reenviar convite.');
  }

  const invite = await prisma.invite.findFirst({
    where: {
      contaId: input.contaId,
      OR: [{ id: input.inviteId }, { token: input.inviteId }, { email: input.inviteId }],
    },
    select: {
      id: true,
      token: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
    },
  });

  if (!invite) throw new Error('Convite não encontrado para esta conta.');
  if (invite.status !== 'PENDING') throw new Error('Apenas convites pendentes podem ser reenviados.');
  if (!invite.email) throw new Error('Convite sem e-mail não pode ser reenviado.');
  if (invite.expiresAt.getTime() <= Date.now()) throw new Error('Convite expirado. Gere um novo convite.');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const inviteUrl = `${baseUrl}/auth/register?token=${invite.token}`;
  const delivery = await sendInviteEmail({
    inviteId: invite.id,
    inviteUrl,
    email: invite.email,
    role: invite.role,
    invitedByName: input.session.username,
  });

  await recordSupportAudit({
    ...auditActorFromSession(input.session),
    ...input.requestMeta,
    contaId: input.contaId,
    entityType: 'INVITE',
    entityId: invite.id,
    action: 'support.invite.resend',
    reason: input.reason,
    metadata: {
      email: invite.email,
      role: invite.role,
      delivery,
    } as unknown as Prisma.InputJsonValue,
  });

  return { inviteId: invite.id, email: invite.email, delivered: Boolean(delivery?.emailId) };
}
