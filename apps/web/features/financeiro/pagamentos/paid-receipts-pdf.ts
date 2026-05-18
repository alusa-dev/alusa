import {
  normalizePaymentHistoryCategory,
  PAYMENT_HISTORY_CATEGORY_LABELS,
} from './payment-history-categories';

type PaidReceiptPagamento = {
  id: string;
  status: string;
  valorPago: number;
  dataPagamento: string | null;
  formaPagamento: string;
  comprovante: string | null;
  asaasPaymentId: string | null;
  createdAt: string;
};

export type PaidReceiptAluno = {
  id: string;
  nome: string;
  cpf: string | null;
};

export type PaidReceiptEscola = {
  nome: string;
  cpfCnpj: string | null;
  telefone: string | null;
  email: string | null;
};

export type PaidReceiptItem = {
  id: string;
  sourceKind: string;
  sourceId: string;
  chargeType: string;
  origin: string;
  tipo: string | null;
  category?: string;
  description: string | null;
  payerName: string;
  valor: number;
  vencimento: string | null;
  billingType: string | null;
  asaasPaymentId: string | null;
  matriculaId: string | null;
  createdAt: string;
  pagamento: PaidReceiptPagamento | null;
};

type ExportPaidReceiptsPdfInput = {
  aluno: PaidReceiptAluno;
  items: PaidReceiptItem[];
  escola?: PaidReceiptEscola | null;
};

const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 42,
};

const RECEIPT_LAYOUT = {
  cardPadding: 20,
  cardRadius: 10,
  logoWidth: 74,
  logoHeight: 22,
  headerGap: 16,
  sectionGap: 12,
  rowHeight: 38,
  cellPaddingX: 14,
  cellLabelY: 14,
  cellValueY: 29,
  footerGap: 14,
  footerTextY: 16,
  pageCardGap: 16,
  cardBottomBuffer: 2,
};

const BRAND = {
  accent: [92, 47, 145] as const,
  primary: [62, 31, 99] as const,
  purple: [117, 60, 184] as const,
  purpleBg: [230, 214, 251] as const,
  successBg: [207, 242, 218] as const,
  successText: [20, 78, 34] as const,
  infoBg: [217, 242, 245] as const,
  infoText: [31, 74, 82] as const,
  neutralBg: [230, 228, 234] as const,
  neutralText: [56, 50, 66] as const,
  muted: [104, 104, 104] as const,
  muted2: [130, 130, 130] as const,
  stroke: [221, 221, 221] as const,
  text: [25, 20, 58] as const,
  white: [255, 255, 255] as const,
};

type PdfDoc = import('jspdf').default;
type Rgb = readonly [number, number, number];
type BadgeTone = 'success' | 'brand' | 'info' | 'neutral';

const BADGE_TONES: Record<BadgeTone, { bg: Rgb; text: Rgb }> = {
  success: { bg: BRAND.successBg, text: BRAND.successText },
  brand: { bg: BRAND.purpleBg, text: BRAND.purple },
  info: { bg: BRAND.infoBg, text: BRAND.infoText },
  neutral: { bg: BRAND.neutralBg, text: BRAND.neutralText },
};

let cachedLogoDataUrl: string | null = null;

