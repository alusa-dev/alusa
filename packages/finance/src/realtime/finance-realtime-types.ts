import type { LiquidacaoStatus, StatusCobranca } from '@prisma/client';

export type FinanceRealtimeEventType = 'cobranca.updated';

export type FinanceRealtimeEvent = {
  contaId: string;
  type: FinanceRealtimeEventType;
  entityId: string;
  asaasPaymentId?: string | null;
  status?: StatusCobranca;
  liquidacaoStatus?: LiquidacaoStatus;
  asaasStatus?: string | null;
  revision: number;
  ts?: number;
};

export type FinanceRealtimeEventRecord = FinanceRealtimeEvent & {
  ts: number;
};
