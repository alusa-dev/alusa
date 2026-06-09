import type { LiquidacaoStatus, StatusCobranca } from '@prisma/client';
import type { PaymentCommandJobType, PaymentCommandOperationalStatus } from '../use-cases/payment-command-ledger';

export type FinanceRealtimeEventType = 'cobranca.updated' | 'finance.command.updated';

export type FinanceRealtimeEvent = {
  contaId: string;
  type: FinanceRealtimeEventType;
  entityId: string;
  asaasPaymentId?: string | null;
  status?: StatusCobranca;
  liquidacaoStatus?: LiquidacaoStatus;
  asaasStatus?: string | null;
  commandType?: PaymentCommandJobType;
  commandStatus?: PaymentCommandOperationalStatus;
  revision: number;
  ts?: number;
};

export type FinanceRealtimeEventRecord = FinanceRealtimeEvent & {
  ts: number;
};
