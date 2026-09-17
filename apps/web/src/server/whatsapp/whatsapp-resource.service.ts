import { prisma } from '@/lib/prisma';

export async function getContractWhatsAppDocument(input: { contratoId: string; contaId: string }) {
  return prisma.contrato.findFirst({
    where: { id: input.contratoId, contaId: input.contaId, matricula: { contaId: input.contaId } },
    select: {
      id: true,
      arquivoPdfUrl: true,
      arquivoPdfAssinadoUrl: true,
      status: true,
      matricula: { select: { aluno: { select: { nome: true } } } },
    },
  });
}

export async function getSupportCaseWhatsAppMessage(input: { ticketId: string; contaId: string }) {
  return prisma.supportCase.findFirst({
    where: { id: input.ticketId, contaId: input.contaId },
    select: { id: true, title: true, description: true, status: true, priority: true },
  });
}

export async function getContractWhatsAppNotificationView(input: { contratoId: string; contaId: string }) {
  const notification = await prisma.contractWhatsAppNotification.findFirst({
    where: { contaId: input.contaId, contratoId: input.contratoId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, templateName: true, languageCode: true,
      recipientPhone: true, recipientType: true, attempts: true,
      lastErrorCode: true, lastError: true, whatsappJobId: true,
      createdAt: true, processedAt: true,
    },
  });
  if (!notification) return null;
  const job = notification.whatsappJobId
    ? await prisma.whatsAppOutboundJob.findFirst({
        where: { id: notification.whatsappJobId, contaId: input.contaId },
        select: { status: true, lastErrorCode: true, lastError: true },
      })
    : null;
  const failed = job && (job.status === 'FAILED' || job.status === 'DLQ');
  return {
    ...notification,
    status: failed ? job.status : notification.status,
    lastErrorCode: failed ? job.lastErrorCode : notification.lastErrorCode,
    lastError: failed ? job.lastError : notification.lastError,
  };
}

export async function getContractWhatsAppJobId(input: { notificationId: string; contaId: string }) {
  const notification = await prisma.contractWhatsAppNotification.findFirst({
    where: { id: input.notificationId, contaId: input.contaId },
    select: { whatsappJobId: true },
  });
  return notification?.whatsappJobId ?? null;
}
