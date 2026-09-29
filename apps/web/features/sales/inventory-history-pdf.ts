import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { InventoryMovementType } from '@prisma/client';

import type { InventoryMovementItem } from './services/inventory-service';

const MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  OPENING_IN: 'Saldo inicial',
  ENTRY_IN: 'Entrada manual',
  RESTOCK_IN: 'Recebimento de reposição',
  SALE_OUT: 'Saída por venda',
  RESERVE: 'Reserva de venda',
  RELEASE: 'Liberação de reserva',
  RETURN_IN: 'Devolução',
  ADJUST_IN: 'Correção positiva',
  ADJUST_OUT: 'Correção negativa',
  LOSS_OUT: 'Perda',
};

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatOriginLabel(originType: string, originActionKey: string): string {
  if (originType === 'BACKFILL') return 'Importação inicial';
  if (originType === 'MANUAL_ENTRY') return 'Adicionado manualmente';
  if (originType === 'MANUAL_ADJUSTMENT') {
    return originActionKey === 'set' ? 'Contagem física' : 'Mudança manual';
  }
  if (originType === 'RESTOCK_ORDER') {
    if (originActionKey === 'planned') return 'Reposição planejada';
    if (originActionKey === 'cancel') return 'Reposição cancelada';
    if (originActionKey.startsWith('receive:')) return 'Reposição recebida';
    return 'Reposição';
  }
  if (originType === 'SALE') {
    if (originActionKey === 'reserve') return 'Venda reservada';
    if (originActionKey === 'sale-out') return 'Venda entregue';
    if (originActionKey === 'fulfill') return 'Reserva entregue';
    if (originActionKey === 'cancel') return 'Venda cancelada';
    if (originActionKey.startsWith('return:')) return 'Devolução de venda';
    return 'Venda';
  }

  return originType.replaceAll('_', ' ').toLowerCase();
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

function buildFiltersSummary(input: {
  search: string;
  movementType: InventoryMovementType | 'TODOS';
  fromDate?: Date;
  toDate?: Date;
  direction: 'asc' | 'desc';
}) {
  const parts: string[] = [`Ordem: ${input.direction === 'desc' ? 'mais recente' : 'mais antiga'}`];

  if (input.search.trim()) {
    parts.push(`Busca: ${input.search.trim()}`);
  }

  if (input.movementType !== 'TODOS') {
    parts.push(`Movimento: ${MOVEMENT_LABELS[input.movementType]}`);
  }

  if (input.fromDate) {
    parts.push(`De: ${format(input.fromDate, 'dd/MM/yyyy', { locale: ptBR })}`);
  }

  if (input.toDate) {
    parts.push(`Até: ${format(input.toDate, 'dd/MM/yyyy', { locale: ptBR })}`);
  }

  return parts.join(' | ');
}

export async function exportInventoryHistoryPdf(input: {
  items: InventoryMovementItem[];
  search: string;
  movementType: InventoryMovementType | 'TODOS';
  fromDate?: Date;
  toDate?: Date;
  direction: 'asc' | 'desc';
}) {
  const [{ default: jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const filtersSummary = buildFiltersSummary(input);

  doc.setFontSize(18);
  doc.text('Histórico de estoque', 40, 52);
  doc.setFontSize(10);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 40, 72);
  doc.text(filtersSummary, 40, 90, { maxWidth: 515 });

  autoTable(doc, {
    startY: 112,
    head: [
      [
        'Produto',
        'Movimento',
        'Origem',
        'Anterior',
        'Mudança',
        'Final',
        'Custo',
        'Responsável',
        'Data',
      ],
    ],
    body: input.items.map((item) => [
      item.variantTitle ? `${item.productName} · ${item.variantTitle}` : item.productName,
      MOVEMENT_LABELS[item.movementType],
      formatOriginLabel(item.originType, item.originActionKey),
      String(item.onHandBefore),
      `${item.onHandDelta >= 0 ? '+' : ''}${item.onHandDelta}`,
      String(item.onHandAfter),
      formatCurrency(item.totalCost),
      item.actor.name || 'Sistema',
      formatDateTime(item.createdAt),
    ]),
    styles: {
      fontSize: 8,
      cellPadding: 5,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [88, 59, 154],
    },
    margin: { left: 28, right: 28 },
  });

  doc.save(`historico-estoque-${sanitizeFileName(format(new Date(), 'yyyy-MM-dd'))}.pdf`);
}
