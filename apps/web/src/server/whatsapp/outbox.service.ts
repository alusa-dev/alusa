import {
  WhatsAppConnectionScope,
  WhatsAppConnectionStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppOutboundJobStatus,
  WhatsAppWebhookEventStatus,
  type Prisma,
} from '@prisma/client';
import {
  sanitizeWhatsAppError,
  WhatsAppCloudApiError,
  WhatsAppCloudClient,
  extractWhatsAppWebhookRecords,
  type WhatsAppMessageRequest,
  normalizeBrazilianWhatsAppPhone,
  normalizeWhatsAppPhone,
} from '@alusa/whatsapp';
import { decryptSecret } from '@alusa/database';
import { prisma } from '@/prisma/client';
import { assertWhatsAppConfigured, getWhatsAppRuntimeConfig } from './config';
import { buildContractTemplateIdempotencyKey } from './contract-idempotency';

type EnqueueWhatsAppMessageInput = {
  contaId?: string | null;
  actorUserId?: string | null;
  request: WhatsAppMessageRequest;
  idempotencyKey: string;
  correlationId?: string | null;
};

export type EnqueueWhatsAppMessageResult = {
  jobId: string;
  messageId: string;
  status: WhatsAppOutboundJobStatus;
  deduplicated: boolean;
};

