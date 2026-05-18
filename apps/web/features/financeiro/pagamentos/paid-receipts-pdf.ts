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

export type PaidReceiptItem = {
  id: string;
  sourceKind: string;
  sourceId: string;
  chargeType: string;
  origin: string;
  tipo: string | null;
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
  filtersSummary: string[];
  totalPaid: number;
  generatedBy?: string | null;
};

const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 42,
};

const COLORS = {
  black: 20,
  text: 38,
  muted: 102,
  light: 236,
  paper: 248,
  white: 255,
};

const TYPE_LABELS: Record<string, string> = {
  TAXA_MATRICULA: 'Taxa de matrícula',
  MENSALIDADE: 'Mensalidade',
  EXTRA: 'Extra',
  AVULSA: 'Avulsa',
  PARCELADA: 'Parcelamento',
  RECORRENTE: 'Assinatura',
  LOJA: 'Loja',
  ONE_TIME: 'Avulsa',
  INSTALLMENT: 'Parcelamento',
  SUBSCRIPTION: 'Assinatura',
};

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
  const key = item.tipo ?? item.chargeType;
  return TYPE_LABELS[key] ?? key ?? 'Cobrança';
}

function resolvePaymentLabel(item: PaidReceiptItem) {
  const key = item.pagamento?.formaPagamento ?? item.billingType ?? 'INDEFINIDO';
  return PAYMENT_LABELS[key] ?? key.replaceAll('_', ' ').toLowerCase();
}

function resolveReceiptOrigin(item: PaidReceiptItem) {
  return item.asaasPaymentId || item.pagamento?.asaasPaymentId || item.pagamento?.comprovante
    ? 'Comprovante oficial Asaas'
    : 'Recibo interno Alusa';
}

function drawBrandHeader(doc: import('jspdf').default, y = 48) {
  doc.setTextColor(COLORS.black);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.text('alusa', PAGE.margin, y);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(70);
  doc.roundedRect(PAGE.width - 176, y - 26, 134, 36, 6, 6);
  doc.text('SERVIÇOS FINANCEIROS', PAGE.width - 163, y - 9);
  doc.setFontSize(16);
  doc.text('ASAAS', PAGE.width - 163, y + 8);
}

