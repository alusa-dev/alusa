import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { jsPDF } from 'jspdf';

const CODE_128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

const TICKET_IMAGE_RELATIVE_PATH = ['workspace-assets', 'tickets', 'reference-images', 'image-ticket.png'];
const TICKET_IMAGE_SIZE = { width: 1122, height: 1402 };

function findTicketImagePath() {
  const candidates = [
    path.join(process.cwd(), ...TICKET_IMAGE_RELATIVE_PATH),
    path.join(process.cwd(), '..', '..', ...TICKET_IMAGE_RELATIVE_PATH),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function loadTicketImageDataUrl() {
  const imagePath = findTicketImagePath();
  if (!imagePath) return null;

  const image = readFileSync(imagePath);
  return `data:image/png;base64,${image.toString('base64')}`;
}

const ticketImageDataUrl = loadTicketImageDataUrl();

type EventTicketPdfOrder = {
  id: string;
  totalAmount: number;
  event: {
    name: string;
    startsAt: string;
    locationName?: string | null;
  };
  items: Array<{
    sectionName: string;
    seatLabel: string;
    technicalCode: string;
    unitPrice: number;
    ticketCode: string;
  }>;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
    .format(new Date(value))
    .replace(':', 'h');
}

function drawVerticalText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  options?: { fontSize?: number; bold?: boolean; align?: 'left' | 'center' | 'right' }
) {
  doc.setFont('helvetica', options?.bold ? 'bold' : 'normal');
  doc.setFontSize(options?.fontSize ?? 8);
  doc.text(text, x, y, { angle: 90, align: options?.align ?? 'left' });
}

function getVerticalTextY(doc: jsPDF, text: string, centerY: number, bottomY: number, options?: { fontSize?: number; bold?: boolean; topY?: number }) {
  doc.setFont('helvetica', options?.bold ? 'bold' : 'normal');
  doc.setFontSize(options?.fontSize ?? 8);
  const textWidth = doc.getTextWidth(text);
  const y = centerY + textWidth / 2;
  if (options?.topY === undefined) return Math.min(bottomY, y);
  return Math.min(bottomY, Math.max(options.topY + textWidth, y));
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function toCheckInCode(ticketCode: string): string {
  const digits = ticketCode.replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(-8);
  return String(fnv1a32(ticketCode) % 100000000).padStart(8, '0');
}

function buildCode128BModules(value: string): boolean[] {
  const codes = [104, ...Array.from(value, (char) => {
    const code = char.charCodeAt(0) - 32;
    if (code < 0 || code > 95) throw new Error(`Caractere inválido para Code 128-B: ${char}`);
    return code;
  })];
  const checksum = codes.reduce((sum, code, index) => sum + code * (index === 0 ? 1 : index), 0) % 103;
  const sequence = [...codes, checksum, 106];

  return sequence.flatMap((code) => {
    const pattern = CODE_128_PATTERNS[code];
    const modules: boolean[] = [];
    Array.from(pattern).forEach((width, index) => {
      modules.push(...Array(Number(width)).fill(index % 2 === 0));
    });
    return modules;
  });
}

function drawRotatedCode128(doc: jsPDF, value: string, x: number, y: number, width: number, height: number) {
  const modules = buildCode128BModules(value);
  const moduleHeight = height / modules.length;
  doc.setFillColor(17, 24, 39);
  modules.forEach((filled, index) => {
    if (!filled) return;
    doc.rect(x, y + index * moduleHeight, width, Math.max(moduleHeight, 0.35), 'F');
  });
}

function drawTicketImage(doc: jsPDF, x: number, y: number, size: number, radius: number) {
  if (!ticketImageDataUrl) {
    doc.setDrawColor(124, 58, 237);
    doc.setFillColor(124, 58, 237);
    doc.roundedRect(x, y, size, size, radius, radius, 'F');
    doc.rect(x + size - radius, y, radius, size, 'F');
    return;
  }

  const sourceRatio = TICKET_IMAGE_SIZE.width / TICKET_IMAGE_SIZE.height;
  const targetRatio = 1;
  const drawWidth = sourceRatio > targetRatio ? size * sourceRatio : size;
  const drawHeight = sourceRatio > targetRatio ? size : size / sourceRatio;
  const drawX = x - (drawWidth - size) / 2;
  const drawY = y - (drawHeight - size) / 2;
  const pdf = doc as jsPDF & {
    saveGraphicsState: () => void;
    restoreGraphicsState: () => void;
    clip: () => void;
    discardPath: () => void;
  };

  pdf.saveGraphicsState();
  doc.roundedRect(x, y, size, size, radius, radius, null);
  doc.rect(x + size / 2, y, size / 2, size, null);
  pdf.clip();
  pdf.discardPath();
  doc.addImage(ticketImageDataUrl, 'PNG', drawX, drawY, drawWidth, drawHeight, undefined, 'FAST');
  pdf.restoreGraphicsState();
}

export function createEventTicketsPdf(order: EventTicketPdfOrder): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginY = 30;
  const ticketWidth = 540;
  const ticketHeight = 158;
  const imageSize = ticketHeight;
  const stubWidth = 104;
  const radius = 7;
  const gap = 16;
  const ticketsPerPage = Math.max(1, Math.floor((pageHeight - marginY * 2 + gap) / (ticketHeight + gap)));
  const contentX = (pageWidth - ticketWidth) / 2;
  const stubX = contentX + ticketWidth - stubWidth;
  const bodyLeft = contentX + imageSize;
  const bodyPaddingX = 18;
  const bodyContentX = bodyLeft + bodyPaddingX;
  const bodyContentRight = stubX - bodyPaddingX;
  const bodyWidth = bodyContentRight - bodyContentX;
  const bodyColGap = 20;
  const bodyColWidth = (bodyWidth - bodyColGap) / 2;
  const bodyCol2X = bodyContentX + bodyColWidth + bodyColGap;
  const eventTime = formatTime(order.event.startsAt);
  let y = marginY;

  doc.setProperties({ title: `Ingressos ${order.event.name}` });

  order.items.forEach((item, index) => {
    if (index > 0 && index % ticketsPerPage === 0) {
      doc.addPage();
      y = marginY;
    }

    const checkInCode = toCheckInCode(item.ticketCode);

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(contentX, y, ticketWidth, ticketHeight, radius, radius, 'FD');

    drawTicketImage(doc, contentX, y, imageSize, radius);

    doc.setDrawColor(203, 213, 225);
    doc.setLineDashPattern([4, 4], 0);
    doc.line(stubX, y + 8, stubX, y + ticketHeight - 8);
    doc.setLineDashPattern([], 0);

    doc.setTextColor(15, 23, 42); // slate-900
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14.8);
    doc.text(order.event.name, bodyContentX, y + 28, { maxWidth: bodyWidth });

    doc.setDrawColor(241, 245, 249); // slate-100
    doc.setLineWidth(1);
    doc.line(bodyContentX, y + 44, bodyContentRight, y + 44);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text('SETOR / ASSENTO', bodyContentX, y + 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.8);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(`${item.sectionName} - ${item.seatLabel}`, bodyContentX, y + 71, { maxWidth: bodyColWidth });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text('VALOR', bodyCol2X, y + 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(124, 58, 237); // violet-600
    doc.text(formatCurrency(item.unitPrice), bodyCol2X, y + 71, { maxWidth: bodyColWidth });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text('DATA / HORÁRIO', bodyContentX, y + 93);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.7);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(`${formatDate(order.event.startsAt)} às ${eventTime}`, bodyContentX, y + 104, { maxWidth: bodyColWidth });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text('CÓDIGO DE CHECK-IN', bodyCol2X, y + 93);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.7);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(checkInCode, bodyCol2X, y + 104, { maxWidth: bodyColWidth });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text('LOCAL', bodyContentX, y + 125);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text(order.event.locationName ?? '-', bodyContentX, y + 136, { maxWidth: bodyWidth });

    const stubTopY = y + 10;
    const stubCenterY = y + ticketHeight / 2;
    const stubBottomY = y + ticketHeight - 10;
    const stubEventX = stubX + stubWidth * 0.2;
    const stubDetailsX = stubX + stubWidth * 0.34;
    const barcodeWidth = 28;
    const barcodeHeight = 90;
    const barcodeX = stubX + stubWidth * 0.62 - barcodeWidth / 2;
    const barcodeY = y + (ticketHeight - barcodeHeight) / 2;
    const checkInX = stubX + stubWidth * 0.87;
    const eventLabel = order.event.name;
    const detailsLabel = `${item.sectionName} - ${item.seatLabel} • ${eventTime} • ${formatCurrency(item.unitPrice)}`;
    const eventFontSize = 9.2;
    const detailsFontSize = 7.4;
    const checkInFontSize = 6.5;
    const checkInLabelY = getVerticalTextY(doc, checkInCode, stubCenterY, stubBottomY, { fontSize: checkInFontSize, bold: true, topY: stubTopY });

    // 1. Evento (cresce para cima, centrado no canhoto - apenas o valor)
    doc.setTextColor(30, 41, 59); // slate-800
    drawVerticalText(
      doc,
      eventLabel,
      stubEventX,
      getVerticalTextY(doc, eventLabel, stubCenterY, stubBottomY, { fontSize: eventFontSize, bold: true, topY: stubTopY }),
      { fontSize: eventFontSize, bold: true }
    );

    // 2. Setor, assento, horário e valor um do lado do outro na vertical (cresce para cima)
    doc.setTextColor(30, 41, 59); // slate-800
    drawVerticalText(
      doc,
      detailsLabel,
      stubDetailsX,
      getVerticalTextY(doc, detailsLabel, stubCenterY, stubBottomY, { fontSize: detailsFontSize, bold: true, topY: stubTopY }),
      { fontSize: detailsFontSize, bold: true }
    );

    // Código de barras vertical (cresce para baixo, centrado e deslocado para a direita)
    drawRotatedCode128(doc, checkInCode, barcodeX, barcodeY, barcodeWidth, barcodeHeight);
    // Código de check-in vertical (cresce para cima, alinhado com padding de 4.5pt)
    doc.setTextColor(15, 23, 42); // slate-900
    drawVerticalText(doc, checkInCode, checkInX, checkInLabelY, { fontSize: checkInFontSize, bold: true });

    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(contentX, y, ticketWidth, ticketHeight, radius, radius, 'S');

    doc.setFillColor(255, 255, 255);
    doc.circle(stubX, y, 6, 'F');
    doc.circle(stubX, y + ticketHeight, 6, 'F');

    y += ticketHeight + gap;
  });

  return Buffer.from(doc.output('arraybuffer'));
}
