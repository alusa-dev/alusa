import { NextResponse } from 'next/server';
import { z } from 'zod';
import { contratoRouteParamsDTOSchema } from '@/features/contracts/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  drainContractWhatsAppNotifications,
  drainWhatsAppOutbox,
  requeueContractWhatsAppNotification,
} from '@/src/server/whatsapp/outbox.service';
import {
  getContractWhatsAppJobId,
  getContractWhatsAppNotificationView,
} from '@/src/server/whatsapp/whatsapp-resource.service';

export const dynamic = 'force-dynamic';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const resendInputSchema = z.object({ operationId: z.string().uuid() }).strict();

function requireStaff(requestedRole?: string) {
  return Boolean(requestedRole && allowedRoles.has(requestedRole.toUpperCase()));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!requireStaff(auth.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  const { id } = contratoRouteParamsDTOSchema.parse(await params);
  const notification = await getContractWhatsAppNotificationView({ contratoId: id, contaId: auth.contaId });
  if (!notification) return NextResponse.json({ notification: null });
  return NextResponse.json({ notification: { ...notification, recipientPhone: `***${notification.recipientPhone.slice(-4)}` } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!requireStaff(auth.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });

  const parsedBody = resendInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) return NextResponse.json({ error: 'Informe um identificador válido para esta operação.' }, { status: 422 });

  const { id } = contratoRouteParamsDTOSchema.parse(await params);
  const queued = await requeueContractWhatsAppNotification({ contaId: auth.contaId, contratoId: id, actorUserId: auth.userId, operationId: parsedBody.data.operationId });
  if (!queued) return NextResponse.json({ error: 'Notificação de contrato não encontrada.' }, { status: 404 });

  const notification = await drainContractWhatsAppNotifications({
    limit: 1,
    contaId: auth.contaId,
    notificationId: queued.id,
  });
  const whatsappJobId = await getContractWhatsAppJobId({ notificationId: queued.id, contaId: auth.contaId });
  const outbox = whatsappJobId
    ? await drainWhatsAppOutbox({ contaId: auth.contaId, jobId: whatsappJobId })
    : { claimed: 0, sent: 0, retried: 0, deadLettered: 0 };
  return NextResponse.json({ success: true, notification, outbox, notificationId: queued.id });
}
