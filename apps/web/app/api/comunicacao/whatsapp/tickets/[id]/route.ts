import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { WhatsAppConfigurationError, normalizeWhatsAppPhone } from '@alusa/whatsapp';
import { sendWhatsAppTargetInputDTOSchema } from '@/features/comunicacao/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { assertTestRecipient, assertWhatsAppConfigured } from '@/src/server/whatsapp/config';
import { drainWhatsAppOutbox, enqueueWhatsAppMessage } from '@/src/server/whatsapp/outbox.service';
import { getSupportCaseWhatsAppMessage } from '@/src/server/whatsapp/whatsapp-resource.service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const config = assertWhatsAppConfigured();
    const { id } = await params;
    const { to: rawTo } = sendWhatsAppTargetInputDTOSchema.parse(await request.json());
    const to = config.testMode ? assertTestRecipient(rawTo, config) : normalizeWhatsAppPhone(rawTo);
    const ticket = await getSupportCaseWhatsAppMessage({ ticketId: id, contaId: auth.contaId });
    if (!ticket) return NextResponse.json({ error: 'Ticket não encontrado.' }, { status: 404 });

    const requestId = request.headers.get('idempotency-key')?.trim() || randomUUID();
    const message = [
      `Ticket Alusa #${ticket.id}`,
      `Título: ${ticket.title}`,
      `Status: ${ticket.status}`,
      `Prioridade: ${ticket.priority}`,
      ticket.description ? `Descrição: ${ticket.description}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const queued = await enqueueWhatsAppMessage({
      contaId: auth.contaId,
      actorUserId: auth.userId,
      request: { kind: 'text', to, body: message.slice(0, 4096) },
      idempotencyKey: `whatsapp-ticket:${auth.contaId}:${ticket.id}:${requestId}`,
      correlationId: requestId,
    });
    const drained = await drainWhatsAppOutbox({ limit: 1, jobId: queued.jobId });

    return NextResponse.json({
      success: true,
      jobId: queued.jobId,
      messageId: queued.messageId,
      status: drained.sent ? 'SENT' : 'QUEUED',
      deduplicated: queued.deduplicated,
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof WhatsAppConfigurationError) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
    }
    console.error('[whatsapp-ticket] Falha ao enviar ticket', { error: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: 'Não foi possível enviar o ticket.' }, { status: 500 });
  }
}

function getErrorMessage(error: ZodError | WhatsAppConfigurationError): string {
  return error instanceof ZodError ? error.issues[0]?.message ?? 'Dados inválidos.' : error.message;
}
