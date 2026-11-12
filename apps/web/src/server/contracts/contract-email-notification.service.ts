import { randomUUID } from 'node:crypto';
import type { ContractEmailNotification } from '@prisma/client';
import { decryptSecret } from '@alusa/database';
import { prisma } from '@/lib/prisma';
import { runWithTenant } from '@/lib/prisma-tenant';
import { isMaiorDeIdade } from '@alusa/domain';
import { sendTransactionalEmail } from '@/lib/email/transactional-email';
import { enqueueContractEmailNotification } from './contract-email-queue';

export async function queueManualContractEmail(input: { contaId: string; contratoId: string; actorId: string; operationId: string }) {
  return runWithTenant(input.contaId, async (tx) => {
    const contract = await tx.contrato.findFirst({
      where: { id: input.contratoId, contaId: input.contaId, status: { in: ['PENDENTE', 'EXPIRADO'] }, matricula: { contaId: input.contaId } },
      select: {
        id: true, matriculaId: true, tokenPublicoCriptografado: true, tokenPublicoHash: true,
        matricula: {
          select: {
            aluno: { select: { contaId: true, nome: true, email: true, dataNasc: true, responsaveis: { where: { contaId: input.contaId, tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } }, orderBy: { id: 'asc' }, take: 1, select: { responsavel: { select: { contaId: true, nome: true, email: true } } } } } },
            responsavelFinanceiro: { select: { contaId: true, nome: true, email: true } },
          },
        },
        conta: { select: { contractNotificationsEnabled: true, contractEmailNotificationsEnabled: true } },
      },
    });
    if (!contract) return { status: 'NOT_FOUND' as const };
    if (!contract.conta.contractNotificationsEnabled || !contract.conta.contractEmailNotificationsEnabled) return { status: 'DISABLED' as const };
    if (!contract.tokenPublicoCriptografado || !contract.tokenPublicoHash) return { status: 'LINK_UNAVAILABLE' as const };
    if (contract.matricula.aluno.contaId !== input.contaId) return { status: 'RECIPIENT_UNAVAILABLE' as const };
    const isAdult = isMaiorDeIdade(contract.matricula.aluno.dataNasc);
    const financialGuardian = contract.matricula.responsavelFinanceiro?.contaId === input.contaId ? contract.matricula.responsavelFinanceiro : null;
    const linkedGuardian = contract.matricula.aluno.responsaveis[0]?.responsavel;
    const guardian = financialGuardian ?? (linkedGuardian?.contaId === input.contaId ? linkedGuardian : null);
    const recipient = isAdult
      ? { name: contract.matricula.aluno.nome, email: contract.matricula.aluno.email }
      : { name: guardian?.nome ?? contract.matricula.aluno.nome, email: guardian?.email ?? null };
    const recipientEmail = recipient.email?.trim();
    if (!recipientEmail) return { status: 'RECIPIENT_UNAVAILABLE' as const };
    const token = decryptSecret(contract.tokenPublicoCriptografado);
    if (!token) return { status: 'LINK_UNAVAILABLE' as const };
    const notification = await enqueueContractEmailNotification(tx, {
      contaId: input.contaId,
      contratoId: contract.id,
      matriculaId: contract.matriculaId,
      token,
      tokenHash: contract.tokenPublicoHash,
      recipientEmail: recipientEmail.toLowerCase(),
      recipientName: recipient.name,
      deliveryKey: `contract:${contract.id}:email:manual:${input.operationId}`,
    });
    await tx.auditLog.create({ data: { contaId: input.contaId, actorType: 'USER', actorId: input.actorId, action: 'CONTRACT_EMAIL_RESEND_QUEUED', entityType: 'CONTRATO', entityId: contract.id, correlationId: notification.deliveryKey, metadata: { channel: 'EMAIL', notificationId: notification.id } } });
    return { status: 'QUEUED' as const, notificationId: notification.id };
  });
}

export async function getContractEmailNotificationHistory(input: { contaId: string; contratoId: string }) {
  return runWithTenant(input.contaId, async (tx) => {
    const contract = await tx.contrato.findFirst({ where: { id: input.contratoId, contaId: input.contaId, matricula: { contaId: input.contaId } }, select: { id: true } });
    if (!contract) return null;
    const notifications = await tx.contractEmailNotification.findMany({ where: { contaId: input.contaId, contratoId: contract.id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, attempts: true, lastErrorCode: true, lastError: true, providerEmailId: true, recipientEmail: true, createdAt: true, processedAt: true } });
    return notifications.map((notification) => ({ ...notification, recipientEmail: maskRecipientEmail(notification.recipientEmail) }));
  });
}

function safeError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('RESEND_API_KEY') || message.includes('EMAIL_FROM')) return { code: 'EMAIL_CONFIGURATION_MISSING', message: 'Configuração de e-mail indisponível. O envio será tentado novamente.' };
  return { code: 'EMAIL_PROVIDER_ERROR', message: 'Não foi possível enviar o e-mail. Uma nova tentativa será realizada.' };
}