export async function ensurePlatformWhatsAppConnection() {
  const config = assertWhatsAppConfigured();
  return prisma.whatsAppConnection.upsert({
    where: {
      uq_whatsapp_connection_scope_phone: {
        scope: WhatsAppConnectionScope.PLATFORM,
        phoneNumberId: config.phoneNumberId,
      },
    },
    update: {
      wabaId: config.wabaId,
      status: WhatsAppConnectionStatus.ACTIVE,
      lastHealthCheckAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    create: {
      scope: WhatsAppConnectionScope.PLATFORM,
      phoneNumberId: config.phoneNumberId,
      wabaId: config.wabaId,
      status: WhatsAppConnectionStatus.ACTIVE,
      lastHealthCheckAt: new Date(),
    },
  });
}

export async function enqueueWhatsAppMessage(
  input: EnqueueWhatsAppMessageInput,
): Promise<EnqueueWhatsAppMessageResult> {
  const connection = await ensurePlatformWhatsAppConnection();
  const to = normalizeWhatsAppPhone(input.request.to);
  const payload = input.request as unknown as Prisma.InputJsonValue;

  const existing = await prisma.whatsAppOutboundJob.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, messageId: true, status: true },
  });
  if (existing) {
    return {
      jobId: existing.id,
      messageId: existing.messageId,
      status: existing.status,
      deduplicated: true,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.whatsAppMessage.create({
      data: {
        connectionId: connection.id,
        contaId: input.contaId ?? null,
        direction: WhatsAppMessageDirection.OUTBOUND,
        status: WhatsAppMessageStatus.QUEUED,
        toPhoneNumber: to,
        messageType: input.request.kind,
        templateName: input.request.kind === 'template' ? input.request.templateName : null,
        body: input.request.kind === 'text' ? input.request.body : input.request.kind === 'document' ? input.request.caption ?? null : null,
        payload,
        correlationId: input.correlationId ?? null,
      },
    });

    const job = await tx.whatsAppOutboundJob.create({
      data: {
        messageId: message.id,
        connectionId: connection.id,
        contaId: input.contaId ?? null,
        idempotencyKey: input.idempotencyKey,
        status: WhatsAppOutboundJobStatus.PENDING,
        payload,
        correlationId: input.correlationId ?? null,
      },
    });

    if (input.contaId) {
      await tx.auditLog.create({
        data: {
          contaId: input.contaId,
          actorType: input.actorUserId ? 'USER' : 'SYSTEM',
          actorId: input.actorUserId ?? null,
          action: 'whatsapp.message.queued',
          entityType: 'WhatsAppMessage',
          entityId: message.id,
          correlationId: input.correlationId ?? null,
          metadata: {
            kind: input.request.kind,
            recipientSuffix: to.slice(-4),
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
    }

    return { jobId: job.id, messageId: message.id, status: job.status };
  });

  return { ...result, deduplicated: false };
}

export type DrainWhatsAppOutboxResult = {
  claimed: number;
  sent: number;
  retried: number;
  deadLettered: number;
};

export type DrainContractWhatsAppNotificationsResult = {
  claimed: number;
  queued: number;
  retried: number;
  deadLettered: number;
  skipped: number;
};

export async function requeueContractWhatsAppNotification(input: { contaId: string; contratoId: string; actorUserId?: string | null }) {
  const notification = await prisma.contractWhatsAppNotification.findFirst({
    where: { contaId: input.contaId, contratoId: input.contratoId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, recipientPhone: true },
  });
  if (!notification) return null;
  let recipientPhone = notification.recipientPhone;
  try {
    recipientPhone = normalizeBrazilianWhatsAppPhone(recipientPhone);
  } catch {
    // O worker registrará a falha de destinatário sem interromper o reprocessamento.
  }
  const updated = await prisma.contractWhatsAppNotification.updateMany({
    where: { id: notification.id, contaId: input.contaId },
    data: { status: 'PENDING', recipientPhone, nextAttemptAt: new Date(), lockedAt: null, lockedBy: null, processedAt: null, lastErrorCode: null, lastError: null },
  });
  if (updated.count !== 1) return null;
  await prisma.auditLog.create({
    data: {
      contaId: input.contaId,
      actorType: input.actorUserId ? 'USER' : 'SYSTEM',
      actorId: input.actorUserId ?? null,
      action: 'contract.whatsapp.notification.requeued',
      entityType: 'ContractWhatsAppNotification',
      entityId: notification.id,
    },
  });
  return { id: notification.id, previousStatus: notification.status };
}

/** Converts committed contract events into approved Meta template messages. */
export async function drainContractWhatsAppNotifications(input: { limit?: number } = {}): Promise<DrainContractWhatsAppNotificationsResult> {
  const runtimeConfig = getWhatsAppRuntimeConfig();
  if (!runtimeConfig.enabled || !runtimeConfig.accessToken || !runtimeConfig.appSecret || !runtimeConfig.phoneNumberId || !runtimeConfig.wabaId) {
    return { claimed: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0 };
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const now = new Date();
  const workerId = `contract-whatsapp-${process.pid}-${Date.now()}`;
  const staleAt = new Date(Date.now() - 10 * 60_000);

  await prisma.contractWhatsAppNotification.updateMany({
    where: { status: 'PROCESSING', lockedAt: { lt: staleAt } },
    data: { status: 'FAILED', nextAttemptAt: now, lockedAt: null, lockedBy: null, lastErrorCode: 'STALE_LOCK_RECOVERED' },
  });

  const candidates = await prisma.contractWhatsAppNotification.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, contaId: true },
  });
  const result: DrainContractWhatsAppNotificationsResult = { claimed: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0 };

  for (const candidate of candidates) {
    const claimed = await prisma.contractWhatsAppNotification.updateMany({
      where: { id: candidate.id, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'PROCESSING', lockedAt: new Date(), lockedBy: workerId, attempts: { increment: 1 }, lastErrorCode: null, lastError: null },
    });
    if (claimed.count !== 1) continue;
    result.claimed += 1;

    const notification = await prisma.contractWhatsAppNotification.findFirst({
      where: { id: candidate.id, contaId: candidate.contaId },
      include: {
        contrato: {
          select: {
            id: true,
            status: true,
            tokenExpiraEm: true,
            tokenPublicoCriptografado: true,
            matricula: {
              select: {
                dataInicio: true,
                aluno: {
                  select: {
                    nome: true,
                    dataNasc: true,
                    responsaveis: {
                      where: { tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
                      orderBy: { id: 'asc' },
                      take: 1,
                      select: { responsavel: { select: { nome: true } } },
                    },
                  },
                },
                responsavelFinanceiro: { select: { nome: true } },
                turma: { select: { nome: true } },
              },
            },
          },
        },
        conta: { select: { nome: true } },
      },
    });
    if (!notification) {
      await prisma.contractWhatsAppNotification.updateMany({
        where: { id: candidate.id, contaId: candidate.contaId, status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          nextAttemptAt: new Date(Date.now() + 60_000),
          lastErrorCode: 'NOTIFICATION_NOT_FOUND',
          lastError: 'Registro de notificação não encontrado durante o processamento.',
          lockedAt: null,
          lockedBy: null,
        },
      });
      result.retried += 1;
      continue;
    }

    try {
      if (notification.contrato.status !== 'PENDENTE' || (notification.contrato.tokenExpiraEm && notification.contrato.tokenExpiraEm <= now)) {
        await prisma.contractWhatsAppNotification.update({ where: { id: notification.id }, data: { status: 'SKIPPED', processedAt: now, lockedAt: null, lockedBy: null, lastErrorCode: 'CONTRACT_NOT_SENDABLE' } });
        result.skipped += 1;
        continue;
      }
      const token = decryptSecret(notification.tokenCriptografado || notification.contrato.tokenPublicoCriptografado);
      if (!token) throw new Error('CONTRACT_TOKEN_UNAVAILABLE');
      const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
      if (!baseUrl) throw new Error('CONTRACT_PUBLIC_URL_BASE_UNAVAILABLE');
      const publicUrl = new URL(`/p/contrato/${encodeURIComponent(token)}`, baseUrl);
      if (publicUrl.protocol !== 'https:') throw new Error('CONTRACT_PUBLIC_URL_MUST_BE_HTTPS');

      const isMinorTemplate = notification.recipientType === 'RESPONSAVEL';
      const recipientName = isMinorTemplate
        ? notification.contrato.matricula.responsavelFinanceiro?.nome ?? notification.contrato.matricula.aluno.responsaveis[0]?.responsavel.nome ?? 'responsável legal'
        : notification.contrato.matricula.aluno.nome;
      const bodyValues = isMinorTemplate
        ? [notification.contrato.matricula.aluno.nome, notification.conta.nome, notification.contrato.matricula.turma?.nome ?? 'não informado', formatDate(notification.contrato.matricula.dataInicio)]
        : [notification.conta.nome, notification.contrato.matricula.turma?.nome ?? 'não informado', formatDate(notification.contrato.matricula.dataInicio)];
      const recipientPhone = normalizeBrazilianWhatsAppPhone(notification.recipientPhone);
      const request: WhatsAppMessageRequest = {
        kind: 'template',
        to: recipientPhone,
        templateName: notification.templateName,
        languageCode: notification.languageCode,
        components: [
          { type: 'header', parameters: [{ type: 'text', text: recipientName }] },
          { type: 'body', parameters: bodyValues.map((text) => ({ type: 'text' as const, text })) },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
        ],
      };
      const queued = await enqueueWhatsAppMessage({
        contaId: notification.contaId,
        request,
        idempotencyKey: buildContractTemplateIdempotencyKey({
          phoneNumberId: runtimeConfig.phoneNumberId,
          notificationId: notification.id,
          attempt: notification.attempts,
          contaId: notification.contaId,
          contratoId: notification.contratoId,
          recipientPhone,
          templateName: notification.templateName,
        }),
        correlationId: notification.correlationId ?? `contract:${notification.contratoId}`,
      });
      await prisma.contractWhatsAppNotification.update({ where: { id: notification.id }, data: { status: 'SENT', whatsappJobId: queued.jobId, processedAt: now, lockedAt: null, lockedBy: null } });
      result.queued += 1;
    } catch (error) {
      const sanitized = sanitizeWhatsAppError(error);
      const deadLetter = notification.attempts >= notification.maxAttempts || ['CONTRACT_TOKEN_UNAVAILABLE', 'CONTRACT_PUBLIC_URL_BASE_UNAVAILABLE', 'CONTRACT_PUBLIC_URL_MUST_BE_HTTPS'].includes(sanitized.code ?? '');
      await prisma.contractWhatsAppNotification.update({
        where: { id: notification.id },
        data: {
          status: deadLetter ? 'DLQ' : 'FAILED',
          nextAttemptAt: new Date(Date.now() + Math.min(60 * 60_000, 15_000 * 2 ** Math.max(notification.attempts - 1, 0))),
          lastErrorCode: sanitized.code,
          lastError: sanitized.message,
          lockedAt: null,
          lockedBy: null,
          ...(deadLetter ? { processedAt: now } : {}),
        },
      });
      if (deadLetter) result.deadLettered += 1;
      else result.retried += 1;
    }
  }
  return result;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Manaus' }).format(value);
}

export async function drainWhatsAppOutbox(input: { limit?: number; jobId?: string } = {}): Promise<DrainWhatsAppOutboxResult> {
  const config = assertWhatsAppConfigured();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const workerId = `whatsapp-${process.pid}-${Date.now()}`;
  const now = new Date();

  await prisma.whatsAppOutboundJob.updateMany({
    where: {
      status: WhatsAppOutboundJobStatus.PROCESSING,
      lockedAt: { lt: new Date(Date.now() - 10 * 60_000) },
    },
    data: {
      status: WhatsAppOutboundJobStatus.FAILED,
      nextAttemptAt: now,
      lastErrorCode: 'STALE_LOCK_RECOVERED',
      lastError: 'Lock de processamento recuperado pelo worker.',
      lockedAt: null,
      lockedBy: null,
    },
  });

  const candidates = await prisma.whatsAppOutboundJob.findMany({
    where: {
      ...(input.jobId ? { id: input.jobId } : {}),
      status: { in: [WhatsAppOutboundJobStatus.PENDING, WhatsAppOutboundJobStatus.FAILED] },
      nextAttemptAt: { lte: now },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const result: DrainWhatsAppOutboxResult = { claimed: 0, sent: 0, retried: 0, deadLettered: 0 };
  const client = new WhatsAppCloudClient({
    accessToken: config.accessToken,
    graphApiVersion: config.graphApiVersion,
  });

  for (const candidate of candidates) {
    const claimed = await prisma.whatsAppOutboundJob.updateMany({
      where: {
        id: candidate.id,
        status: { in: [WhatsAppOutboundJobStatus.PENDING, WhatsAppOutboundJobStatus.FAILED] },
      },
      data: {
        status: WhatsAppOutboundJobStatus.PROCESSING,
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) continue;
    result.claimed += 1;

    const job = await prisma.whatsAppOutboundJob.findUnique({
      where: { id: candidate.id },
      include: { message: true, connection: true },
    });
    if (!job) continue;

    try {
      if (job.message.status === WhatsAppMessageStatus.SENT && job.message.externalMessageId) {
        await markWhatsAppJobSent(job.id, job.message.id, job.message.externalMessageId);
        result.sent += 1;
        continue;
      }

      const request = job.payload as unknown as WhatsAppMessageRequest;
      const sent = await client.sendMessage(job.connection.phoneNumberId, request);
      await markWhatsAppJobSent(job.id, job.message.id, sent.messageId);
      result.sent += 1;
    } catch (error) {
      const outcome = await markWhatsAppJobFailure(job, error);
      if (outcome === 'DLQ') result.deadLettered += 1;
      else result.retried += 1;
    }
  }

  return result;
}

async function markWhatsAppJobSent(jobId: string, messageId: string, externalMessageId: string) {
  await prisma.$transaction([
    prisma.whatsAppOutboundJob.update({
      where: { id: jobId },
      data: {
        status: WhatsAppOutboundJobStatus.SENT,
        processedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: null,
        lastError: null,
      },
    }),
    prisma.whatsAppMessage.update({
      where: { id: messageId },
      data: {
        status: WhatsAppMessageStatus.SENT,
        externalMessageId,
        errorCode: null,
        errorMessage: null,
      },
    }),
  ]);
}

async function markWhatsAppJobFailure(
  job: { id: string; messageId: string; attempts: number; maxAttempts: number },
  error: unknown,
): Promise<'RETRY' | 'DLQ'> {
  const sanitized = sanitizeWhatsAppError(error);
  const retryable = !(error instanceof WhatsAppCloudApiError) || error.isRetryable;
  const exhausted = job.attempts >= job.maxAttempts;
  const deadLetter = !retryable || exhausted;
  const delayMs = Math.min(60 * 60_000, 15_000 * 2 ** Math.max(job.attempts - 1, 0));

  await prisma.$transaction([
    prisma.whatsAppOutboundJob.update({
      where: { id: job.id },
      data: {
        status: deadLetter ? WhatsAppOutboundJobStatus.DLQ : WhatsAppOutboundJobStatus.FAILED,
        nextAttemptAt: new Date(Date.now() + delayMs),
        lastErrorCode: sanitized.code,
        lastError: sanitized.message,
        lockedAt: null,
        lockedBy: null,
        ...(deadLetter ? { processedAt: new Date() } : {}),
      },
    }),
    prisma.whatsAppMessage.update({
      where: { id: job.messageId },
      data: { status: WhatsAppMessageStatus.FAILED, errorCode: sanitized.code, errorMessage: sanitized.message },
    }),
    prisma.contractWhatsAppNotification.updateMany({
      where: { whatsappJobId: job.id },
      data: {
        status: deadLetter ? 'DLQ' : 'FAILED',
        lastErrorCode: sanitized.code,
        lastError: sanitized.message,
        ...(deadLetter ? { processedAt: new Date() } : { processedAt: null }),
      },
    }),
  ]);

  return deadLetter ? 'DLQ' : 'RETRY';
}

export type DrainWhatsAppWebhookResult = {
  claimed: number;
  processed: number;
  retried: number;
  deadLettered: number;
};

export async function ingestWhatsAppWebhook(input: {
  eventKey: string;
  payloadHash: string;
  payload: unknown;
}) {
  const records = extractWebhookRecords(input.payload);
  const phoneNumberId = records[0]?.phoneNumberId ?? null;
  const connection = phoneNumberId
    ? await prisma.whatsAppConnection.findFirst({ where: { scope: WhatsAppConnectionScope.PLATFORM, phoneNumberId } })
    : null;

  if (!connection && phoneNumberId === getWhatsAppRuntimeConfig().phoneNumberId) {
    await ensurePlatformWhatsAppConnection().catch(() => undefined);
  }

  const resolvedConnection = connection ?? (phoneNumberId
    ? await prisma.whatsAppConnection.findFirst({ where: { scope: WhatsAppConnectionScope.PLATFORM, phoneNumberId } })
    : null);

  return prisma.whatsAppWebhookEvent.upsert({
    where: { eventKey: input.eventKey },
    update: {},
    create: {
      eventKey: input.eventKey,
      connectionId: resolvedConnection?.id ?? null,
      contaId: resolvedConnection?.contaId ?? null,
      topic: 'whatsapp_business_account',
      payload: input.payload as Prisma.InputJsonValue,
      payloadHash: input.payloadHash,
      signatureValid: true,
      status: WhatsAppWebhookEventStatus.RECEIVED,
    },
    select: { id: true, status: true },
  });
}

export async function drainWhatsAppWebhooks(input: { limit?: number } = {}): Promise<DrainWhatsAppWebhookResult> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const now = new Date();
  const staleAt = new Date(Date.now() - 10 * 60_000);

  await prisma.whatsAppWebhookEvent.updateMany({
    where: { status: WhatsAppWebhookEventStatus.PROCESSING, updatedAt: { lt: staleAt } },
    data: {
      status: WhatsAppWebhookEventStatus.FAILED,
      nextRetryAt: now,
      lastErrorCode: 'STALE_LOCK_RECOVERED',
      lastError: 'Lock de processamento recuperado pelo worker.',
    },
  });

  const events = await prisma.whatsAppWebhookEvent.findMany({
    where: {
      status: { in: [WhatsAppWebhookEventStatus.RECEIVED, WhatsAppWebhookEventStatus.FAILED] },
      nextRetryAt: { lte: now },
    },
    orderBy: { receivedAt: 'asc' },
    take: limit,
  });

  const result: DrainWhatsAppWebhookResult = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 };
  for (const event of events) {
    const claimed = await prisma.whatsAppWebhookEvent.updateMany({
      where: {
        id: event.id,
        status: { in: [WhatsAppWebhookEventStatus.RECEIVED, WhatsAppWebhookEventStatus.FAILED] },
      },
      data: {
        status: WhatsAppWebhookEventStatus.PROCESSING,
        attempts: { increment: 1 },
        lastErrorCode: null,
        lastError: null,
        updatedAt: new Date(),
      },
    });
    if (claimed.count !== 1) continue;
    result.claimed += 1;

    try {
      await processWhatsAppWebhookEvent(event.id);
      result.processed += 1;
    } catch (error) {
      const sanitized = sanitizeWhatsAppError(error);
      const deadLetter = event.attempts + 1 >= event.maxAttempts;
      await prisma.whatsAppWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: deadLetter ? WhatsAppWebhookEventStatus.DLQ : WhatsAppWebhookEventStatus.FAILED,
          nextRetryAt: new Date(Date.now() + Math.min(60 * 60_000, 15_000 * 2 ** event.attempts)),
          lastErrorCode: sanitized.code,
          lastError: sanitized.message,
          ...(deadLetter ? { processedAt: new Date() } : {}),
        },
      });
      if (deadLetter) result.deadLettered += 1;
      else result.retried += 1;
    }
  }

  return result;
}

async function processWhatsAppWebhookEvent(eventId: string) {
  const event = await prisma.whatsAppWebhookEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new Error('Evento WhatsApp não encontrado.');

  const records = extractWebhookRecords(event.payload);
  if (!records.length) {
    await prisma.whatsAppWebhookEvent.update({
      where: { id: event.id },
      data: { status: WhatsAppWebhookEventStatus.PROCESSED, processedAt: new Date() },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const record of records) {
      const connection = await tx.whatsAppConnection.findFirst({
        where: { scope: WhatsAppConnectionScope.PLATFORM, phoneNumberId: record.phoneNumberId },
      });
      if (!connection) throw new Error(`Conexão WhatsApp não encontrada para ${record.phoneNumberId}.`);

      for (const incoming of record.messages) {
        const existing = await tx.whatsAppMessage.findFirst({
          where: { connectionId: connection.id, externalMessageId: incoming.id },
          select: { id: true },
        });
        const data = {
          connectionId: connection.id,
          contaId: connection.contaId,
          direction: WhatsAppMessageDirection.INBOUND,
          status: WhatsAppMessageStatus.DELIVERED,
          externalMessageId: incoming.id,
          fromPhoneNumber: normalizeWhatsAppPhone(incoming.from),
          messageType: incoming.type,
          body: incoming.text?.body ?? incoming.document?.caption ?? incoming.image?.caption ?? null,
          payload: incoming as unknown as Prisma.InputJsonValue,
        };
        if (existing) {
          await tx.whatsAppMessage.update({ where: { id: existing.id }, data });
        } else {
          await tx.whatsAppMessage.create({ data });
        }
      }

      for (const status of record.statuses) {
        const mapped = mapWhatsAppStatus(status.status);
        await tx.whatsAppMessage.updateMany({
          where: { connectionId: connection.id, externalMessageId: status.id },
          data: {
            status: mapped,
            errorCode: status.errors?.[0]?.code ? String(status.errors[0].code) : null,
            errorMessage: status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? null,
          },
        });
      }
    }

    await tx.whatsAppWebhookEvent.update({
      where: { id: event.id },
      data: { status: WhatsAppWebhookEventStatus.PROCESSED, processedAt: new Date() },
    });
  });
}

function extractWebhookRecords(payload: unknown) {
  return extractWhatsAppWebhookRecords(payload);
}

function mapWhatsAppStatus(status: string): WhatsAppMessageStatus {
  if (status === 'delivered') return WhatsAppMessageStatus.DELIVERED;
  if (status === 'read') return WhatsAppMessageStatus.READ;
  if (status === 'failed') return WhatsAppMessageStatus.FAILED;
  return WhatsAppMessageStatus.SENT;
}
