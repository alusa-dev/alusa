import { NextResponse } from 'next/server';
import { z } from 'zod';
import { contratoRouteParamsDTOSchema } from '@/features/contracts/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getContractEmailNotificationHistory, queueManualContractEmail } from '@/src/server/contracts/contract-email-notification.service';
import { drainContractWhatsAppNotifications, drainWhatsAppOutbox, requeueContractWhatsAppNotification } from '@/src/server/whatsapp/outbox.service';
import { getContractWhatsAppJobId, getContractWhatsAppNotificationHistory } from '@/src/server/whatsapp/whatsapp-resource.service';

export const dynamic = 'force-dynamic';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const resendSchema = z.object({ channel: z.enum(['EMAIL', 'WHATSAPP']), operationId: z.string().uuid() });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const { id } = contratoRouteParamsDTOSchema.parse(await params);
  const email = await getContractEmailNotificationHistory({ contaId: auth.contaId, contratoId: id });
  if (email === null) return NextResponse.json({ error: 'Contrato não encontrado.' }, { status: 404 });
  const whatsapp = await getContractWhatsAppNotificationHistory({ contratoId: id, contaId: auth.contaId });
  if (whatsapp === null) return NextResponse.json({ error: 'Contrato não encontrado.' }, { status: 404 });
  return NextResponse.json({ notifications: { email, whatsapp } }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const { id } = contratoRouteParamsDTOSchema.parse(await params);
  const parsed = resendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Payload inválido.' }, { status: 422 });

  if (parsed.data.channel === 'EMAIL') {
    const result = await queueManualContractEmail({ contaId: auth.contaId, contratoId: id, actorId: auth.userId, operationId: parsed.data.operationId });
    if (result.status === 'NOT_FOUND') return NextResponse.json({ error: 'Contrato não encontrado ou indisponível para envio.' }, { status: 404 });
    if (result.status === 'DISABLED') return NextResponse.json({ error: 'O envio de e-mail para contratos está desativado nas configurações.' }, { status: 409 });
    if (result.status === 'RECIPIENT_UNAVAILABLE') return NextResponse.json({ error: 'Não há e-mail cadastrado para o assinante deste contrato.' }, { status: 409 });
    if (result.status === 'LINK_UNAVAILABLE') return NextResponse.json({ error: 'O link de assinatura não está mais válido.' }, { status: 409 });
    return NextResponse.json({ queued: true, channel: 'EMAIL', notificationId: result.notificationId }, { status: 202 });
  }

  const queued = await requeueContractWhatsAppNotification({ contaId: auth.contaId, contratoId: id, actorUserId: auth.userId, operationId: parsed.data.operationId });
  if (!queued) return NextResponse.json({ error: 'Notificação de WhatsApp indisponível; confirme consentimento e configuração da conta.' }, { status: 409 });
  const notification = queued.alreadyQueued
    ? { claimed: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0 }
    : await drainContractWhatsAppNotifications({ limit: 1, contaId: auth.contaId, notificationId: queued.id });
  const whatsappJobId = await getContractWhatsAppJobId({ notificationId: queued.id, contaId: auth.contaId });
  const outbox = whatsappJobId ? await drainWhatsAppOutbox({ contaId: auth.contaId, jobId: whatsappJobId }) : { claimed: 0, sent: 0, retried: 0, deadLettered: 0 };
  return NextResponse.json({ queued: true, channel: 'WHATSAPP', notification, outbox, notificationId: queued.id }, { status: 202 });
}
