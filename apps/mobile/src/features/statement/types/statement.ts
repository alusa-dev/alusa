export type StatementPeriod = 'this-month' | 'last-30-days';
export type StatementDirection = 'asc' | 'desc';

export type StatementSummary = {
  available: number;
  awaitingPayment: number;
  awaitingSettlement: number;
};

export type StatementTransaction = {
  id: string;
  date: string;
  description: string;
  type: 'RECEITA' | 'TAXA' | 'ESTORNO' | 'TRANSFERENCIA' | 'ANTECIPACAO' | 'AJUSTE';
  status: 'CONFIRMADO' | 'CANCELADO';
  grossValue: number;
  netValue: number;
  balanceAfter?: number;
  chargeName?: string;
  customerName?: string;
  paymentId?: string | null;
  transferId?: string | null;
};

export type StatementResponse = {
  summary: StatementSummary;
  transactions: StatementTransaction[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
  };
  sync: {
    fetchedAt: string;
    truncated: boolean;
  };
};
