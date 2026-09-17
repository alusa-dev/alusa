import { NextResponse } from 'next/server';
import { contratoRouteParamsDTOSchema } from '@/features/contratos/dtos';
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!requireStaff(auth.role)) return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });

  const { id } = contratoRouteParamsDTOSchema.parse(await params);
  const queued = await requeueContractWhatsAppNotification({ contaId: auth.contaId, contratoId: id, actorUserId: auth.userId });
  if (!queued) return NextResponse.json({ error: 'Notificação de contrato não encontrada.' }, { status: 404 });

  const notification = await drainContractWhatsAppNotifications({
    limit: 1,
    contaId: auth.contaId,
    notificationId: queued.id,
  });
  const whatsappJobId = await getContractWhatsAppJobId({ notificationId: queued.id, contaId: auth.contaId });
  const outbox = whatsappJobId
    ? await drainWhatsAppOutbox({ jobId: whatsappJobId })
    : { claimed: 0, sent: 0, retried: 0, deadLettered: 0 };
  return NextResponse.json({ success: true, notification, outbox, notificationId: queued.id });
}
