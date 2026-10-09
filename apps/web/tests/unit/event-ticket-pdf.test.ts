import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEventTicketsPdf } from '@/lib/events/event-ticket-pdf';

function ticketOrder(ticketArtworkUrl?: string) {
  return {
    id: 'order-1',
    totalAmount: 30,
    event: {
      name: 'Festival de Dança',
      startsAt: '2026-11-14T20:00:00.000Z',
      locationName: 'CCI',
      ticketArtworkUrl,
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

afterEach(() => vi.unstubAllGlobals());

describe('event ticket PDF artwork', () => {
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
