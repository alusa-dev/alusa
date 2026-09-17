import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { WhatsAppConfigurationError } from '@alusa/whatsapp';
import { whatsappTestMessageInputDTOSchema } from '@/features/comunicacao/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { assertTestRecipient, assertWhatsAppConfigured, getWhatsAppRuntimeConfig } from '@/src/server/whatsapp/config';
import { drainWhatsAppOutbox, enqueueWhatsAppMessage } from '@/src/server/whatsapp/outbox.service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const config = assertWhatsAppConfigured();
    const body = whatsappTestMessageInputDTOSchema.parse(await request.json());
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
      contaId: auth.contaId,
      actorUserId: auth.userId,
      request: outbound,
      idempotencyKey: `whatsapp-test:${auth.contaId}:${requestId}`,
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
    if (error instanceof ZodError || error instanceof WhatsAppConfigurationError) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
    }

    console.error('[whatsapp-test] Falha ao enviar mensagem', {
      error: error instanceof Error ? error.message : 'unknown',
      mode: getWhatsAppRuntimeConfig().testMode,
    });
    return NextResponse.json({ error: 'Não foi possível enviar a mensagem de teste.' }, { status: 500 });
  }
}

function getErrorMessage(error: ZodError | WhatsAppConfigurationError): string {
  return error instanceof ZodError ? error.issues[0]?.message ?? 'Dados inválidos.' : error.message;
}
