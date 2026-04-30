import type { ListStoreSalesOutput, StoreSaleDTO, StoreSaleFilterStatus } from '@alusa/finance';

export type SaleFinalizationValue = 'RECEBIMENTO_PRESENCIAL' | 'COBRANCA';
export type SalePaymentMethodValue =
  | 'DINHEIRO'
  | 'PIX_PRESENCIAL'
  | 'CARTAO_DEBITO'
  | 'CARTAO_CREDITO';
export type BillingTypeValue = 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED';
export type InventoryModeValue = 'IMMEDIATE' | 'RESERVE';
export type InventoryStatusValue = StoreSaleDTO['inventoryStatus'];
export type CurrentSaleStatusFilter = Exclude<StoreSaleFilterStatus, 'VINCULADA_MENSALIDADE'>;

export type CreateSaleRequest = {
  uiRequestId: string;
  inventoryMode?: InventoryModeValue;
  customer:
    | {
        type: 'ALUNO';
        alunoId: string;
        responsavelId?: string | null;
      }
    | {
        type: 'RESPONSAVEL';
        responsavelId: string;
      }
    | {
        type: 'AVULSO';
        name: string;
        document?: string | null;
        email?: string | null;
        phone?: string | null;
        notes?: string | null;
        saveCustomer?: boolean | null;
      };
  items: Array<{
    productId: string;
    quantity: number;
    variantId?: string | null;
  }>;
  discount?: number;
  finalization:
    | {
        type: 'RECEBIMENTO_PRESENCIAL';
        paymentMethod: SalePaymentMethodValue;
        amountReceived?: number | null;
      }
    | {
        type: 'COBRANCA';
        dueDate: string;
        billingType: BillingTypeValue;
        installmentCount?: number | null;
      };
};

export type ListSalesParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: CurrentSaleStatusFilter;
  finalizationType?: SaleFinalizationValue | 'TODOS';
  fromDate?: string;
  toDate?: string;
};

export const SALE_STATUS_LABELS: Record<StoreSaleDTO['status'], string> = {
  CONCLUIDA: 'Concluída',
  PENDENTE: 'Pendente',
  VINCULADA_MENSALIDADE: 'Pendente',
  CANCELADA: 'Cancelada',
};

export const SALE_FINALIZATION_LABELS: Record<SaleFinalizationValue | 'MENSALIDADE', string> = {
  RECEBIMENTO_PRESENCIAL: 'Receber agora',
  COBRANCA: 'Gerar cobrança',
  MENSALIDADE: 'Finalização antiga',
};

export const SALE_PAYMENT_METHOD_LABELS: Record<SalePaymentMethodValue, string> = {
  DINHEIRO: 'Dinheiro',
  PIX_PRESENCIAL: 'Pix presencial',
  CARTAO_DEBITO: 'Cartão de débito',
  CARTAO_CREDITO: 'Cartão de crédito',
};

export const BILLING_TYPE_LABELS: Record<BillingTypeValue, string> = {
  BOLETO: 'Boleto',
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  UNDEFINED: 'Cliente escolhe',
};

export const CHARGE_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Criada',
  PENDING_SYNC: 'Sincronizando',
  OPEN: 'Aberta',
  PAID: 'Paga',
  OVERDUE: 'Atrasada',
  CANCELED: 'Cancelada',
  REFUNDED: 'Estornada',
};

export const INVENTORY_MODE_LABELS: Record<InventoryModeValue, string> = {
  IMMEDIATE: 'Venda imediata',
  RESERVE: 'Reservar para entregar',
};

export const INVENTORY_STATUS_LABELS: Record<InventoryStatusValue, string> = {
  FULFILLED: 'Cumprida',
  RESERVED: 'Reservada',
  CANCELED: 'Cancelada',
  RETURNED_PARTIAL: 'Devolução parcial',
  RETURNED_TOTAL: 'Devolvida',
};

function buildSearchParams(params: ListSalesParams) {
  const searchParams = new URLSearchParams();

  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params.search?.trim()) searchParams.set('search', params.search.trim());
  if (params.status && params.status !== 'TODOS') searchParams.set('status', params.status);
  if (params.finalizationType && params.finalizationType !== 'TODOS') {
    searchParams.set('finalizationType', params.finalizationType);
  }
  if (params.fromDate) searchParams.set('fromDate', params.fromDate);
  if (params.toDate) searchParams.set('toDate', params.toDate);

  return searchParams;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível concluir a operação da Loja.';
    throw new Error(message);
  }

  return json as T;
}

export function formatSaleNumber(value: number): string {
  return `#${String(value).padStart(4, '0')}`;
}

export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDateBR(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export async function listSales(params: ListSalesParams = {}): Promise<ListStoreSalesOutput> {
  const searchParams = buildSearchParams(params);
  const response = await fetch(`/api/vendas?${searchParams.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  return parseResponse<ListStoreSalesOutput>(response);
}

export async function getSale(id: string): Promise<StoreSaleDTO> {
  const response = await fetch(`/api/vendas/${id}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const json = await parseResponse<{ data: StoreSaleDTO }>(response);
  return json.data;
}

export async function createSale(payload: CreateSaleRequest): Promise<StoreSaleDTO> {
  const response = await fetch('/api/vendas', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await parseResponse<{ data: StoreSaleDTO }>(response);
  return json.data;
}

export async function cancelSale(id: string, reason: string): Promise<StoreSaleDTO> {
  const response = await fetch(`/api/vendas/${id}/cancel`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  });

  const json = await parseResponse<{ data: StoreSaleDTO }>(response);
  return json.data;
}

export async function fulfillSale(id: string): Promise<StoreSaleDTO> {
  const response = await fetch(`/api/vendas/${id}/fulfill`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  const json = await parseResponse<{ data: StoreSaleDTO }>(response);
  return json.data;
}

export async function returnSaleItems(
  id: string,
  payload: {
    reason?: string;
    items: Array<{
      saleItemId: string;
      quantity: number;
    }>;
  },
): Promise<StoreSaleDTO> {
  const response = await fetch(`/api/vendas/${id}/returns`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await parseResponse<{ data: StoreSaleDTO }>(response);
  return json.data;
}
