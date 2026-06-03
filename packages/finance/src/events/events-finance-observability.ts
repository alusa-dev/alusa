type EventFinanceLogLevel = 'info' | 'warn' | 'error';

export type EventFinanceLogPayload = {
  contaId?: string | null;
  eventId?: string | null;
  orderId?: string | null;
  reservationId?: string | null;
  asaasPaymentId?: string | null;
  updated?: boolean;
  processed?: number;
  skipped?: number;
  errors?: number;
  reason?: string | null;
  message?: string | null;
};

export function logEventsFinance(
  action: string,
  payload: EventFinanceLogPayload = {},
  level: EventFinanceLogLevel = 'info',
) {
  const entry = {
    action,
    ...payload,
  };

  if (level === 'error') {
    console.error('[events.finance]', entry);
    return;
  }

  if (level === 'warn') {
    console.warn('[events.finance]', entry);
    return;
  }

  console.info('[events.finance]', entry);
}