const PAYMENT_LABELS: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CARTAO_CREDITO: 'Cartão de crédito',
  CREDIT_CARD: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  DEBIT_CARD: 'Cartão de débito',
  DINHEIRO: 'Dinheiro',
  PIX_PRESENCIAL: 'Pix presencial',
  CARTAO_DEBITO_PRESENCIAL: 'Cartão de débito',
  CARTAO_CREDITO_PRESENCIAL: 'Cartão de crédito',
  INDEFINIDO: 'Não informado',
  UNDEFINED: 'Não informado',
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function ellipsize(value: string | null | undefined, max = 72) {
  const normalized = (value || '—').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function resolveTypeLabel(item: PaidReceiptItem) {
  const category = item.category
    ? (item.category as keyof typeof PAYMENT_HISTORY_CATEGORY_LABELS)
    : normalizePaymentHistoryCategory(item);
  return PAYMENT_HISTORY_CATEGORY_LABELS[category] ?? 'Cobrança';
}

function resolvePaymentLabel(item: PaidReceiptItem) {
  const key = item.pagamento?.formaPagamento ?? item.billingType ?? 'INDEFINIDO';
  return PAYMENT_LABELS[key] ?? key.replaceAll('_', ' ').toLowerCase();
}

function resolveReceiptOrigin(item: PaidReceiptItem) {
  return item.asaasPaymentId || item.pagamento?.asaasPaymentId || item.pagamento?.comprovante
    ? 'Pagamento intermediado pelo Asaas'
    : 'Recibo interno Alusa';
}

function resolveInternalId(item: PaidReceiptItem) {
  return `${item.sourceKind.toUpperCase()}-${item.sourceId.slice(-8).toUpperCase()}`;
}

function formatCpfCnpj(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return value;
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }
  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }
  return value;
}

function resolveDocumentLabel(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length === 14) return 'CNPJ';
  return 'CPF';
}

function drawSchoolGrid(
  doc: PdfDoc,
  escola: PaidReceiptEscola | null | undefined,
  innerX: number,
  startY: number,
  innerWidth: number,
  rowHeight: number,
) {
  if (!escola?.nome) return startY;

  const colWidth = innerWidth / 2;
  const documentLabel = resolveDocumentLabel(escola.cpfCnpj);
  const documentValue = escola.cpfCnpj ? formatCpfCnpj(escola.cpfCnpj) : '—';

  drawGridCell(doc, innerX, startY, colWidth, rowHeight, 'Nome da escola', escola.nome);
  drawGridCell(doc, innerX + colWidth, startY, colWidth, rowHeight, documentLabel, documentValue);
  drawGridCell(
    doc,
    innerX,
    startY + rowHeight,
    colWidth,
    rowHeight,
    'Telefone',
    escola.telefone ? formatPhone(escola.telefone) : '—',
  );
  drawGridCell(doc, innerX + colWidth, startY + rowHeight, colWidth, rowHeight, 'E-mail', escola.email ?? '—');

  return startY + rowHeight * 2;
}

async function loadAlusaLogoDataUrl() {
  if (cachedLogoDataUrl) return cachedLogoDataUrl;
  if (typeof window === 'undefined') return null;

  try {
    const response = await fetch('/brand/alusa-logo-dark.svg');
    const svgText = await response.text();
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    cachedLogoDataUrl = await new Promise<string>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 622;
        canvas.height = 190;
        const context = canvas.getContext('2d');
        if (!context) {
          URL.revokeObjectURL(blobUrl);
          reject(new Error('Canvas unavailable'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(blobUrl);
        resolve(canvas.toDataURL('image/png'));
      };
      image.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('Failed to load Alusa logo'));
      };
      image.src = blobUrl;
    });

    return cachedLogoDataUrl;
  } catch {
    return null;
  }
}

