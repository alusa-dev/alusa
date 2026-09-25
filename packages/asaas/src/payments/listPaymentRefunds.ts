import { AsaasHttp } from '../client/AsaasHttp';

export type AsaasPaymentRefundStatus =
  | 'PENDING'
  | 'AWAITING_CRITICAL_ACTION_AUTHORIZATION'
  | 'AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION'
  | 'CANCELLED'
  | 'DONE';

export interface AsaasPaymentRefund {
  dateCreated: string;
  status: AsaasPaymentRefundStatus;
  value: number;
  description?: string | null;
  transactionReceiptUrl?: string | null;
}

export interface ListPaymentRefundsParams {
  apiKey: string;
  paymentId: string;
}

const REFUNDS_PAGE_SIZE = 100;
const MAX_REFUNDS_PAGES = 10;

export async function listPaymentRefunds(params: ListPaymentRefundsParams) {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  const data: AsaasPaymentRefund[] = [];

  for (let page = 0; page < MAX_REFUNDS_PAGES; page += 1) {
    const offset = page * REFUNDS_PAGE_SIZE;
    const result = await client.get<{
      data: AsaasPaymentRefund[];
      hasMore: boolean;
    }>(`/payments/${params.paymentId}/refunds`, {
      params: { limit: REFUNDS_PAGE_SIZE, offset },
    });
    data.push(...result.data);

    if (!result.hasMore) return { data };
    if (result.data.length === 0) {
      throw new Error('Asaas refunds pagination reported more records without returning any.');
    }
  }

  throw new Error(`Asaas refunds pagination exceeded the safety cap of ${MAX_REFUNDS_PAGES} pages.`);
}
