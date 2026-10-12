import { NextRequest, NextResponse } from 'next/server';

import { getPublicEventTicketsByAccessToken } from '@alusa/lib/events/public-event-ticket-access';

import { createEventTicketsPdf } from '@/lib/events/event-ticket-pdf';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ token: string }> };

function notFound() {
  return new NextResponse('Ingresso não encontrado.', {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { token: rawToken } = await params;
  const token = rawToken.trim();
  if (!token || token.length > 120) return notFound();

  try {
    const tickets = await getPublicEventTicketsByAccessToken(token);
    if (!tickets) return notFound();
    const pdf = await createEventTicketsPdf(tickets);
    return new NextResponse(new Uint8Array(pdf).buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="ingressos.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch {
    return notFound();
  }
}