function fillRgb(doc: PdfDoc, rgb: Rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function strokeRgb(doc: PdfDoc, rgb: Rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function textRgb(doc: PdfDoc, rgb: Rgb) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function measureTextWidth(doc: PdfDoc, text: string) {
  return doc.getTextWidth(text);
}

function badgeTextBaseline(pillY: number, pillHeight: number, fontSize: number) {
  return pillY + pillHeight / 2 + fontSize * 0.35;
}

function drawAlusaBadge(
  doc: PdfDoc,
  label: string,
  x: number,
  y: number,
  tone: BadgeTone,
  align: 'left' | 'right' = 'right',
  fontSize = 7.5,
) {
  const style = BADGE_TONES[tone];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  const textWidth = measureTextWidth(doc, label);
  const pillWidth = textWidth + 20;
  const pillHeight = 18;
  const pillX = align === 'right' ? x - pillWidth : x;

  fillRgb(doc, style.bg);
  doc.roundedRect(pillX, y, pillWidth, pillHeight, 9, 9, 'F');

  textRgb(doc, style.text);
  doc.text(label, pillX + pillWidth / 2, badgeTextBaseline(y, pillHeight, fontSize), { align: 'center' });

  return pillWidth;
}

function drawGridCell(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
) {
  fillRgb(doc, BRAND.white);
  strokeRgb(doc, BRAND.stroke);
  doc.setLineWidth(0.55);
  doc.rect(x, y, width, height, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  textRgb(doc, BRAND.muted2);
  doc.text(label.toUpperCase(), x + RECEIPT_LAYOUT.cellPaddingX, y + RECEIPT_LAYOUT.cellLabelY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.2);
  textRgb(doc, BRAND.text);
  doc.text(
    ellipsize(value, Math.max(14, Math.floor((width - RECEIPT_LAYOUT.cellPaddingX * 2) / 4.6))),
    x + RECEIPT_LAYOUT.cellPaddingX,
    y + RECEIPT_LAYOUT.cellValueY,
  );
}

function drawValorGridCell(doc: PdfDoc, x: number, y: number, width: number, height: number, value: string) {
  fillRgb(doc, BRAND.white);
  strokeRgb(doc, BRAND.stroke);
  doc.setLineWidth(0.55);
  doc.rect(x, y, width, height, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  textRgb(doc, BRAND.muted2);
  doc.text('VALOR', x + RECEIPT_LAYOUT.cellPaddingX, y + RECEIPT_LAYOUT.cellLabelY);

  const pillHeight = 18;
  const valueFontSize = 9.2;
  const badgeRight = x + width - RECEIPT_LAYOUT.cellPaddingX;
  const badgeY = y + (height - pillHeight) / 2;
  const badgeWidth = drawAlusaBadge(doc, 'Pago', badgeRight, badgeY, 'success', 'right');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(valueFontSize);
  textRgb(doc, BRAND.text);
  const valueMaxWidth = width - RECEIPT_LAYOUT.cellPaddingX * 2 - badgeWidth - 12;
  const valueText = doc.getTextWidth(value) > valueMaxWidth
    ? ellipsize(value, Math.max(8, Math.floor(valueMaxWidth / 5)))
    : value;
  doc.text(
    valueText,
    x + RECEIPT_LAYOUT.cellPaddingX,
    y + RECEIPT_LAYOUT.cellValueY,
  );
}

function drawReceiptCard(
  doc: PdfDoc,
  item: PaidReceiptItem,
  aluno: PaidReceiptAluno,
  escola: PaidReceiptEscola | null | undefined,
  logoDataUrl: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const paidAt = item.pagamento?.dataPagamento ?? item.pagamento?.createdAt ?? item.createdAt;
  const value = item.pagamento?.valorPago ?? item.valor;
  const internalId = resolveInternalId(item);
  const origin = resolveReceiptOrigin(item);
  const isAsaas = origin.includes('Asaas');
  const { cardPadding, logoWidth, logoHeight, headerGap, sectionGap, rowHeight, footerGap, footerTextY, cardRadius } =
    RECEIPT_LAYOUT;
  const innerX = x + cardPadding;
  const innerWidth = width - cardPadding * 2;

  fillRgb(doc, BRAND.white);
  strokeRgb(doc, BRAND.stroke);
  doc.setLineWidth(0.75);
  doc.roundedRect(x, y, width, height, cardRadius, cardRadius, 'FD');

  const headerTop = y + cardPadding;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', innerX, headerTop, logoWidth, logoHeight);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    textRgb(doc, BRAND.primary);
    doc.text('alusa', innerX, headerTop + 16);
  }

  drawAlusaBadge(
    doc,
    origin,
    innerX + innerWidth,
    headerTop + 3,
    isAsaas ? 'info' : 'brand',
    'right',
    isAsaas ? 6.8 : 7.5,
  );

  const schoolGridY = headerTop + logoHeight + headerGap;
  const schoolGridBottom = drawSchoolGrid(doc, escola, innerX, schoolGridY, innerWidth, rowHeight);

  const chargeGridY = (escola?.nome ? schoolGridBottom : schoolGridY) + sectionGap;
  const colWidth = innerWidth / 2;

  drawGridCell(doc, innerX, chargeGridY, colWidth, rowHeight, 'Aluno', aluno.nome);
  drawGridCell(doc, innerX + colWidth, chargeGridY, colWidth, rowHeight, 'Pagador', item.payerName);
  drawGridCell(
    doc,
    innerX,
    chargeGridY + rowHeight,
    colWidth,
    rowHeight,
    'Descrição',
    item.description ?? resolveTypeLabel(item),
  );
  drawValorGridCell(doc, innerX + colWidth, chargeGridY + rowHeight, colWidth, rowHeight, formatCurrency(value));
  drawGridCell(doc, innerX, chargeGridY + rowHeight * 2, colWidth, rowHeight, 'Tipo', resolveTypeLabel(item));
  drawGridCell(doc, innerX + colWidth, chargeGridY + rowHeight * 2, colWidth, rowHeight, 'Forma', resolvePaymentLabel(item));
  drawGridCell(doc, innerX, chargeGridY + rowHeight * 3, colWidth, rowHeight, 'Pagamento', formatDate(paidAt));
  drawGridCell(doc, innerX + colWidth, chargeGridY + rowHeight * 3, colWidth, rowHeight, 'ID interno', internalId);

  const footerY = chargeGridY + rowHeight * 4 + footerGap;
  strokeRgb(doc, BRAND.stroke);
  doc.setLineWidth(0.55);
  doc.line(innerX, footerY, innerX + innerWidth, footerY);

  const asaasId = item.asaasPaymentId ?? item.pagamento?.asaasPaymentId;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  textRgb(doc, BRAND.muted);
  doc.text(asaasId ? `Asaas: ${asaasId}` : 'Registro interno Alusa', innerX, footerY + footerTextY);
  doc.text('Comprovante emitido pela Alusa com base nos registros financeiros da plataforma.', innerX + innerWidth, footerY + footerTextY, {
    align: 'right',
  });
}

export async function exportPaidReceiptsPdf(input: ExportPaidReceiptsPdfInput) {
  const [{ default: jsPDF }] = await Promise.all([import('jspdf')]);
  const logoDataUrl = await loadAlusaLogoDataUrl();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const generatedAt = new Date();

  const cardWidth = PAGE.width - PAGE.margin * 2;
  const cardHeight =
    RECEIPT_LAYOUT.cardPadding * 2 +
    RECEIPT_LAYOUT.logoHeight +
    RECEIPT_LAYOUT.headerGap +
    RECEIPT_LAYOUT.rowHeight * 6 +
    RECEIPT_LAYOUT.sectionGap +
    RECEIPT_LAYOUT.footerGap +
    RECEIPT_LAYOUT.footerTextY +
    RECEIPT_LAYOUT.cardBottomBuffer;
  const firstCardY = 44;
  const secondCardY = firstCardY + cardHeight + RECEIPT_LAYOUT.pageCardGap;

  input.items.forEach((item, index) => {
    if (index > 0 && index % 2 === 0) doc.addPage();
    const slot = index % 2;
    const y = slot === 0 ? firstCardY : secondCardY;
    drawReceiptCard(doc, item, input.aluno, input.escola, logoDataUrl, PAGE.margin, y, cardWidth, cardHeight);
  });

  const fileName = `comprovantes-pagos-${sanitizeFileName(input.aluno.nome)}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}
