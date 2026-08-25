import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WhatsAppConfigurationError } from '@alusa/whatsapp';
import { getSessionUser } from '@/lib/auth/session';
import { assertTestRecipient, assertWhatsAppConfigured, getWhatsAppRuntimeConfig } from '@/src/server/whatsapp/config';
import { drainWhatsAppOutbox, enqueueWhatsAppMessage } from '@/src/server/whatsapp/outbox.service';

export const dynamic = 'force-dynamic';

const testMessageSchema = z.object({
  to: z.string().min(8).max(32),
  mode: z.enum(['template', 'text']).default('template'),
  body: z.string().trim().max(4096).optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const config = assertWhatsAppConfigured();
    const body = testMessageSchema.parse(await request.json());
    const to = assertTestRecipient(body.to, config);
    const requestId = request.headers.get('idempotency-key')?.trim() || randomUUID();
    const outbound = body.mode === 'text'
      ? {
          kind: 'text' as const,
          to,
          body: body.body || 'Mensagem de teste da Alusa.',
        }
      : {
          kind: 'template' as const,
          to,
          templateName: config.testTemplateName,
          languageCode: config.testTemplateLanguage,
        };

    const queued = await enqueueWhatsAppMessage({
      contaId: user.contaId,
      actorUserId: user.id,
      request: outbound,
      idempotencyKey: `whatsapp-test:${user.contaId}:${requestId}`,
      correlationId: requestId,
    });
    const drained = await drainWhatsAppOutbox({ limit: 1, jobId: queued.jobId });

    if (drained.deadLettered) {
      return NextResponse.json(
        { error: 'A Meta recusou a mensagem. Consulte o registro de integração.', jobId: queued.jobId },
        { status: 502 },
      );
    }

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

    console.error('[whatsapp-test] Falha ao enviar mensagem', {
      error: error instanceof Error ? error.message : 'unknown',
      mode: getWhatsAppRuntimeConfig().testMode,
    });
    return NextResponse.json({ error: 'Não foi possível enviar a mensagem de teste.' }, { status: 500 });
  }
}

function getErrorMessage(error: z.ZodError | WhatsAppConfigurationError): string {
  return error instanceof z.ZodError ? error.issues[0]?.message ?? 'Dados inválidos.' : error.message;
}
