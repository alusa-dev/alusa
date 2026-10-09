import { NextResponse } from 'next/server';
import { runWithTenant } from '@/lib/prisma-tenant';
import { getEventsContext, handleEventsRouteError } from '../../_helpers';
import { persistEventTicketArtwork, removeEventTicketArtwork, validateTicketArtworkFile } from '@/src/server/media/event-ticket-artwork-storage.service';
import { readBoundedFormData } from '@/lib/upload-request';
import { rateLimitAsync } from '@/lib/rate-limit';
import { withTenantUploadQuota } from '@/lib/upload-quota.server';
import { validateUploadBuffer } from '@/lib/upload-security';
import { randomUUID } from 'node:crypto';

type Context = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: Context) {
  let uploaded: Awaited<ReturnType<typeof persistEventTicketArtwork>> | null = null;
  try {
    const ctx = await getEventsContext('events.update');
    const { eventId } = await params;
    const rate = await rateLimitAsync(`event-ticket-artwork:${ctx.contaId}:${ctx.userId}`, 10, 10 * 60_000);
    if (!rate.ok) return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas.' } }, { status: 429 });
    const uploadBody = await readBoundedFormData(request, 3.5 * 1024 * 1024);
    if (!uploadBody.ok) return NextResponse.json({ error: { code: 'UPLOAD_INVALIDO', message: uploadBody.error } }, { status: uploadBody.status });
    const form = uploadBody.formData;
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: { code: 'IMAGEM_INVALIDA', message: 'Selecione uma imagem.' } }, { status: 400 });
    const validationError = validateTicketArtworkFile(file);
    if (validationError) return NextResponse.json({ error: { code: 'IMAGEM_INVALIDA', message: validationError } }, { status: 400 });
    const owned = await runWithTenant(ctx.contaId, (tx) => tx.schoolEvent.findFirst({ where: { id: eventId, contaId: ctx.contaId }, select: { id: true, ticketArtworkUrl: true, ticketArtworkStorageKey: true } }));
    if (!owned) return NextResponse.json({ error: { code: 'EVENTO_NAO_ENCONTRADO', message: 'Evento não encontrado.' } }, { status: 404 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const binary = validateUploadBuffer({ buffer: bytes, fileName: file.name, declaredMimeType: file.type, fileSize: file.size, maxSizeBytes: 3 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'] });
    if (!binary.ok) return NextResponse.json({ error: { code: 'IMAGEM_INVALIDA', message: binary.error } }, { status: 400 });
    const objectKey = `uploads/event-ticket-artwork/${ctx.contaId}/${eventId}/${randomUUID()}.jpg`;
    const quota = await withTenantUploadQuota({
      contaId: ctx.contaId,
      fileSize: file.size,
      contentType: file.type,
      objectKey,
      cleanup: async () => { if (uploaded) await removeEventTicketArtwork(uploaded); },
      action: async () => {
        uploaded = await persistEventTicketArtwork({ contaId: ctx.contaId, eventId, bytes, objectKey });
        return uploaded;
      },
    });
    if (!quota.ok) return NextResponse.json({ error: { code: 'UPLOAD_QUOTA_EXCEEDED', message: 'Limite de armazenamento excedido.' } }, { status: 413 });
    uploaded = quota.result;
    const update = await runWithTenant(ctx.contaId, (tx) => tx.schoolEvent.updateMany({
      where: { id: eventId, contaId: ctx.contaId, ticketArtworkStorageKey: owned.ticketArtworkStorageKey },
      data: { ticketArtworkUrl: uploaded!.url, ticketArtworkStorageKey: uploaded!.storageKey },
    }));
    if (update.count !== 1) {
      await removeEventTicketArtwork(uploaded);
      uploaded = null;
      return NextResponse.json({ error: { code: 'EVENTO_ALTERADO', message: 'A imagem do evento foi alterada. Atualize a página e tente novamente.' } }, { status: 409 });
    }
    await removeEventTicketArtwork({ url: owned.ticketArtworkUrl ?? '', storageKey: owned.ticketArtworkStorageKey });
    uploaded = null;
    return NextResponse.json({ data: quota.result });
  } catch (error) {
    if (uploaded) await removeEventTicketArtwork(uploaded);
    return handleEventsRouteError(error, 'EVENT_TICKET_ARTWORK_UPLOAD_FAILED', { route: '/api/events/[eventId]/ticket-artwork', requestId: crypto.randomUUID(), method: 'POST', startedAt: Date.now() });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const ctx = await getEventsContext('events.update');
    const { eventId } = await params;
    const owned = await runWithTenant(ctx.contaId, (tx) => tx.schoolEvent.findFirst({ where: { id: eventId, contaId: ctx.contaId }, select: { id: true, ticketArtworkUrl: true, ticketArtworkStorageKey: true } }));
    if (!owned) return NextResponse.json({ error: { code: 'EVENTO_NAO_ENCONTRADO', message: 'Evento não encontrado.' } }, { status: 404 });
    const update = await runWithTenant(ctx.contaId, (tx) => tx.schoolEvent.updateMany({
      where: {
        id: eventId,
        contaId: ctx.contaId,
        ticketArtworkStorageKey: owned.ticketArtworkStorageKey,
        ticketArtworkUrl: owned.ticketArtworkUrl,
      },
      data: { ticketArtworkUrl: null, ticketArtworkStorageKey: null },
    }));
    if (update.count !== 1) {
      return NextResponse.json({ error: { code: 'EVENTO_ALTERADO', message: 'A imagem do evento foi alterada. Atualize a página e tente novamente.' } }, { status: 409 });
    }
    await removeEventTicketArtwork({ url: owned.ticketArtworkUrl ?? '', storageKey: owned.ticketArtworkStorageKey });
    return NextResponse.json({ data: { removed: true } });
  } catch (error) {
    return handleEventsRouteError(error, 'EVENT_TICKET_ARTWORK_DELETE_FAILED', { route: '/api/events/[eventId]/ticket-artwork', requestId: crypto.randomUUID(), method: 'DELETE', startedAt: Date.now() });
  }
}