function publicOrigin() {
  return process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
}

export async function drainContractEmailNotifications(input: { contaId: string; limit?: number; workerId?: string }) {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const workerId = input.workerId ?? `contract-email-${randomUUID()}`;
  const due = await runWithTenant(input.contaId, (tx) => tx.contractEmailNotification.findMany({
    where: { contaId: input.contaId, OR: [{ status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() } }, { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] },
    orderBy: { createdAt: 'asc' }, take: limit, select: { id: true },
  }));
  const result = { claimed: 0, accepted: 0, retried: 0, deadLettered: 0, skipped: 0 };
  for (const candidate of due) {
    const claimed = await runWithTenant(input.contaId, async (tx) => {
      const updated = await tx.contractEmailNotification.updateMany({
        where: { id: candidate.id, contaId: input.contaId, OR: [{ status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() } }, { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] },
        data: { status: 'PROCESSING', attempts: { increment: 1 }, lockedAt: new Date(), lockedBy: workerId },
      });
      if (updated.count !== 1) return null;
      return tx.contractEmailNotification.findFirst({ where: { id: candidate.id, contaId: input.contaId } });
    });
    if (!claimed) continue;
    result.claimed += 1;
    try {
    const prepared = await runWithTenant(input.contaId, async (tx) => {
      const current = await tx.contractEmailNotification.findFirst({ where: { id: claimed.id, contaId: input.contaId } });
      if (!current || current.status !== 'PROCESSING' || current.lockedBy !== workerId) return { skip: 'LOST_LEASE' as const };
      const contract = await tx.contrato.findFirst({
        where: { id: current.contratoId, contaId: input.contaId, status: { in: ['PENDENTE', 'EXPIRADO'] }, tokenPublicoHash: current.tokenPublicoHash, matricula: { contaId: input.contaId } },
        select: {
          id: true, conta: { select: { nome: true, contractNotificationsEnabled: true, contractEmailNotificationsEnabled: true } },
          matricula: { select: { aluno: { select: { contaId: true, nome: true, email: true, dataNasc: true, responsaveis: { where: { contaId: input.contaId, tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } }, orderBy: { id: 'asc' }, take: 1, select: { responsavel: { select: { contaId: true, nome: true, email: true } } } } } }, responsavelFinanceiro: { select: { contaId: true, nome: true, email: true } } } },
        },
      });
      if (!contract) return { skip: 'LINK_STALE' as const };
      if (contract.matricula.aluno.contaId !== input.contaId) return { skip: 'STUDENT_TENANT_MISMATCH' as const };
      if (!contract.conta.contractNotificationsEnabled || !contract.conta.contractEmailNotificationsEnabled) return { skip: 'CHANNEL_DISABLED' as const };
      const adult = isMaiorDeIdade(contract.matricula.aluno.dataNasc);
      const financialGuardian = contract.matricula.responsavelFinanceiro?.contaId === input.contaId ? contract.matricula.responsavelFinanceiro : null;
      const linkedGuardian = contract.matricula.aluno.responsaveis[0]?.responsavel;
      const guardian = financialGuardian ?? (linkedGuardian?.contaId === input.contaId ? linkedGuardian : null);
      const recipient = adult ? { name: contract.matricula.aluno.nome, email: contract.matricula.aluno.email } : { name: guardian?.nome ?? contract.matricula.aluno.nome, email: guardian?.email ?? null };
      if (!recipient.email || recipient.email.trim().toLowerCase() !== current.recipientEmail.trim().toLowerCase()) return { skip: 'RECIPIENT_CHANGED' as const };
      const token = decryptSecret(current.tokenCriptografado);
      if (!token) return { skip: 'TOKEN_UNAVAILABLE' as const };
      return { current, schoolName: contract.conta.nome, recipientName: recipient.name, token };
    });
    if ('skip' in prepared) {
      if (prepared.skip !== 'LOST_LEASE') {
        await finishContractEmail(input.contaId, claimed.id, workerId, { status: 'SKIPPED', errorCode: prepared.skip, error: 'Envio cancelado porque a configuração, o destinatário ou o link mudou.' });
        result.skipped += 1;
      }
      continue;
    }
    const origin = publicOrigin();
      if (!origin) throw new Error('EMAIL_FROM ausente');
      const link = new URL(`/p/contrato/${encodeURIComponent(prepared.token)}`, origin).toString();
      if (new URL(link).protocol !== 'https:') throw new Error('CONTRACT_PUBLIC_URL_MUST_BE_HTTPS');
      const name = escapeHtml(prepared.recipientName);
      const school = escapeHtml(prepared.schoolName);
      const safeLink = escapeHtml(link);
      const delivery = await sendTransactionalEmail({
        to: prepared.current.recipientEmail,
        category: 'contract_signature_link',
        idempotencyKey: prepared.current.deliveryKey,
        from: process.env.EMAIL_FROM_CONTRACTS || process.env.EMAIL_FROM_AUTH || process.env.EMAIL_FROM_INVITES,
        subject: `Contrato para assinatura — ${prepared.schoolName}`,
        html: `<p>Olá, ${name}.</p><p>${school} enviou um contrato para assinatura digital.</p><p><a href="${safeLink}">Acessar e assinar contrato</a></p><p>Se você não esperava esta mensagem, fale diretamente com a instituição.</p>`,
        text: `Olá, ${prepared.recipientName}. ${prepared.schoolName} enviou um contrato para assinatura digital. Acesse: ${link}`,
        tags: [{ name: 'category', value: 'contract_signature_link' }],
      });
      if (delivery.delivery !== 'sent' || !delivery.emailId) throw new Error('EMAIL_PROVIDER_ACCEPTANCE_UNCONFIRMED');
      await finishContractEmail(input.contaId, claimed.id, workerId, { status: 'SENT', providerEmailId: delivery.emailId });
      result.accepted += 1;
    } catch (error) {
      const safe = safeError(error);
      const attempts = claimed.attempts;
      // Resend retains idempotency keys for 24h. Stop blind retries before that
      // window expires so an ambiguous acceptance cannot be resent with a stale key.
      const terminal = attempts >= claimed.maxAttempts || Date.now() - claimed.createdAt.getTime() >= 23 * 60 * 60_000;
      const nextAttemptAt = new Date(Date.now() + Math.min(6 * 60 * 60_000, 30_000 * (2 ** Math.min(attempts - 1, 10))));
      await finishContractEmail(input.contaId, claimed.id, workerId, { status: terminal ? 'DLQ' : 'FAILED', errorCode: safe.code, error: safe.message, nextAttemptAt });
      if (terminal) result.deadLettered += 1;
      else result.retried += 1;
    }
  }
  return result;
}