function drawLabelValue(
  doc: import('jspdf').default,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(COLORS.muted);
  doc.text(label.toUpperCase(), x, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(COLORS.text);
  doc.text(ellipsize(value, Math.floor(width / 5.2)), x, y + 15);
}

function drawReceiptCard(
  doc: import('jspdf').default,
  item: PaidReceiptItem,
  aluno: PaidReceiptAluno,
  index: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const paidAt = item.pagamento?.dataPagamento ?? item.pagamento?.createdAt ?? item.createdAt;
  const value = item.pagamento?.valorPago ?? item.valor;
  const receiptId = `${item.sourceKind.toUpperCase()}-${item.sourceId.slice(-8).toUpperCase()}`;
  const origin = resolveReceiptOrigin(item);

  doc.setDrawColor(196);
  doc.setFillColor(COLORS.white, COLORS.white, COLORS.white);
  doc.roundedRect(x, y, width, height, 8, 8, 'FD');

  doc.setFillColor(COLORS.paper, COLORS.paper, COLORS.paper);
  doc.roundedRect(x + 14, y + 14, width - 28, 34, 5, 5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(COLORS.black);
  doc.text(`Comprovante ${String(index + 1).padStart(2, '0')}`, x + 26, y + 36);

  doc.setFontSize(8);
  doc.setTextColor(COLORS.muted);
  doc.text(origin, x + width - 26, y + 35, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(COLORS.black);
  doc.text(formatCurrency(value), x + 26, y + 78);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(COLORS.black);
  doc.text('PAGO', x + width - 26, y + 74, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(COLORS.muted);
  doc.text(formatDate(paidAt), x + width - 26, y + 88, { align: 'right' });

  const colW = (width - 64) / 2;
  drawLabelValue(doc, 'Aluno', aluno.nome, x + 26, y + 115, colW);
  drawLabelValue(doc, 'Pagador', item.payerName, x + 38 + colW, y + 115, colW);
  drawLabelValue(doc, 'Descrição', item.description ?? resolveTypeLabel(item), x + 26, y + 156, width - 52);
  drawLabelValue(doc, 'Tipo', resolveTypeLabel(item), x + 26, y + 197, colW);
  drawLabelValue(doc, 'Forma', resolvePaymentLabel(item), x + 38 + colW, y + 197, colW);
  drawLabelValue(doc, 'Vencimento', formatDate(item.vencimento), x + 26, y + 238, colW);
  drawLabelValue(doc, 'ID interno', receiptId, x + 38 + colW, y + 238, colW);

  doc.setDrawColor(COLORS.light);
  doc.line(x + 26, y + height - 42, x + width - 26, y + height - 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(COLORS.muted);
  const asaasId = item.asaasPaymentId ?? item.pagamento?.asaasPaymentId;
  doc.text(asaasId ? `Asaas: ${asaasId}` : 'Registro interno Alusa', x + 26, y + height - 22);
  doc.text('Documento gerado a partir dos registros financeiros locais.', x + width - 26, y + height - 22, {
    align: 'right',
  });
}

export async function exportPaidReceiptsPdf(input: ExportPaidReceiptsPdfInput) {
  const [{ default: jsPDF }] = await Promise.all([import('jspdf')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const generatedAt = new Date();

  drawBrandHeader(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(COLORS.black);
  doc.text('Comprovantes pagos', PAGE.margin, 112);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(COLORS.muted);
  doc.text(`Gerado em ${generatedAt.toLocaleString('pt-BR')}`, PAGE.margin, 132);

  doc.setDrawColor(210);
  doc.roundedRect(PAGE.margin, 164, PAGE.width - PAGE.margin * 2, 128, 8, 8);
  drawLabelValue(doc, 'Aluno', input.aluno.nome, 64, 192, 220);
  drawLabelValue(doc, 'CPF', input.aluno.cpf ?? 'Não informado', 326, 192, 170);
  drawLabelValue(doc, 'Total pago', formatCurrency(input.totalPaid), 64, 236, 140);
  drawLabelValue(doc, 'Comprovantes', String(input.items.length), 228, 236, 100);
  drawLabelValue(doc, 'Gerado por', input.generatedBy ?? 'Alusa', 366, 236, 140);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(COLORS.black);
  doc.text('Filtros aplicados', PAGE.margin, 332);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(COLORS.muted);
  const filterText = input.filtersSummary.length ? input.filtersSummary.join(' · ') : 'Todo o histórico pago';
  doc.text(ellipsize(filterText, 128), PAGE.margin, 350);

  doc.setFontSize(8);
  doc.setTextColor(COLORS.muted);
  doc.text(
    'Recibos internos aparecem em preto e branco. Comprovantes Asaas são identificados pelo ID de pagamento salvo localmente.',
    PAGE.margin,
    392,
    { maxWidth: PAGE.width - PAGE.margin * 2 },
  );

  if (input.items.length > 0) {
    doc.addPage();
  }

  const cardWidth = PAGE.width - PAGE.margin * 2;
  const cardHeight = 330;
  input.items.forEach((item, index) => {
    if (index > 0 && index % 2 === 0) doc.addPage();
    const slot = index % 2;
    const y = slot === 0 ? 52 : 458;
    drawReceiptCard(doc, item, input.aluno, index, PAGE.margin, y, cardWidth, cardHeight);
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(COLORS.muted);
    doc.text(`Página ${page} de ${pageCount}`, PAGE.width - PAGE.margin, PAGE.height - 24, { align: 'right' });
  }

  const fileName = `comprovantes-pagos-${sanitizeFileName(input.aluno.nome)}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}
