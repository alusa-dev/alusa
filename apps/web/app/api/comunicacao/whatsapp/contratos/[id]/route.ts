import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { WhatsAppConfigurationError } from '@alusa/whatsapp';
import { sendWhatsAppTargetInputDTOSchema } from '@/features/comunicacao/dtos';
import { contratoRouteParamsDTOSchema } from '@/features/contratos/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { assertTestRecipient, assertWhatsAppConfigured } from '@/src/server/whatsapp/config';
import { drainWhatsAppOutbox, enqueueWhatsAppMessage } from '@/src/server/whatsapp/outbox.service';
import { getContractWhatsAppDocument } from '@/src/server/whatsapp/whatsapp-resource.service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  try {
    const config = assertWhatsAppConfigured();
    const { id } = contratoRouteParamsDTOSchema.parse(await params);
    const { to: rawTo } = sendWhatsAppTargetInputDTOSchema.parse(await request.json());
    const to = config.testMode ? assertTestRecipient(rawTo, config) : rawTo.replace(/[^\d]/g, '');

    const contract = await getContractWhatsAppDocument({ contratoId: id, contaId: auth.contaId });
    if (!contract) return NextResponse.json({ error: 'Contrato não encontrado.' }, { status: 404 });

    const documentUrl = resolvePublicDocumentUrl(contract.arquivoPdfAssinadoUrl || contract.arquivoPdfUrl);
    const requestId = request.headers.get('idempotency-key')?.trim() || randomUUID();
    const queued = await enqueueWhatsAppMessage({
      contaId: auth.contaId,
      actorUserId: auth.userId,
      request: {
        kind: 'document',
        to,
        link: documentUrl,
        filename: `contrato-alusa-${contract.id}.pdf`,
        caption: `Contrato Alusa — ${contract.matricula.aluno.nome ?? 'responsável'} (${contract.status}).`,
      },
      idempotencyKey: `whatsapp-contract:${auth.contaId}:${contract.id}:${requestId}`,
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
    console.error('[whatsapp-contract] Falha ao enviar contrato', { error: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: 'Não foi possível enviar o contrato.' }, { status: 500 });
  }
}

function resolvePublicDocumentUrl(value: string): string {
  if (value.startsWith('data:') || value.startsWith('blob:')) {
    throw new WhatsAppConfigurationError('O documento precisa estar em uma URL HTTPS acessível pela Meta.');
  }

  const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  let resolved: URL;
  try {
    resolved = new URL(value, baseUrl);
  } catch {
    throw new WhatsAppConfigurationError('O documento precisa estar em uma URL pública válida.');
  }
  if (resolved.protocol !== 'https:') {
    throw new WhatsAppConfigurationError('URL do documento inválida para a Cloud API.');
  }
  return resolved.toString();
}

function getErrorMessage(error: ZodError | WhatsAppConfigurationError): string {
  return error instanceof ZodError ? error.issues[0]?.message ?? 'Dados inválidos.' : error.message;
}
