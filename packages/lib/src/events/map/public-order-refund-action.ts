type PublicOrderRefundActionState = {
  paymentMethod: string | null | undefined;
  status: string | null | undefined;
  paymentStatus: string | null | undefined;
  ticketFulfillmentLastError?: string | null;
  requestState?: unknown;
};

/** Whether a boleto refund link is still an actionable next step for the buyer. */
export function isPublicOrderRefundActionPending(state: PublicOrderRefundActionState) {
  if (state.paymentMethod?.toUpperCase() !== 'BOLETO' || state.status !== 'CONFIRMED') return false;
  const paymentStatus = state.paymentStatus?.trim().toUpperCase();
  if (paymentStatus === 'REFUND_REQUESTED') return true;

  return state.ticketFulfillmentLastError?.startsWith('ASSENTOS_INDISPONIVEIS:') === true
    && ['RECEIVED', 'CONFIRMED'].includes(paymentStatus ?? '')
    && state.requestState === 'AWAITING_CUSTOMER_ACTION';
}
