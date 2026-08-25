import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WhatsAppConfigurationError } from '@alusa/whatsapp';
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
    const to = config.testMode ? assertTestRecipient(rawTo, config) : rawTo.replace(/[^\d]/g, '');

    const contract = await prisma.contrato.findFirst({
      where: { id, contaId: user.contaId, matricula: { contaId: user.contaId } },
      select: {
        id: true,
        arquivoPdfUrl: true,
        arquivoPdfAssinadoUrl: true,
        status: true,
        matricula: { select: { aluno: { select: { nome: true } } } },
      },
    });
    if (!contract) return NextResponse.json({ error: 'Contrato não encontrado.' }, { status: 404 });

    const documentUrl = resolvePublicDocumentUrl(contract.arquivoPdfAssinadoUrl || contract.arquivoPdfUrl);
    const requestId = request.headers.get('idempotency-key')?.trim() || randomUUID();
    const queued = await enqueueWhatsAppMessage({
      contaId: user.contaId,
      actorUserId: user.id,
      request: {
        kind: 'document',
        to,
        link: documentUrl,
        filename: `contrato-alusa-${contract.id}.pdf`,
        caption: `Contrato Alusa — ${contract.matricula.aluno.nome ?? 'responsável'} (${contract.status}).`,
      },
      idempotencyKey: `whatsapp-contract:${user.contaId}:${contract.id}:${requestId}`,
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

function getErrorMessage(error: z.ZodError | WhatsAppConfigurationError): string {
  return error instanceof z.ZodError ? error.issues[0]?.message ?? 'Dados inválidos.' : error.message;
}
