import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEventTicketsPdf } from '@/lib/events/event-ticket-pdf';

const storageMock = vi.hoisted(() => ({ getStorageObject: vi.fn() }));
vi.mock('@/lib/r2-storage', () => ({ getStorageObject: storageMock.getStorageObject }));

function ticketOrder(ticketArtworkUrl?: string) {
  return {
    id: 'order-1',
    totalAmount: 30,
    event: {
      id: 'event-1',
      contaId: 'conta-1',
      name: 'Festival de Dança',
      startsAt: '2026-11-14T20:00:00.000Z',
      startsAtLocal: '2026-11-14T20:00',
      locationName: 'CCI',
      ticketArtworkUrl,
      ticketArtworkStorageKey: ticketArtworkUrl?.includes('/event-ticket-artwork/')
        ? 'uploads/event-ticket-artwork/conta-1/event-1/artwork-1.jpg'
        : null,
    },
    items: [
      {
        sectionName: 'Setor 1',
        seatLabel: 'A1',
        technicalCode: 'SEAT-A1',
        unitPrice: 30,
        ticketCode: '12345678',
        checkInCode: 'ABCDEFGHJKMN',
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('event ticket PDF artwork', () => {
  it('prints explicit civil session date and time independently of the server timezone', async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const pdf = await createEventTicketsPdf(ticketOrder());
      const content = pdf.toString('latin1');

      expect(content).toContain('14/11/2026');
      expect(content).toContain('20h00');
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it('keeps legacy tickets on the previous runtime-local formatting path', async () => {
    const order = ticketOrder();
    delete (order.event as { startsAtLocal?: string }).startsAtLocal;
    const date = new Date(order.event.startsAt);
    const expectedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    const expectedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date).replace(':', 'h');
    const pdf = await createEventTicketsPdf(order);
    expect(pdf.toString('latin1')).toContain(`${expectedDate} às ${expectedTime}`);
  });

  it('embeds event artwork in the generated PDF', async () => {
    const artwork = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 92, g: 35, b: 160 } },
    }).jpeg().toBuffer();
    const fetchMock = vi.fn().mockResolvedValue(new Response(artwork, {
      headers: { 'content-type': 'image/jpeg', 'content-length': String(artwork.byteLength) },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pdf = await createEventTicketsPdf(ticketOrder('https://storage.example.test/artwork.jpg'));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/DCTDecode');
  });

  it('loads event artwork from private R2 storage using the event-scoped key', async () => {
    const artwork = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 92, g: 35, b: 160 } },
    }).jpeg().toBuffer();
    storageMock.getStorageObject.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array(artwork) },
      ContentLength: artwork.byteLength,
    });

    const pdf = await createEventTicketsPdf(ticketOrder(
      '/api/files/uploads/event-ticket-artwork/conta-1/event-1/artwork-1.jpg',
    ));

    expect(storageMock.getStorageObject).toHaveBeenCalledWith(
      'uploads/event-ticket-artwork/conta-1/event-1/artwork-1.jpg',
    );
    expect(pdf.toString('latin1')).toContain('/DCTDecode');
  });

  it('falls back safely when the private R2 artwork cannot be read', async () => {
    storageMock.getStorageObject.mockRejectedValue(new Error('R2 unavailable'));

    const pdf = await createEventTicketsPdf(ticketOrder(
      '/api/files/uploads/event-ticket-artwork/conta-1/event-1/artwork-1.jpg',
    ));

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('does not read a storage key that does not match the event or is absent', async () => {
    const withoutArtwork = await createEventTicketsPdf(ticketOrder());
    const otherEventOrder = ticketOrder(
      '/api/files/uploads/event-ticket-artwork/conta-1/event-2/artwork-1.jpg',
    );
    const otherEventArtwork = await createEventTicketsPdf({
      ...otherEventOrder,
      event: {
        ...otherEventOrder.event,
        ticketArtworkStorageKey: 'uploads/event-ticket-artwork/conta-1/event-2/artwork-1.jpg',
      },
    });

    const otherTenantOrder = ticketOrder(
      '/api/files/uploads/event-ticket-artwork/conta-2/event-1/artwork-1.jpg',
    );
    const otherTenantArtwork = await createEventTicketsPdf({
      ...otherTenantOrder,
      event: {
        ...otherTenantOrder.event,
        ticketArtworkStorageKey: 'uploads/event-ticket-artwork/conta-2/event-1/artwork-1.jpg',
      },
    });

    expect(withoutArtwork.subarray(0, 5).toString()).toBe('%PDF-');
    expect(otherEventArtwork.subarray(0, 5).toString()).toBe('%PDF-');
    expect(otherTenantArtwork.subarray(0, 5).toString()).toBe('%PDF-');
    expect(storageMock.getStorageObject).not.toHaveBeenCalled();
  });

  it('still generates the PDF when event artwork is absent or unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const withoutArtwork = await createEventTicketsPdf(ticketOrder());
    const unavailableArtwork = await createEventTicketsPdf(ticketOrder('https://storage.example.test/missing.jpg'));

    expect(withoutArtwork.subarray(0, 5).toString()).toBe('%PDF-');
    expect(unavailableArtwork.subarray(0, 5).toString()).toBe('%PDF-');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
