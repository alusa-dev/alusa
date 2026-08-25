import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WhatsAppConfigurationError, normalizeWhatsAppPhone } from '@alusa/whatsapp';
import { getSessionUser } from '@/lib/auth/session';
import { assertTestRecipient, assertWhatsAppConfigured } from '@/src/server/whatsapp/config';
import { drainWhatsAppOutbox, enqueueWhatsAppMessage } from '@/src/server/whatsapp/outbox.service';
import { prisma } from '@/prisma/client';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ to: z.string().min(8).max(32) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const config = assertWhatsAppConfigured();
    const { id } = await params;
    const { to: rawTo } = bodySchema.parse(await request.json());
    const to = config.testMode ? assertTestRecipient(rawTo, config) : normalizeWhatsAppPhone(rawTo);
    const ticket = await prisma.supportCase.findFirst({
      where: { id, contaId: user.contaId },
      select: { id: true, title: true, description: true, status: true, priority: true },
    });
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
      contaId: user.contaId,
      actorUserId: user.id,
      request: { kind: 'text', to, body: message.slice(0, 4096) },
      idempotencyKey: `whatsapp-ticket:${user.contaId}:${ticket.id}:${requestId}`,
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
    if (error instanceof z.ZodError || error instanceof WhatsAppConfigurationError) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
    }
    console.error('[whatsapp-ticket] Falha ao enviar ticket', { error: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: 'Não foi possível enviar o ticket.' }, { status: 500 });
  }
}

function getErrorMessage(error: z.ZodError | WhatsAppConfigurationError): string {
  return error instanceof z.ZodError ? error.issues[0]?.message ?? 'Dados inválidos.' : error.message;
}
