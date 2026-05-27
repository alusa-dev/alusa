import { NextRequest, NextResponse } from 'next/server';
import { jsPDF } from 'jspdf';

import { getPublicEventMapOrderTickets } from '@alusa/lib/events/map/event-map.service';

import { handleEventsRouteError } from '../../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { orderId } = await params;
    const token = request.nextUrl.searchParams.get('token')?.trim();
    if (!token) return NextResponse.json({ error: { code: 'TOKEN_AUSENTE', message: 'Token ausente.' } }, { status: 401 });

    const order = await getPublicEventMapOrderTickets(orderId, token);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 36;
    const ticketHeight = 230;
    let y = margin;

    doc.setProperties({ title: `Ingressos ${order.event.name}` });

    order.items.forEach((item, index) => {
      if (index > 0 && y + ticketHeight > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }

      doc.setDrawColor(124, 58, 237);
      doc.setFillColor(250, 250, 255);
      doc.roundedRect(margin, y, pageWidth - margin * 2, ticketHeight, 8, 8, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(order.event.name, margin + 18, y + 34, { maxWidth: pageWidth - margin * 2 - 36 });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      doc.text(`Data: ${formatDate(order.event.startsAt)}`, margin + 18, y + 58);
      if (order.event.locationName) doc.text(`Local: ${order.event.locationName}`, margin + 18, y + 74);

      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(28);
      doc.text(item.seatLabel, margin + 18, y + 124);

      doc.setFontSize(12);
      doc.text(item.sectionName, margin + 18, y + 148);
      doc.setFont('helvetica', 'normal');
      doc.text(`Ingresso: ${item.ticketCode}`, margin + 18, y + 172);
      doc.text(`Código técnico: ${item.technicalCode}`, margin + 18, y + 190);
      doc.text(`Valor: ${formatCurrency(item.unitPrice)}`, margin + 18, y + 208);

      doc.setFont('courier', 'bold');
      doc.setFontSize(18);
      doc.text(item.ticketCode, pageWidth - margin - 18, y + 124, { align: 'right' });

      doc.setDrawColor(148, 163, 184);
      doc.setLineDashPattern([6, 5], 0);
      doc.line(margin, y + ticketHeight + 12, pageWidth - margin, y + ticketHeight + 12);
      doc.setLineDashPattern([], 0);

      y += ticketHeight + 32;
    });

    const pdf = Buffer.from(doc.output('arraybuffer'));
    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="ingressos-${order.id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_GERAR_INGRESSOS_PDF');
  }
}
