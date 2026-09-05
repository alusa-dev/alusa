import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import {
  drainContractWhatsAppNotifications,
  drainWhatsAppOutbox,
  requeueContractWhatsAppNotification,
} from '@/src/server/whatsapp/outbox.service';
import { prisma } from '@/prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const { id } = await params;
  const notification = await prisma.contractWhatsAppNotification.findFirst({
    where: { contaId: user.contaId, contratoId: id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, templateName: true, languageCode: true,
      recipientPhone: true, recipientType: true, attempts: true,
      lastErrorCode: true, lastError: true, whatsappJobId: true,
      createdAt: true, processedAt: true,
    },
  });
  if (!notification) return NextResponse.json({ notification: null });
  const job = notification.whatsappJobId
    ? await prisma.whatsAppOutboundJob.findFirst({
        where: { id: notification.whatsappJobId, contaId: user.contaId },
        select: { status: true, lastErrorCode: true, lastError: true },
      })
    : null;
  const effectiveNotification = job && (job.status === 'FAILED' || job.status === 'DLQ')
    ? { ...notification, status: job.status, lastErrorCode: job.lastErrorCode, lastError: job.lastError }
    : notification;
  return NextResponse.json({ notification: { ...effectiveNotification, recipientPhone: `***${notification.recipientPhone.slice(-4)}` } });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const { id } = await params;
  const queued = await requeueContractWhatsAppNotification({ contaId: user.contaId, contratoId: id, actorUserId: user.id });
  if (!queued) return NextResponse.json({ error: 'Notificação de contrato não encontrada.' }, { status: 404 });

  const notification = await drainContractWhatsAppNotifications({ limit: 1 });
  const outbox = await drainWhatsAppOutbox({ limit: 1 });
  return NextResponse.json({ success: true, notification, outbox, notificationId: queued.id });
}