/** Cross-tenant job discovery only returns tenant IDs; outbox reads/writes still run under runWithTenant. */
const CONTRACT_EMAIL_TENANT_CURSOR_JOB = 'contract-email-notification-tenant-cursor';

/** Select and persist a bounded round-robin tenant page for global cron runs. */
export async function selectContractNotificationTenantIdsForRun(input: { limit: number }) {
  const limit = Math.max(1, Math.min(Math.floor(input.limit), 100));
  return prisma.$transaction(async (tx) => {
    await tx.webhookJobLock.upsert({
      where: { jobName: CONTRACT_EMAIL_TENANT_CURSOR_JOB },
      create: {
        jobName: CONTRACT_EMAIL_TENANT_CURSOR_JOB,
        lockedAt: new Date(0),
        lockedUntil: new Date(0),
        workerId: 'cursor-state',
        metadata: { lastTenantId: null },
      },
      update: {},
    });
    const state = await tx.$queryRaw<Array<{ metadata: unknown }>>`
      SELECT "metadata" FROM "WebhookJobLock"
      WHERE "jobName" = ${CONTRACT_EMAIL_TENANT_CURSOR_JOB}
      FOR UPDATE
    `;
    const metadata = state[0]?.metadata;
    const lastTenantId = typeof metadata === 'object' && metadata !== null && 'lastTenantId' in metadata && typeof metadata.lastTenantId === 'string'
      ? metadata.lastTenantId
      : null;

    let selected = await tx.conta.findMany({
      where: lastTenantId ? { id: { gt: lastTenantId } } : undefined,
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true },
    });
    if (selected.length < limit && lastTenantId) {
      const wrapped = await tx.conta.findMany({
        where: { id: { lte: lastTenantId } },
        orderBy: { id: 'asc' },
        take: limit - selected.length,
        select: { id: true },
      });
      selected = [...selected, ...wrapped];
    }
    const lastSelectedId = selected.at(-1)?.id;
    if (lastSelectedId) {
      await tx.webhookJobLock.update({
        where: { jobName: CONTRACT_EMAIL_TENANT_CURSOR_JOB },
        data: { metadata: { lastTenantId: lastSelectedId } },
      });
    }
    return selected;
  });
}

async function finishContractEmail(contaId: string, id: string, workerId: string, input: { status: 'SENT' | 'FAILED' | 'DLQ' | 'SKIPPED'; providerEmailId?: string; errorCode?: string; error?: string; nextAttemptAt?: Date }) {
  await runWithTenant(contaId, (tx) => tx.contractEmailNotification.updateMany({
    where: { id, contaId, status: 'PROCESSING', lockedBy: workerId },
    data: { status: input.status, providerEmailId: input.providerEmailId ?? null, lastErrorCode: input.errorCode ?? null, lastError: input.error ?? null, nextAttemptAt: input.nextAttemptAt ?? new Date(), lockedAt: null, lockedBy: null, processedAt: input.status === 'SENT' || input.status === 'SKIPPED' ? new Date() : null },
  }));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function maskRecipientEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'E-mail indisponível';
  return `${local.slice(0, 1)}***@${domain}`;
}

export type ContractEmailHistoryItem = Pick<ContractEmailNotification, 'id' | 'status' | 'attempts' | 'lastErrorCode' | 'lastError' | 'providerEmailId' | 'createdAt' | 'processedAt'> & { recipientEmail: string };
