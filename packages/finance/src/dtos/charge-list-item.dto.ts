/**
 * DTO unificado para listagem de cobranças.
 * Normaliza dados de Cobranca (acadêmica) e Charge (standalone) em um único formato.
 */
export type ChargeListItemDTO = {
  id: string;
  origin: 'ACADEMIC' | 'STANDALONE';
  description: string | null;
  payerName: string;
  value: number;
  dueDate: string | null;
  billingType: string | null;
  status: UnifiedChargeStatus;
  liquidacaoStatus: string | null;
  createdAt: string;
  // IDs internos para debug/ações
  sourceId: string;
  matriculaId: string | null;
  alunoId: string | null;
  asaasPaymentId: string | null;
  tipo: string | null;
  // Campos para agrupamento de parcelamentos
  isGroup?: boolean;
  groupType?: 'INSTALLMENT' | 'SUBSCRIPTION';
  installmentPlanId?: string | null;
  installmentCount?: number;
  installmentsPaid?: number;
  installments?: ChargeListItemDTO[];
};

/**
 * Status unificado para exibição na UI.
 * Mapeado a partir de StatusCobranca e ChargeStatus.
 */
export type UnifiedChargeStatus =
  | 'PENDING'      // A_VENCER, PENDENTE, CREATED, OPEN
  | 'PROCESSING'   // PROCESSANDO
  | 'PAID'         // PAGO, PAID
  | 'OVERDUE'      // ATRASADO, OVERDUE
  | 'CANCELED'     // CANCELADO, CANCELED, CANCELAMENTO_PENDENTE
  | 'REFUNDED';    // ESTORNADO, ESTORNADO_PARCIAL, REFUNDED
